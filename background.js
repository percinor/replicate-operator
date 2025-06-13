// =================================================================================
// Replicate Operator - background.js (Final Declarative Injection Version)
// =================================================================================

let isRecording = false;
let recordedSteps = [];
let lastActionTimestamp = 0;
let recordingTabId = null;

// --- Utility for Logging ---
function log(message, ...args) {
    console.log(`[Background] ${new Date().toLocaleTimeString()} - ${message}`, ...args);
}

// =================================================================================
//                          EVENT LISTENERS
// =================================================================================

// --- Extension UI & Tab Lifecycle Listeners ---
chrome.action.onClicked.addListener((tab) => {
    log('Icon clicked');
    chrome.sidePanel.open({ windowId: tab.windowId });
    updateIcon(tab.id);
});

chrome.tabs.onActivated.addListener(activeInfo => {
    updateIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status) {
        updateIcon(tabId);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recordingTabId) {
        log(`Recording tab ${tabId} was closed, cancelling.`);
        handleCancelRecording();
    }
});


// =================================================================================
//                          MESSAGE LISTENERS
// =================================================================================

// --- Listener for Content Scripts (which have sender.tab) ---
chrome.runtime.onMessage.addListener((request, sender) => {
    if (!sender.tab) return false; // Let other listeners handle this

    if (request.type === 'recordAction') {
        // Only record if recording is active AND the message comes from the correct tab
        if (isRecording && sender.tab.id === recordingTabId) {
            handleRecordAction(request.action, sender);
        }
    }
    // Return false to allow other listeners to run.
    return false;
});

// --- Listener for Side Panel UI (which do NOT have sender.tab) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender.tab) return false; // Let the other listener handle this

    log(`Message from Side Panel: "${request.type}"`);

    switch (request.type) {
        case 'startRecording': handleStartRecording(); break;
        case 'stopRecordingAndSave': handleStopRecordingAndSave(request.name); break;
        case 'cancelRecording': handleCancelRecording(); break;
        case 'runFlow': handleRunFlow(request.name); break;
        case 'displayFlow': handleDisplayFlow(request.name); break;
        case 'deleteFlow': handleDeleteFlow(request.name); break;
        case 'getFlows':
            loadSavedFlows().then(sendResponse);
            return true; // Keep channel open for async response
    }
    return false;
});


// =================================================================================
//                          CORE LOGIC FUNCTIONS
// =================================================================================

function updateIcon(activeTabId) {
    if (isRecording) {
        const iconPath = (activeTabId === recordingTabId) ? "icons/icon48.png" : "icons/icon_disabled.png";
        const badgeColor = (activeTabId === recordingTabId) ? '#FF0000' : '#808080';
        chrome.action.setIcon({ path: iconPath });
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    } else {
        chrome.action.setIcon({ path: "icons/icon48.png" });
        chrome.action.setBadgeText({ text: '' });
    }
}

async function handleStartRecording() {
    if (isRecording) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
        log("Error: No active tab found.");
        return;
    }

    isRecording = true;
    recordingTabId = tab.id;
    recordedSteps = [{ type: "goto", url: tab.url, frameId: 0 }];
    lastActionTimestamp = Date.now();
    log(`Recording started on tab ${tab.id}`);

    updateIcon(tab.id);
    chrome.runtime.sendMessage({ type: "recordingStateChanged", isRecording: true, steps: recordedSteps });
}

function handleRecordAction(action, sender) {
    const now = Date.now();
    // Add a wait step if there was a pause between actions
    if (now - lastActionTimestamp > 100) {
        recordedSteps.push({ type: 'wait', duration: now - lastActionTimestamp });
    }

    // Add the frameId from the sender to the recorded step
    const step = { ...action, frameId: sender.frameId };
    recordedSteps.push(step);
    lastActionTimestamp = now;
    log('Step added:', step);

    // Update the side panel with the new step
    chrome.runtime.sendMessage({ type: 'updateLiveSteps', steps: recordedSteps });
}

async function handleStopRecordingAndSave(flowName) {
    if (!isRecording) return;
    const savedFlows = await loadSavedFlows();
    savedFlows[flowName] = recordedSteps;
    await chrome.storage.local.set({ flows: savedFlows });
    log(`Flow saved as "${flowName}"`);
    resetState();
}

