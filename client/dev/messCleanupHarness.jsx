
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { MessCleanupPreviewModal } from '../src/features/messCleanup/MessCleanupPreviewModal.jsx';
import { createLayoutProposal } from '../src/features/messCleanup/layoutEngine.js';
import { workspaceModel, organizationPlan, weldedPairs } from '../src/features/messCleanup/fixtures/realMessyBoard.js';

const layoutProposal = createLayoutProposal(organizationPlan, workspaceModel);

window.__WORKSPACE_MODEL__ = workspaceModel;
window.__LAYOUT_PROPOSAL__ = layoutProposal;
window.__WELDED_PAIRS__ = weldedPairs;

const App = () => (
  <MessCleanupPreviewModal
    isOpen
    workspaceModel={workspaceModel}
    layoutProposal={layoutProposal}
    onApply={() => {}}
    onCancel={() => {}}
  />
);

const root = createRoot(document.getElementById('harness-root'));
root.render(<App />);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    window.__HARNESS_READY__ = true;
    document.body.setAttribute('data-harness-ready', 'true');
  });
});
