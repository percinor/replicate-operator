// =================================================================================
// Replicate Operator - content_script.js (Final Corrected Version)
// =================================================================================

// The injection guard now acts purely as a fallback.
if (window.replicateOperatorInjected) {
    console.warn("Replicate Operator: Duplicate script execution halted. The ping-pong mechanism should handle this.");
} else {
    // Mark this instance as injected immediately.
    window.replicateOperatorInjected = true;
    console.log("Replicate Operator: Content script successfully injected and is now listening.");

    // --- PING-PONG LISTENER ---
    const pingListener = (request, sender, sendResponse) => {
        if (request.type === 'ping') {
            console.log("Replicate Operator: Received PING, sending PONG.");
            sendResponse({ status: 'pong' });
            return true;
        }
    };
    chrome.runtime.onMessage.addListener(pingListener);

    // --- DEBOUNCE UTILITY ---
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }

    // --- HELPER: sendMessageToBackground (REFINED) ---
    // This version is more robust against context invalidation errors.
    function sendMessageToBackground(message) {
        try {
            // Check if runtime and sendMessage are available before calling
            if (chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage(message);
            }
        } catch (error) {
            // This error is expected during page navigation/reloads.
            // We just log it and do nothing else. The background script will handle re-injection.
            if (error.message.includes("Extension context invalidated")) {
                console.warn(`Replicate Operator: Context was invalidated while trying to send a message. This is normal during page transitions.`);
                // *** CRITICAL: DO NOT remove listeners here. ***
            } else {
                console.error("Replicate Operator: An unexpected error occurred while sending a message:", error);
            }
        }
    }

    // --- CORE EVENT HANDLERS ---
    
    // Records the final value of an input field.
    function recordInputChange(target) {
        if (!target) return;
        console.log(`%cRecording input change for:`, 'color: lightgreen;', target);
        const action = {
            type: 'change',
            selector: getSelector(target),
            value: target.value
        };
        sendMessageToBackground({ type: 'recordAction', action: action });
    }

    // Debounced version for frequent 'input' events.
    const debouncedRecordInputChange = debounce(recordInputChange, 500);

    // Handles typing in input fields.
    function handleInput(event) {
        const target = event.target;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        console.log(`%cINPUT event detected`, 'color: skyblue;', 'Target:', target);
        debouncedRecordInputChange(target);
    }
    
    // Handles when an input field loses focus.
    function handleBlur(event) {
        const target = event.target;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        
        // Cancel any pending debounced call to avoid double-recording.
        debouncedRecordInputChange.toString(); // This is a trick to access the timeout variable if it were exposed.
                                                // Since it's not, the better way is to call it directly.
                                                // The debounce implementation will clear the previous timeout.
                                                // But let's be explicit and just record it.
                                                
        console.log(`%cBLUR event detected`, 'color: orange; font-weight: bold;', 'Target:', target);
        // Record immediately on blur.
        recordInputChange(target);
    }
    
    // Handles clicks on interactive elements.
    function handleClick(event) {
        // Debounce might have a pending input change, so let's record it first if the click is outside the input
        if(document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement !== event.target){
            recordInputChange(document.activeElement);
        }

        if (!event.view || event.view.location.protocol === 'chrome-extension:') return;
        if (!isValidClickTarget(event.target)) return;
        
        const action = {
            type: 'click',
            selector: getSelector(event.target),
            label: event.target.innerText ? event.target.innerText.trim().substring(0, 50) : ''
        };
        sendMessageToBackground({ type: 'recordAction', action: action });
    }


    // --- ADD EVENT LISTENERS ---
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('blur', handleBlur, true);
    console.log("Replicate Operator: 'click', 'input', and 'blur' event listeners are now active.");

    // --- HELPER FUNCTIONS (CORRECTED AND UN-MINIFIED) ---

    function getSelector(element) {
        if (!element) return '';
        if (element.id) return `#${element.id}`;
        
        const uniqueAttrs = ['data-testid', 'name'];
        for (const attr of uniqueAttrs) {
            const attrValue = element.getAttribute(attr);
            if (attrValue) {
                const selector = `${element.tagName.toLowerCase()}[${attr}="${attrValue}"]`;
                if (document.querySelectorAll(selector).length === 1) {
                    return selector;
                }
            }
        }
        
        let path = '';
        let current = element;
        while (current && current.parentElement) {
            let siblingIndex = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === current.tagName) {
                    siblingIndex++;
                }
                sibling = sibling.previousElementSibling;
            }
            const tagName = current.tagName.toLowerCase();
            const nthChild = `:nth-of-type(${siblingIndex})`;
            path = ` > ${tagName}${nthChild}` + path;
            current = current.parentElement;
            if (current.tagName.toLowerCase() === 'body') break;
        }
        return `body ${path}`.trim();
    }

    function isValidClickTarget(element) {
        if (!element) return false;
        const clickableTags = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LI', 'SUMMARY'];
        const clickableRoles = ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch'];
        if (clickableTags.includes(element.tagName)) {
            if (element.tagName === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'image'].includes(element.type)) {
                // It's a text-like input, click is less important than change.
            }
            return true;
        }
        const role = element.getAttribute('role');
        if (role && clickableRoles.includes(role.toLowerCase())) {
            return true;
        }
        if (element.hasAttribute('onclick') || element.hasAttribute('jsaction')) {
            return true;
        }
        let parent = element.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
            if (clickableTags.includes(parent.tagName) || (parent.getAttribute('role') && clickableRoles.includes(parent.getAttribute('role')))) {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }
}