function handleCancelRecording() {
    if (!isRecording) return;
    log("Cancelling recording...");
    
    // We set isRecording to false immediately to stop further actions from being recorded.
    isRecording = false;

    // But we wait a moment before clearing the data and icon,
    // to ensure any last-second 'updateLiveSteps' message has time to be processed by the side panel.
    setTimeout(() => {
        resetState();
        log("State has been reset after a short delay.");
    }, 100); // 100ms delay
}


function resetState() {
    const wasRecordingTabId = recordingTabId;
    isRecording = false; // Ensure it's false
    recordedSteps = [];
    recordingTabId = null;
    lastActionTimestamp = 0;
    
    log("Global state has been fully reset.");
    updateIcon(wasRecordingTabId); // Reset icon state
    
    // Notify UI that state is definitively reset
    chrome.runtime.sendMessage({ type: "recordingStateChanged", isRecording: false, steps: [] });
    chrome.runtime.sendMessage({ type: "flowsUpdated" });
}

async function handleRunFlow(flowName) {
    log(`Attempting to run flow: "${flowName}"`);
    const savedFlows = await loadSavedFlows();
    const steps = savedFlows[flowName];
    if (!steps || steps.length === 0) { log(`Error: Flow not found.`); return; }
    
    const initialStep = steps[0];
    if (initialStep.type !== 'goto') { log('Error: Flow must start with a "goto".'); return; }

    try {
        const tab = await chrome.tabs.create({ url: initialStep.url, active: true });
        
        const listener = async (tabId, info) => {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                log(`Tab ${tab.id} loaded. Injecting replay script into all frames.`);
                
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    files: ['replay_script.js']
                });

                log('Replay script injected. Starting step-by-step execution.');
                
                for (const step of steps.slice(1)) {
                    log('Orchestrating step:', step);
                    
                    if (step.type === 'wait') {
                        // Honor the recorded wait time
                        await new Promise(resolve => setTimeout(resolve, step.duration));
                        continue;
                    }
                    
                    try {
                        const response = await chrome.tabs.sendMessage(tab.id, {
                            type: 'executeSingleStep',
                            step: step
                        }, {
                            frameId: step.frameId || 0
                        });

                        if (response && response.status === 'error') {
                            throw new Error(response.message); // Stop the loop on error from script
                        }

                    } catch (error) {
                        log(`Failed to send message to frame or it failed. Error: ${error.message}`);
                        log(`Stopping flow due to error.`);
                        await chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            func: (msg) => alert(`Replay failed at step: ${JSON.stringify(step)}\nError: ${msg}`),
                            args: [error.message]
                        });
                        return; // Stop the entire flow
                    }

                    // *** THE KEY CHANGE: Add a fixed delay between steps ***
                    // This gives the web page time to react to the previous action.
                    // 500ms is a good starting point.
                    log(`Waiting 500ms for page to stabilize...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                log('Flow execution finished successfully.');
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => alert('Replicate Operator: Flow replay completed!'),
                });
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    } catch (error) {
        log('Error during handleRunFlow setup:', error);
    }
}

async function handleDisplayFlow(flowName) {
    const savedFlows = await loadSavedFlows();
    const steps = savedFlows[flowName];
    if (!steps) return;
    const stepsJsonString = JSON.stringify(steps, null, 2);
    const content = `<!DOCTYPE html><html><head><title>Flow: ${flowName}</title><style>body{font-family:monospace;background-color:#1e1e1e;color:#d4d4d4;padding:20px}h1{color:#569cd6}pre{white-space:pre-wrap;word-wrap:break-word;font-size:14px}</style></head><body><h1>Flow Details: ${flowName}</h1><pre>${stepsJsonString}</pre></body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
    await chrome.tabs.create({ url: dataUrl });
}

async function handleDeleteFlow(flowName) {
    const savedFlows = await loadSavedFlows();
    delete savedFlows[flowName];
    await chrome.storage.local.set({ flows: savedFlows });
    chrome.runtime.sendMessage({ type: "flowsUpdated" });
}

async function loadSavedFlows() {
    const result = await chrome.storage.local.get('flows');
    return result.flows || {};
}