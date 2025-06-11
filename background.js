// =================================================================================
// Replicate Operator - background.js (Complete with Ping-Pong Injection Logic)
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
});

// --- Main Message Hub ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Message received. Type: "${request.type}"`, 'Request:', request);

    // Respond to pings from our own check
    if (request.type === 'ping') {
        log(`Received PING from a content script, sending PONG back. Sender Tab:`, sender.tab?.id);
        sendResponse({ status: 'pong' });
        return true;
    }

    // Handle all other actions
    switch (request.type) {
        case 'startRecording':
            handleStartRecording();
            break;
        case 'recordAction':
            handleRecordAction(request.action);
            break;
        case 'stopRecordingAndSave':
            handleStopRecordingAndSave(request.name);
            break;
        case 'cancelRecording':
            handleCancelRecording();
            break;
        case 'getFlows':
            loadSavedFlows().then(sendResponse);
            return true; // Required for async sendResponse.
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

// --- Tab Closure Listener ---
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recordingTabId && isRecording) {
        log(`Recording tab ${tabId} was closed. Cancelling recording.`);
        handleCancelRecording();
    }
});

// --- Tab Navigation Listener ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === recordingTabId && changeInfo.status === 'complete' && isRecording) {
        log(`Recording tab ${tabId} updated. Checking if injection is needed.`);
        injectScriptWithCheck(tabId);
    }
});


// =================================================================================
//                          CORE LOGIC FUNCTIONS
// =================================================================================

// --- Smart Script Injection Function ---
async function injectScriptWithCheck(tabId) {
    log(`[injectScriptWithCheck] Checking tab ${tabId} for existing script.`);
    try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
        if (response && response.status === 'pong') {
            log(`[injectScriptWithCheck] Pong received. Script is already active on tab ${tabId}. No injection needed.`);
            return;
        }
    } catch (error) {
        log(`[injectScriptWithCheck] No pong received (or error: "${error.message}"). This is expected. Injecting script into tab ${tabId}.`);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content_script.js']
            });
            log(`[injectScriptWithCheck] Script injected successfully into tab ${tabId}.`);
        } catch (injectionError) {
            log(`[injectScriptWithCheck] CRITICAL: Failed to inject script into tab ${tabId}:`, injectionError);
        }
    }
}

// --- Start Recording ---
async function handleStartRecording() {
    if (isRecording) { log('Start recording called, but already recording. Ignoring.'); return; }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { log("Error: Could not find an active tab."); return; }
    log(`Starting recording on tab ${tab.id} at URL: ${tab.url}`);

    isRecording = true;
    recordingTabId = tab.id;
    recordedSteps = [];
    lastActionTimestamp = Date.now();
    
    recordedSteps.push({ type: 'goto', url: tab.url });
    log('Initial "goto" step added.');

    await injectScriptWithCheck(tab.id);

    log('Notifying side panel: recording has started.');
    chrome.runtime.sendMessage({ type: 'recordingStateChanged', isRecording: true, steps: recordedSteps });
}

// --- Record a Single Action ---
function handleRecordAction(action) {
    log(`handleRecordAction called. Current state: isRecording=${isRecording}.`);
    if (!isRecording) { log('Action received, but not in recording state. Ignoring.', action); return; }
    const now = Date.now();
    const waitDuration = now - lastActionTimestamp;
    if (waitDuration > 100) {
        const waitStep = { type: 'wait', duration: waitDuration };
        recordedSteps.push(waitStep);
        log('Wait step added:', waitStep);
    }
    recordedSteps.push(action);
    lastActionTimestamp = now;
    log('Action step added. Total steps:', recordedSteps.length, 'New step:', action);
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
    if (!steps || steps.length === 0) { log(`Error: Flow "${flowName}" not found or is empty.`); return; }
    log(`Flow "${flowName}" found with ${steps.length} steps.`);
    const initialStep = steps[0];
    if (initialStep.type !== 'goto') { log('Error: Flow must start with a "goto" step.'); return; }
    try {
        log(`Creating new tab for goto: ${initialStep.url}`);
        const tab = await chrome.tabs.create({ url: initialStep.url, active: true });
        log(`New tab created with ID: ${tab.id}. Waiting for it to load...`);
        const listener = (tabId, info) => {
            if (info.status === 'complete' && tabId === tab.id) {
                log(`Tab ${tab.id} is fully loaded. Injecting replay script.`);
                chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['replay_script.js'] }, () => {
                    if (chrome.runtime.lastError) { log('Error injecting replay_script.js:', chrome.runtime.lastError.message); return; }
                    log('Replay script injected. Sending steps to execute.');
                    chrome.tabs.sendMessage(tab.id, { type: 'executeFlow', steps: steps.slice(1) });
                });
                chrome.tabs.onUpdated.removeListener(listener);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    } catch (error) { log('Error during handleRunFlow:', error); }
}

// --- Display a Saved Flow ---
async function handleDisplayFlow(flowName) {
    log(`Attempting to display flow: "${flowName}"`);
    const savedFlows = await loadSavedFlows();
    const steps = savedFlows[flowName];
    if (!steps) { log(`Error: Flow "${flowName}" not found.`); return; }
    log(`Flow "${flowName}" found with ${steps.length} steps.`);
    const stepsJsonString = JSON.stringify(steps, null, 2);
    const content = `<!DOCTYPE html><html><head><title>Flow: ${flowName}</title><style>body { font-family: monospace; background-color: #1e1e1e; color: #d4d4d4; padding: 20px; } h1 { color: #569cd6; } pre { white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }</style></head><body><h1>Flow Details: ${flowName}</h1><pre>${stepsJsonString}</pre></body></html>`;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
    try {
        log('Creating new tab to display flow content.');
        await chrome.tabs.create({ url: dataUrl });
        log('Tab for displaying flow should be open.');
    } catch (error) { log('Error creating tab for display flow:', error); }
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
    isRecording = false;
    recordedSteps = [];
    recordingTabId = null;
    lastActionTimestamp = 0;
}