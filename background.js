// =================================================================================
// Replicate Operator - background.js (Complete with Strict Tab Binding & Icon Updates)
// =================================================================================

// --- Global State ---
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

// --- Extension Icon Clicked ---
chrome.action.onClicked.addListener((tab) => {
    log('Extension icon clicked, opening side panel.');
    chrome.sidePanel.open({ windowId: tab.windowId });
    updateIcon(tab.id); // Update icon based on the current tab's state
});

// --- Main Message Hub ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Message received. Type: "${request.type}"`, 'From Tab:', sender.tab?.id, 'Request:', request);

    if (request.type === 'ping') {
        log(`Received PING, sending PONG back.`);
        sendResponse({ status: 'pong' });
        return true;
    }

    switch (request.type) {
        case 'startRecording':
            handleStartRecording();
            break;
        case 'recordAction':
            handleRecordAction(request.action, sender);
            break;
        case 'stopRecordingAndSave':
            handleStopRecordingAndSave(request.name);
            break;
        case 'cancelRecording':
            handleCancelRecording();
            break;
        case 'getFlows':
            loadSavedFlows().then(sendResponse);
            return true;
        case 'runFlow':
            handleRunFlow(request.name);
            break;
        case 'displayFlow':
            handleDisplayFlow(request.name);
            break;
        case 'deleteFlow':
            handleDeleteFlow(request.name);
            break;
        default:
            log(`Warning: Unhandled message type "${request.type}"`);
    }
});


// --- Tab Activation Listener (for icon updates) ---
chrome.tabs.onActivated.addListener(activeInfo => {
    updateIcon(activeInfo.tabId);
});

// --- Tab Update Listener (for navigation and icon updates) ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status) { // Any status change (loading, complete) can affect the icon
        updateIcon(tabId);
    }
    if (tabId === recordingTabId && changeInfo.status === 'complete' && isRecording) {
        log(`Recording tab ${tabId} updated. Checking if injection is needed.`);
        injectScriptWithCheck(tabId);
    }
});

// --- Tab Closure Listener ---
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recordingTabId && isRecording) {
        log(`Recording tab ${tabId} was closed. Cancelling recording.`);
        handleCancelRecording();
    }
});

// =================================================================================
//                          CORE LOGIC FUNCTIONS
// =================================================================================

// --- Icon Update Function ---
function updateIcon(activeTabId) {
    if (isRecording) {
        if (activeTabId === recordingTabId) {
            chrome.action.setIcon({ path: "icons/icon48.png" });
            chrome.action.setBadgeText({ text: 'REC' });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        } else {
            // Assumes you have a grayscale icon named 'icon_disabled.png' in the 'icons' folder
            chrome.action.setIcon({ path: "icons/icon_disabled.png" });
            chrome.action.setBadgeText({ text: 'REC' });
            chrome.action.setBadgeBackgroundColor({ color: '#808080' });
        }
    } else {
        chrome.action.setIcon({ path: "icons/icon48.png" });
        chrome.action.setBadgeText({ text: '' });
    }
}

// --- Smart Script Injection Function ---
async function injectScriptWithCheck(tabId) {
    log(`[injectScriptWithCheck] Checking tab ${tabId} for existing script.`);
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
        if (response && response.status === 'pong') {
            log(`[injectScriptWithCheck] Pong received. Script is already active.`);
            return;
        }
    } catch (error) {
        log(`[injectScriptWithCheck] No pong received, injecting script.`);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content_script.js']
            });
            log(`[injectScriptWithCheck] Script injected successfully.`);
        } catch (injectionError) {
            log(`[injectScriptWithCheck] CRITICAL: Failed to inject script:`, injectionError);
        }
    }
}

// --- Start Recording ---
async function handleStartRecording() {
    if (isRecording) {
        log('Start recording called, but already recording. Ignoring.');
        return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
        log("Error: Could not find an active tab.");
        return;
    }
    
    log(`Starting recording on tab ${tab.id} at URL: ${tab.url}`);
    isRecording = true;
    recordingTabId = tab.id;
    recordedSteps = [{ type: 'goto', url: tab.url }];
    lastActionTimestamp = Date.now();
    
    await injectScriptWithCheck(tab.id);
    updateIcon(tab.id);
    
    log('Notifying side panel: recording has started.');
    chrome.runtime.sendMessage({ type: 'recordingStateChanged', isRecording: true, steps: recordedSteps });
}

