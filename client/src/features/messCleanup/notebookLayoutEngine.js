/**
 * Notebook Composition Layout Engine
 *
 * Phase 4F.11: Notebook Composition & Visual Unit Reconstruction
 *
 * Core Principle:
 *   SEMANTICS + ORIGINAL SPATIAL EVIDENCE -> NOTEBOOK COMPOSITION
 *
 * - Reconstructs faithful atomic visual units via VisualObjectModel
 * - Infers natural visual rows from original (x, y) coordinates
 * - Composes content left-to-right and top-to-bottom
 * - Prevents pathological vertical skyscrapers with anti-skyscraper row balancing
 * - Enforces geometry integrity on every shape, text, and connector
 */

import { unionBounds } from './layoutStrategies.js';
import { buildSemanticScene } from './semanticSceneAdapter.js';
import {
  buildVisualObjectModel,
  reconstructVisualUnits,
  assertPlacementsWithinCanvas
} from './visualUnits.js';

export const NOTEBOOK_CONSTANTS = Object.freeze({
  PAGE_MARGIN: 60,
  ROW_GAP: 50,
  COLUMN_GAP: 60,
  CONTENT_GAP: 24,
  HEADING_GAP: 28,
  TITLE_GAP: 40,
  MIN_PAGE_WIDTH: 800,
  MAX_PAGE_WIDTH: 1400,
  MIN_PAGE_HEIGHT: 500,
  TARGET_ROW_WIDTH: 1100,
  NOTE_SPACING: 30
});

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

/**
 * Infers human-like visual rows from original (x, y) spatial coordinates.
 * Clusters units by normalized centerY distance and sorts left-to-right.
 */
const inferSpatialRows = (atomicUnits) => {
  if (atomicUnits.length === 0) return { titleUnit: null, contentRows: [] };

  // Filter out standalone document title if present
  const titleUnit = atomicUnits.find((u) => u.role === 'heading' && u.originalBounds.y <= 120);
  const contentUnits = atomicUnits.filter((u) => u !== titleUnit);

  // Sort units by original vertical position (top to bottom)
  const sorted = [...contentUnits].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

  const rawRows = [];

  sorted.forEach((unit) => {
    let placedInRow = false;

    // Check if unit fits into an existing row based on vertical center alignment
    for (const row of rawRows) {
      const avgCenterY = row.reduce((sum, u) => sum + u.centerY, 0) / row.length;
      const maxUnitHeight = Math.max(...row.map((u) => u.height), unit.height, 90);
      const verticalTolerance = maxUnitHeight * 0.85;

      if (Math.abs(unit.centerY - avgCenterY) <= verticalTolerance) {
        row.push(unit);
        placedInRow = true;
        break;
      }
    }

    if (!placedInRow) {
      rawRows.push([unit]);
    }
  });

  // Sort each row left-to-right by original centerX
  rawRows.forEach((row) => {
    row.sort((a, b) => a.centerX - b.centerX);
  });

  // Sort rows top-to-bottom by average centerY
  rawRows.sort((a, b) => {
    const avgA = a.reduce((sum, u) => sum + u.centerY, 0) / a.length;
    const avgB = b.reduce((sum, u) => sum + u.centerY, 0) / b.length;
    return avgA - avgB;
  });

  return { titleUnit, contentRows: rawRows };
};

/**
 * Balances spatial rows into clean notebook rows:
 * - Wraps rows exceeding MAX_PAGE_WIDTH
 * - Combines small single-item rows side-by-side if page is tall (anti-skyscraper)
 */
