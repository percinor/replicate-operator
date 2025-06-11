// This script is injected into a new tab to replay a recorded flow.

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.type === 'executeFlow') {
        const steps = request.steps;
        console.log('Starting flow execution...', steps);
        
        for (const step of steps) {
            try {
                console.log('Executing step:', step);
                await executeStep(step);
            } catch (error) {
                console.error('Failed to execute step:', step, error);
                alert(`Replay failed at step: ${JSON.stringify(step)}\nError: ${error.message}`);
                return; // Stop execution on error
            }
        }
        console.log('Flow execution finished.');
        alert('Flow replay completed successfully!');
    }
});

function executeStep(step) {
    return new Promise((resolve, reject) => {
        switch(step.type) {
            case 'wait':
                setTimeout(resolve, step.duration);
                break;
            case 'click': {
                const element = document.querySelector(step.selector);
                if (element) {
                    element.click();
                    resolve();
                } else {
                    reject(new Error(`Element not found for selector: ${step.selector}`));
                }
                break;
            }
            case 'change': {
                const element = document.querySelector(step.selector);
                if (element) {
                    element.value = step.value;
                    // Dispatch events to ensure frameworks like React update their state
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                    resolve();
                } else {
                    reject(new Error(`Element not found for selector: ${step.selector}`));
                }
                break;
            }
            default:
                console.warn('Unknown step type:', step.type);
                resolve(); // Resolve to continue even if step is unknown
        }
    });
}