// --- Record a Single Action ---
function handleRecordAction(action, sender) {
    if (!isRecording || !sender.tab || sender.tab.id !== recordingTabId) {
        log(`Ignoring action from wrong tab. Expected: ${recordingTabId}, Got: ${sender.tab.id}`);
        return;
    }

    log(`handleRecordAction called for the correct tab.`);
    const now = Date.now();
    const waitDuration = now - lastActionTimestamp;
    
    if (waitDuration > 100) {
        recordedSteps.push({ type: 'wait', duration: waitDuration });
    }
    
    recordedSteps.push(action);
    lastActionTimestamp = now;
    log('Action step added. Total steps:', recordedSteps.length);

    chrome.runtime.sendMessage({ type: 'updateLiveSteps', steps: recordedSteps });
}

// --- Stop Recording and Save ---
async function handleStopRecordingAndSave(flowName) {
    if (!isRecording) return;
    log(`Stopping and saving flow with name: "${flowName}"`);
    const savedFlows = await loadSavedFlows();
    savedFlows[flowName] = recordedSteps;
    await chrome.storage.local.set({ flows: savedFlows });
    resetState();
    chrome.runtime.sendMessage({ type: 'recordingStateChanged', isRecording: false, steps: [] });
    chrome.runtime.sendMessage({ type: 'flowsUpdated' });
}

// --- Cancel Recording ---
function handleCancelRecording() {
    if (!isRecording && recordedSteps.length === 0) return;
    log('Cancelling current recording.');
    resetState();
    chrome.runtime.sendMessage({ type: 'recordingStateChanged', isRecording: false, steps: [] });
}

// --- Run a Saved Flow ---
async function handleRunFlow(flowName) {
    log(`Attempting to run flow: "${flowName}"`);
    const savedFlows = await loadSavedFlows();
    const steps = savedFlows[flowName];
    if (!steps || steps.length === 0) {
        log(`Error: Flow "${flowName}" not found or is empty.`);
        return;
    }
    const initialStep = steps[0];
    if (initialStep.type !== 'goto') {
        log('Error: Flow must start with a "goto" step.');
        return;
    }
    try {
        log(`Creating new tab for goto: ${initialStep.url}`);
        const tab = await chrome.tabs.create({ url: initialStep.url, active: true });
        const listener = (tabId, info) => {
            if (info.status === 'complete' && tabId === tab.id) {
                log(`Tab ${tab.id} is loaded. Injecting replay script.`);
                chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['replay_script.js'] }, () => {
                    if (chrome.runtime.lastError) {
                        log("Error injecting replay_script.js:", chrome.runtime.lastError.message);
                        return;
                    }
                    log('Replay script injected. Sending steps to execute.');
                    chrome.tabs.sendMessage(tab.id, { type: 'executeFlow', steps: steps.slice(1) });
                });
                chrome.tabs.onUpdated.removeListener(listener);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    } catch (error) {
        log('Error during handleRunFlow:', error);
    }
}

// --- Display a Saved Flow ---
async function handleDisplayFlow(flowName) {
    log(`Attempting to display flow: "${flowName}"`);
    const savedFlows = await loadSavedFlows();
    const steps = savedFlows[flowName];
    if (!steps) {
        log(`Error: Flow "${flowName}" not found.`);
        return;
    }
    const stepsJsonString = JSON.stringify(steps, null, 2);
    const content = `<!DOCTYPE html><html><head><title>Flow: ${flowName}</title><style>body { font-family: monospace; background-color: #1e1e1e; color: #d4d4d4; padding: 20px; } h1 { color: #569cd6; } pre { white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }</style></head><body><h1>Flow Details: ${flowName}</h1><pre>${stepsJsonString}</pre></body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
    try {
        await chrome.tabs.create({ url: dataUrl });
    } catch (error) {
        log('Error creating tab for display flow:', error);
    }
}

// --- Delete a Saved Flow ---
async function handleDeleteFlow(flowName) {
    log(`Deleting flow: "${flowName}"`);
    const savedFlows = await loadSavedFlows();
    delete savedFlows[flowName];
    await chrome.storage.local.set({ flows: savedFlows });
    chrome.runtime.sendMessage({ type: 'flowsUpdated' });
}

// --- HELPER FUNCTIONS ---
async function loadSavedFlows() {
    const result = await chrome.storage.local.get('flows');
    return result.flows || {};
}

function resetState() {
    log('Resetting global state.');
    const previouslyRecordingTab = recordingTabId;
    isRecording = false;
    recordedSteps = [];
    recordingTabId = null;
    lastActionTimestamp = 0;
    
    // After state is reset, update the icon for the tab that was active
    if (previouslyRecordingTab) {
        updateIcon(previouslyRecordingTab);
    }
    // Also, reset the badge globally just in case.
    chrome.action.setBadgeText({ text: '' });
}