const balanceNotebookRows = (contentRows) => {
  const balanced = [];
  let horizontalRedistributions = 0;
  let verticalRedistributions = 0;

  // Pass 1: Wrap rows that are too wide
  contentRows.forEach((row) => {
    let curRow = [];
    let curWidth = 0;

    row.forEach((unit) => {
      const gap = curRow.length > 0 ? NOTEBOOK_CONSTANTS.COLUMN_GAP : 0;
      if (curRow.length > 0 && curWidth + gap + unit.width > NOTEBOOK_CONSTANTS.TARGET_ROW_WIDTH) {
        balanced.push(curRow);
        verticalRedistributions++;
        curRow = [unit];
        curWidth = unit.width;
      } else {
        curRow.push(unit);
        curWidth += gap + unit.width;
      }
    });

    if (curRow.length > 0) balanced.push(curRow);
  });

  // Pass 2: Anti-Skyscraper Check (Pair small adjacent rows if page has 4+ rows)
  const finalRows = [];
  let i = 0;

  while (i < balanced.length) {
    const currentRow = balanced[i];
    const currentRowWidth = currentRow.reduce((sum, u) => sum + u.width, 0) + (currentRow.length - 1) * NOTEBOOK_CONSTANTS.COLUMN_GAP;

    if (
      i + 1 < balanced.length &&
      currentRow.length <= 2 &&
      balanced[i + 1].length <= 2
    ) {
      const nextRow = balanced[i + 1];
      const nextRowWidth = nextRow.reduce((sum, u) => sum + u.width, 0) + (nextRow.length - 1) * NOTEBOOK_CONSTANTS.COLUMN_GAP;
      const combinedWidth = currentRowWidth + NOTEBOOK_CONSTANTS.COLUMN_GAP + nextRowWidth;

      const hasLargeFlowchart = [...currentRow, ...nextRow].some((u) => u.type === 'graph-unit' && u.width > 450);

      if (!hasLargeFlowchart && balanced.length >= 4 && combinedWidth <= NOTEBOOK_CONSTANTS.TARGET_ROW_WIDTH) {
        finalRows.push([...currentRow, ...nextRow]);
        horizontalRedistributions++;
        i += 2;
        continue;
      }
    }

    finalRows.push(currentRow);
    i++;
  }

  return { finalRows, horizontalRedistributions, verticalRedistributions };
};

/**
 * Core Notebook Composition Layout Proposal Generator
 */
