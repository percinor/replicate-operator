// =================================================================================
// Replicate Operator - content_script.js (Final "Mousedown-is-King" Model)
// =================================================================================

if (window.replicateOperatorHasRun) {
    // Guard against double execution
} else {
    window.replicateOperatorHasRun = true;
    console.log(`%c[CS] Replicate Operator: Script active in frame: ${window.location.href}`, 'background: #222; color: #bada55');

    // --- UTILITIES (Safe and Correct) ---
    function sendMessage(action) { try { if (chrome.runtime && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: 'recordAction', action: action }); } catch (e) {} }
    function getSelector(element) {
        if (!element) return '';
        if (element.id) return `#${CSS.escape(element.id)}`;
        const stableAttrs = ['data-testid', 'name', 'aria-label', 'placeholder', 'title', 'alt'];
        for (const attr of stableAttrs) {
            const attrValue = element.getAttribute(attr);
            if (attrValue) {
                const selector = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(attrValue)}"]`;
                try { if (document.querySelectorAll(selector).length === 1) return selector; } catch (e) {}
            }
        }
        let path = '';
        let currentElement = element;
        while (currentElement && currentElement.parentElement && currentElement.tagName.toLowerCase() !== 'body') {
            if (currentElement.id) { path = `#${CSS.escape(currentElement.id)}` + path; break; }
            let siblingIndex = 1;
            let sibling = currentElement.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === currentElement.tagName) { siblingIndex++; }
                sibling = sibling.previousElementSibling;
            }
            const tagName = currentElement.tagName.toLowerCase();
            const nthChild = `:nth-of-type(${siblingIndex})`;
            path = ` > ${tagName}${nthChild}` + path;
            currentElement = currentElement.parentElement;
        }
        return `body${path}`.trim();
    }
    
    // --- CORE LOGIC ---
    const lastRecordedValue = new Map();

    function recordInputChange(target) {
        if (!target) return;
        let value;
        if (target.isContentEditable) { value = target.innerText; }
        else if (typeof target.value !== 'undefined') { value = target.value; }
        else { return; }
        if (lastRecordedValue.get(target) !== value) {
            console.log(`%c[CS] Input change recorded. Value: "${value}"`, 'color: orange');
            sendMessage({ type: 'change', selector: getSelector(target), value: value });
            lastRecordedValue.set(target, value);
        }
    }

    // --- The All-in-One Mousedown Handler ---
    function onMouseDown(event) {
        const target = event.composedPath()[0];
        const activeElement = document.activeElement;

        // Step 1: Check if the click is happening away from an active input.
        // This MUST happen first, as this is our only chance to get the correct input value.
        if (activeElement && activeElement !== target && (activeElement.isContentEditable || ['INPUT', 'TEXTAREA'].includes(activeElement.tagName))) {
            console.log(`%c[CS] Mousedown away from input. Saving input state.`, 'color: magenta');
            recordInputChange(activeElement);
        }
        
        // Step 2: Immediately record the mousedown event as a 'click' action.
        // We trust the mousedown target, not the click target.
        console.log(`%c[CS] Mousedown detected, recording as click on target:`, 'color: green', target);
        sendMessage({
            type: 'click',
            selector: getSelector(target),
            label: target.innerText?.trim().substring(0, 50) || ''
        });
    }

    // --- ATTACH THE SINGLE, MOST IMPORTANT LISTENER ---
    document.addEventListener('mousedown', onMouseDown, { capture: true });

    console.log("[CS] Final 'Mousedown-is-King' listener is active.");
}