// =================================================================================
// Replicate Operator - replay_script.js (Final Frame-Aware Replay)
// =================================================================================

console.log(`Replicate Operator: Replay script injected in frame: ${window.location.href}. Ready for commands.`);

// This listener is key. EACH frame will have this listener.
// But only the one matching the frameId from the background will execute the step.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // We don't need to check the frameId here, because background.js already sent the message
    // to the correct frame. If this script receives the message, it IS the correct frame.
    if (request.type === 'executeSingleStep') {
        const step = request.step;
        console.log(`%c[Replay] Executing step in this frame (frameId match):`, 'background: #222; color: #bada55', step);
        
        executeStep(step)
            .then(result => {
                sendResponse({ status: 'success', result: result });
            })
            .catch(error => {
                console.error('[Replay] Failed to execute step:', step, error);
                sendResponse({ status: 'error', message: error.message });
            });

        return true; // Indicates an asynchronous response.
    }
});

// --- Smart Wait Function (No changes needed) ---
function waitForElement(selector, timeout = 7000) { // Increased timeout to 7 seconds
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const intervalId = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(intervalId);
                console.log(`[Replay] Element found for selector: ${selector}`);
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(intervalId);
                reject(new Error(`Element not found for selector: ${selector}`));
            }
        }, 100);
    });
}


// --- executeStep (No changes needed in logic, but its context is now correct) ---
async function executeStep(step) {
    const element = await waitForElement(step.selector);
    
    switch(step.type) {
        case 'click':
            element.click();
            break;
        case 'change':
            if (typeof element.value !== 'undefined') {
                element.value = step.value;
            } else if (element.isContentEditable) {
                element.innerText = step.value;
            } else {
                throw new Error(`Cannot set value on a non-input, non-contenteditable element.`);
            }
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
            break;
        default:
            console.warn('Unknown step type during replay:', step.type);
    }
}