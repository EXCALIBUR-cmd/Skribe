/**
 * DEV-ONLY harness entry for Mess Cleanup preview verification. See messCleanupHarness.html.
 *
 * Renders the REAL MessCleanupPreviewModal with a layoutProposal produced by the REAL
 * createLayoutProposal (the exact call MainCanvasPage makes after analyzeWorkspace),
 * against the shared realMessyBoard fixture whose organizationPlan reproduces the real
 * Nemotron group-split that tears inner-shape / sticky-note text out of its container.
 *
 * Exposes window.__HARNESS_READY__ and window.__LAYOUT_PROPOSAL__ so the e2e spec (or the
 * preview MCP tools) can wait for render and cross-check placement geometry.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
// Load the app's global Tailwind stylesheet so the modal's `.absolute` positioning
// (and every other utility class) resolves exactly as in production. Without this the
// preview divs collapse into static document flow and the render is not faithful.
import '../src/index.css';
import { MessCleanupPreviewModal } from '../src/features/messCleanup/MessCleanupPreviewModal.jsx';
import { createLayoutProposal } from '../src/features/messCleanup/layoutEngine.js';
import { workspaceModel, organizationPlan, weldedPairs } from '../src/features/messCleanup/fixtures/realMessyBoard.js';

const layoutProposal = createLayoutProposal(organizationPlan, workspaceModel);

// Surface data for assertions / debugging without going through the DOM.
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

// The modal renders synchronously; flag readiness on the next frame so measurers can wait.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    window.__HARNESS_READY__ = true;
    document.body.setAttribute('data-harness-ready', 'true');
  });
});
