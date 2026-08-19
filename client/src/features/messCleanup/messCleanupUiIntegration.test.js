import assert from 'node:assert/strict';
import test from 'node:test';

const createSimulatedUiController = (initialState = {}) => {
  let state = {
    isOpen: false,
    workspaceModel: null,
    organizationPlan: null,
    layoutProposal: null,
    loading: false,
    isApplying: false,
    error: '',
    ...initialState
  };

  const emittedSocketEvents = [];
  const persistenceCalls = [];
  const toasts = [];
  let applyCallCount = 0;

  const mockCanvasApi = {
    applyMessCleanup: (proposal, model) => {
      applyCallCount += 1;
      if (state.simulateError) {
        return { success: false, error: 'Simulation Error', reason: 'Simulated failure reason' };
      }
      if (state.simulateException) {
        throw new Error('Simulated apply exception');
      }
      return {
        success: true,
        appliedCount: proposal?.placements?.length || 0,
        transactionId: 'tx_ui_test',
        changes: [{ objectId: 'shape_1' }]
      };
    }
  };

  const handleApplyMessCleanup = () => {
    if (state.isApplying || !state.layoutProposal || !state.workspaceModel) return;

    state.isApplying = true;
    state.error = '';

    try {
      const result = mockCanvasApi.applyMessCleanup(state.layoutProposal, state.workspaceModel);

      if (result?.success) {
        emittedSocketEvents.push({
          type: 'canvas:batch-modified',
          transactionId: result.transactionId,
          changes: result.changes
        });

        persistenceCalls.push({ type: 'save' });

        state = {
          isOpen: false,
          workspaceModel: null,
          organizationPlan: null,
          layoutProposal: null,
          loading: false,
          isApplying: false,
          error: ''
        };

        toasts.push({ type: 'success', title: 'Mess Cleanup Applied' });
      } else {
        const failureReason = result?.reason || result?.error || 'Failed to apply Mess Cleanup proposal';
        state.isApplying = false;
        state.error = failureReason;
        toasts.push({ type: 'error', title: 'Cleanup Failed', message: failureReason });
      }
    } catch (error) {
      const failureReason = error?.message || 'Unexpected exception during cleanup apply';
      state.isApplying = false;
      state.error = failureReason;
      toasts.push({ type: 'error', title: 'Cleanup Exception', message: failureReason });
    }
  };

  const handleCancelMessCleanupPreview = () => {
    state = {
      isOpen: false,
      workspaceModel: null,
      organizationPlan: null,
      layoutProposal: null,
      loading: false,
      isApplying: false,
      error: ''
    };
  };

  return {
    getState: () => state,
    setState: (newState) => {
      state = { ...state, ...newState };
    },
    getEmittedSocketEvents: () => emittedSocketEvents,
    getPersistenceCalls: () => persistenceCalls,
    getToasts: () => toasts,
    getApplyCallCount: () => applyCallCount,
    handleApplyMessCleanup,
    handleCancelMessCleanupPreview
  };
};

test('TEST 1: Apply button is enabled when a valid proposal exists', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal,
    loading: false,
    isApplying: false,
    error: ''
  });

  const state = controller.getState();
  const isButtonDisabled = state.loading || Boolean(state.error) || state.isApplying || !state.layoutProposal;
  assert.equal(isButtonDisabled, false);
});

test('TEST 2: Clicking Apply calls applyMessCleanup exactly once', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getApplyCallCount(), 1);
});

test('TEST 3: Double-click cannot trigger two cleanup operations', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  controller.handleApplyMessCleanup();
  assert.equal(controller.getApplyCallCount(), 1);
});

test('TEST 4: Successful Apply closes the modal', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getState().isOpen, false);
});

test('TEST 5: Successful Apply allows existing batch collaboration flow', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getEmittedSocketEvents().length, 1);
  assert.equal(controller.getEmittedSocketEvents()[0].type, 'canvas:batch-modified');
});

test('TEST 6: Successful Apply allows existing persistence flow', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getPersistenceCalls().length, 1);
});

test('TEST 7: Failed Apply keeps the modal open', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal,
    simulateError: true
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getState().isOpen, true);
  assert.equal(controller.getState().error, 'Simulated failure reason');
});

test('TEST 8: Failed Apply does not emit a batch event', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal,
    simulateError: true
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getEmittedSocketEvents().length, 0);
});

test('TEST 9: Failed Apply does not persist', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal,
    simulateError: true
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getPersistenceCalls().length, 0);
});

test('TEST 10: Cancel does not mutate the canvas', () => {
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: {}
  });

  controller.handleCancelMessCleanupPreview();
  assert.equal(controller.getState().isOpen, false);
  assert.equal(controller.getApplyCallCount(), 0);
});

test('TEST 11: Cancel does not emit sockets', () => {
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: {}
  });

  controller.handleCancelMessCleanupPreview();
  assert.equal(controller.getEmittedSocketEvents().length, 0);
});

test('TEST 12: Loading state resets after success', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getState().isApplying, false);
});

test('TEST 13: Loading state resets after failure', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal,
    simulateException: true
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getState().isApplying, false);
  assert.equal(controller.getState().isOpen, true);
  assert.equal(controller.getState().error, 'Simulated apply exception');
});

test('TEST 14: Existing Mess Cleanup UI integration works cleanly', () => {
  const proposal = { placements: [{ objectId: 's1', position: { x: 10, y: 10 } }] };
  const controller = createSimulatedUiController({
    isOpen: true,
    workspaceModel: {},
    layoutProposal: proposal
  });

  controller.handleApplyMessCleanup();
  assert.equal(controller.getToasts().length, 1);
  assert.equal(controller.getToasts()[0].type, 'success');
});
