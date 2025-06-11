// =================================================================================
// Replicate Operator - sidepanel.js (Complete & Refined Code)
// =================================================================================

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const initialView = document.getElementById('initial-view');
    const recordingView = document.getElementById('recording-view');
    const startBtn = document.getElementById('start-recording-btn');
    const finishBtn = document.getElementById('finish-save-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const liveStepsList = document.getElementById('live-steps-list');
    const savedFlowsList = document.getElementById('saved-flows-list');
    const runBtn = document.getElementById('run-flow-btn');
    const displayBtn = document.getElementById('display-flow-btn');
    const deleteBtn = document.getElementById('delete-flow-btn');

    // =================================================================================
    //                          EVENT LISTENERS
    // =================================================================================

    // --- Button Click Listeners ---
    startBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'startRecording' });
    });

    finishBtn.addEventListener('click', () => {
        const defaultName = `OperateFlow-${new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '')}`;
        const flowName = prompt('Enter a name for this flow:', defaultName);
        if (flowName) {
            // Future improvement: check for duplicate names before sending.
            chrome.runtime.sendMessage({ type: 'stopRecordingAndSave', name: flowName });
        }
    });

    cancelBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'cancelRecording' });
    });

    runBtn.addEventListener('click', () => {
        const selectedFlow = getSelectedFlowName();
        if (selectedFlow) {
            chrome.runtime.sendMessage({ type: 'runFlow', name: selectedFlow });
        }
    });

    displayBtn.addEventListener('click', () => {
        const selectedFlow = getSelectedFlowName();
        if (selectedFlow) {
            chrome.runtime.sendMessage({ type: 'displayFlow', name: selectedFlow });
        }
    });
    
    deleteBtn.addEventListener('click', () => {
        const selectedFlow = getSelectedFlowName();
        if (selectedFlow && confirm(`Are you sure you want to delete "${selectedFlow}"?`)) {
            chrome.runtime.sendMessage({ type: 'deleteFlow', name: selectedFlow });
        }
    });

    // --- *** FIX: EVENT DELEGATION FOR SAVED FLOWS LIST *** ---
    // This single listener is attached to the parent container.
    // It will handle 'change' events from any radio button added now or in the future.
    savedFlowsList.addEventListener('change', (event) => {
        // Check if the event was triggered by a radio button.
        if (event.target.name === 'saved-flow') {
            updateActionButtonsState();
        }
    });

    // --- Message Listener from Background Script ---
    chrome.runtime.onMessage.addListener((request) => {
        if (request.type === 'recordingStateChanged') {
            toggleViews(request.isRecording);
            updateLiveSteps(request.steps);
        } else if (request.type === 'updateLiveSteps') {
            updateLiveSteps(request.steps);
        } else if (request.type === 'flowsUpdated') {
            updateSavedFlowsList();
        } else if (request.type === 'showError') {
            alert(request.message);
        }
    });

    // =================================================================================
    //                          UI UPDATE FUNCTIONS
    // =================================================================================

    function toggleViews(isRecording) {
        initialView.classList.toggle('hidden', isRecording);
        recordingView.classList.toggle('hidden', !isRecording);
    }

    function updateLiveSteps(steps = []) {
        liveStepsList.innerHTML = '';
        steps.forEach(step => {
            const li = document.createElement('li');
            li.textContent = formatStep(step);
            liveStepsList.appendChild(li);
        });
    }

    // This function now only focuses on rendering the list.
    function updateSavedFlowsList() {
        chrome.runtime.sendMessage({type: 'getFlows'}, (flows) => {
            savedFlowsList.innerHTML = ''; // Clear previous list
            const flowNames = Object.keys(flows);
            
            if (flowNames.length === 0) {
                savedFlowsList.innerHTML = '<p style="font-style: italic; color: #666;">No saved flows yet.</p>';
            } else {
                flowNames.forEach(name => {
                    const div = document.createElement('div');
                    div.className = 'flow-item';
                    // Using template literals for cleaner HTML string
                    div.innerHTML = `
                        <input type="radio" id="flow-${name}" name="saved-flow" value="${name}">
                        <label for="flow-${name}">${name}</label>
                    `;
                    savedFlowsList.appendChild(div);
                });
            }
            // After updating the list, ensure buttons are in the correct state.
            updateActionButtonsState();
        });
    }

    // --- *** NEW/REFACTORED HELPER FUNCTIONS *** ---
    
    // Centralized function to enable/disable action buttons.
    function updateActionButtonsState() {
        const isSelected = !!getSelectedFlowName();
        runBtn.disabled = !isSelected;
        displayBtn.disabled = !isSelected;
        deleteBtn.disabled = !isSelected;
    }

    // Helper to get the currently selected flow's name.
    function getSelectedFlowName() {
        const selectedRadio = document.querySelector('input[name="saved-flow"]:checked');
        return selectedRadio ? selectedRadio.value : null;
    }

    function formatStep(step) {
        switch(step.type) {
            case 'goto': return `Navigate to: ${step.url.substring(0, 40)}...`;
            case 'wait': return `Wait for ${step.duration}ms`;
            case 'click': return `Click on: ${step.selector}`;
            case 'change': return `Change input ${step.selector} to: "${step.value}"`;
            default: return JSON.stringify(step);
        }
    }

    // --- Initial Load ---
    updateSavedFlowsList();
});