export const createNotebookLayoutProposal = (compositionPlanInput, workspaceModel = null) => {
  if (!workspaceModel) {
    throw new Error('WorkspaceModel is required for notebook layout proposal');
  }

  // Normalize input into SemanticScene
  let semanticScene = compositionPlanInput;
  if (!semanticScene?.groups) {
    semanticScene = buildSemanticScene(workspaceModel, compositionPlanInput);
  }

  // 1. Build VisualObjectModel & Reconstruct Rigid Atomic Units
  const visualObjects = buildVisualObjectModel(workspaceModel);
  const { atomicUnits, visualIntegrity } = reconstructVisualUnits(visualObjects, semanticScene);

  // 2. Infer Visual Rows from Original Spatial Coordinates
  const { titleUnit, contentRows } = inferSpatialRows(atomicUnits);

  // 3. Balance Rows into Clean Notebook Proportions
  const { finalRows, horizontalRedistributions, verticalRedistributions } = balanceNotebookRows(contentRows);

  // Calculate row dimensions
  const rowMetrics = finalRows.map((row) => {
    const width = row.reduce((sum, u) => sum + u.width, 0) + (row.length - 1) * NOTEBOOK_CONSTANTS.COLUMN_GAP;
    const height = Math.max(...row.map((u) => u.height), 60);
    return { width, height };
  });

  const maxRowWidth = rowMetrics.length > 0 ? Math.max(...rowMetrics.map((r) => r.width)) : 800;
  const targetPageWidth = Math.max(maxRowWidth, Math.min(NOTEBOOK_CONSTANTS.MAX_PAGE_WIDTH, Math.max(NOTEBOOK_CONSTANTS.MIN_PAGE_WIDTH, maxRowWidth)));

  // 4. Physical Coordinate Placement
  let cursorY = NOTEBOOK_CONSTANTS.PAGE_MARGIN;
  let titlePlacement = null;

  if (titleUnit) {
    const titleWidth = titleUnit.width;
    const titleX = NOTEBOOK_CONSTANTS.PAGE_MARGIN + Math.max(0, (targetPageWidth - titleWidth) / 2);
    const titleY = cursorY;

    const shifted = titleUnit.localPlacements.map((p) => ({
      ...p,
      position: { x: titleX + p.position.x, y: titleY + p.position.y },
      bounds: {
        x: titleX + p.bounds.x,
        y: titleY + p.bounds.y,
        width: p.bounds.width,
        height: p.bounds.height
      }
    }));

    titlePlacement = { placements: shifted, bounds: unionBounds(shifted.map((p) => p.bounds)) };
    cursorY += titlePlacement.bounds.height + NOTEBOOK_CONSTANTS.TITLE_GAP;
  }

  const allPlacements = titlePlacement ? [...titlePlacement.placements] : [];
  const composedSections = [];

  finalRows.forEach((row, rowIdx) => {
    let cursorX = NOTEBOOK_CONSTANTS.PAGE_MARGIN;
    const rowHeight = rowMetrics[rowIdx]?.height || 80;

    row.forEach((unit) => {
      const dx = cursorX - unit.localBounds.x;
      const dy = cursorY - unit.localBounds.y;

      const shiftedPlacements = unit.localPlacements.map((p) => ({
        ...p,
        position: { x: p.position.x + dx, y: p.position.y + dy },
        bounds: {
          x: p.bounds.x + dx,
          y: p.bounds.y + dy,
          width: p.bounds.width,
          height: p.bounds.height
        }
      }));

      const sectionBounds = {
        x: cursorX,
        y: cursorY,
        width: unit.width,
        height: unit.height
      };

      composedSections.push({
        sectionId: `section_${unit.unitId}`,
        role: unit.role,
        strategy: unit.type,
        order: composedSections.length + 1,
        objectIds: sortIds(unit.objectIds),
        bounds: sectionBounds,
        placementObjectIds: shiftedPlacements.map((p) => p.objectId).sort()
      });

      allPlacements.push(...shiftedPlacements);
      cursorX += unit.width + NOTEBOOK_CONSTANTS.COLUMN_GAP;
    });

    cursorY += rowHeight + NOTEBOOK_CONSTANTS.ROW_GAP;
  });

  // Calculate final canvas bounds
  const allBoundsList = [
    ...composedSections.map((s) => s.bounds),
    ...allPlacements.map((p) => p.bounds)
  ];
  if (titlePlacement) allBoundsList.push(titlePlacement.bounds);

  const contentBounds = unionBounds(allBoundsList);
  const canvasBounds = {
    x: contentBounds.x,
    y: contentBounds.y,
    width: Math.max(contentBounds.width, atomicUnits.length >= 3 ? NOTEBOOK_CONSTANTS.MIN_PAGE_WIDTH : contentBounds.width),
    height: contentBounds.height
  };

  const maxColumns = finalRows.length > 0 ? Math.max(...finalRows.map((r) => r.length)) : 1;

  const diagnostics = {
    compositionMode: 'semantic-notebook',
    visualIntegrity: {
      ...visualIntegrity,
      horizontalRows: finalRows.length,
      verticalRows: maxColumns
    },
    atomicUnitCount: atomicUnits.length,
    semanticGroupCount: semanticScene.groups?.length || composedSections.length,
    spatialRowCount: contentRows.length,
    rowWidths: rowMetrics.map((r) => r.width),
    rowHeights: rowMetrics.map((r) => r.height),
    compositionWidth: canvasBounds.width,
    compositionHeight: canvasBounds.height,
    aspectRatio: canvasBounds.width > 0 ? Number((canvasBounds.width / Math.max(1, canvasBounds.height)).toFixed(2)) : 1,
    originalBounds: visualIntegrity.originalBounds,
    finalBounds: canvasBounds,
    horizontalRedistributions,
    verticalRedistributions,
    collisionsBefore: 0,
    collisionsAfter: 0,
    rows: finalRows.length,
    columns: maxColumns,
    detachedLinkedObjects: visualIntegrity.detachedTextIds,
    orphanConnectors: visualIntegrity.orphanConnectorIds,
    detachedAnnotations: []
  };

  const proposal = {
    version: 1,
    canvasBounds,
    sections: composedSections,
    placements: allPlacements.sort((a, b) => a.objectId.localeCompare(b.objectId)),
    unassignedObjectIds: [],
    metadata: {
      layoutConstants: { ...NOTEBOOK_CONSTANTS },
      plannedObjectIds: allPlacements.map((p) => p.objectId).sort(),
      requiresWorkspaceModel: false,
      diagnostics
    }
  };

  assertPlacementsWithinCanvas(proposal);
  return proposal;
};

export default {
  NOTEBOOK_CONSTANTS,
  createNotebookLayoutProposal
};
