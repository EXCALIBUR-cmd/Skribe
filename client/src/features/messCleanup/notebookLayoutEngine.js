

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
  MAX_ASPECT_RATIO: 2.2,
  NOTE_SPACING: 30
});

const sortIds = (ids) => [...new Set(ids)].sort((a, b) => String(a || '').localeCompare(String(b || '')));

const inferSpatialRows = (atomicUnits, semanticScene = null) => {
  if (atomicUnits.length === 0) return { titleUnit: null, contentRows: [] };

  const rootTitleId = semanticScene?.hierarchy?.rootTitleObjectId || semanticScene?.title?.objectId || null;
  const titleUnit = atomicUnits.find((u) => (u.role === 'heading' || (rootTitleId && u.objectIds.includes(rootTitleId))) && u.originalBounds.y <= 120);
  const contentUnits = atomicUnits.filter((u) => u !== titleUnit);

  
  const sorted = [...contentUnits].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

  const rawRows = [];

  sorted.forEach((unit) => {
    let placedInRow = false;

    
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

  
  rawRows.forEach((row) => {
    row.sort((a, b) => a.centerX - b.centerX);
  });

  
  rawRows.sort((a, b) => {
    const avgA = a.reduce((sum, u) => sum + u.centerY, 0) / a.length;
    const avgB = b.reduce((sum, u) => sum + u.centerY, 0) / b.length;
    return avgA - avgB;
  });

  return { titleUnit, contentRows: rawRows };
};

const computeRowWidth = (row) =>
  row.reduce((sum, u) => sum + u.width, 0) + (row.length - 1) * NOTEBOOK_CONSTANTS.COLUMN_GAP;

const estimatePageAspect = (rows) => {
  if (rows.length === 0) return 1;
  const pageWidth = Math.max(...rows.map(computeRowWidth));
  const pageHeight = rows.reduce((sum, r) => sum + Math.max(...r.map((u) => u.height), 60), 0)
    + (rows.length - 1) * NOTEBOOK_CONSTANTS.ROW_GAP;
  return pageWidth / Math.max(1, pageHeight);
};

const balanceNotebookRows = (contentRows) => {
  const balanced = [];
  let horizontalRedistributions = 0;
  let verticalRedistributions = 0;

  
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

  
  
  
  let landscapeGuard = 0;
  while (landscapeGuard++ < 8) {
    const aspect = estimatePageAspect(finalRows);
    if (aspect <= NOTEBOOK_CONSTANTS.MAX_ASPECT_RATIO) break;

    
    let targetIdx = -1;
    let widest = -Infinity;
    finalRows.forEach((row, idx) => {
      if (row.length < 4) return;
      const width = computeRowWidth(row);
      if (width > widest) {
        widest = width;
        targetIdx = idx;
      }
    });
    if (targetIdx === -1) break;

    const row = finalRows[targetIdx];
    const mid = Math.ceil(row.length / 2);
    const candidate = [
      ...finalRows.slice(0, targetIdx),
      row.slice(0, mid),
      row.slice(mid),
      ...finalRows.slice(targetIdx + 1)
    ];

    
    const newAspect = estimatePageAspect(candidate);
    if (newAspect >= aspect || newAspect < 1.0) break;

    finalRows.splice(targetIdx, 1, row.slice(0, mid), row.slice(mid));
    verticalRedistributions++;
  }

  return { finalRows, horizontalRedistributions, verticalRedistributions };
};

export const createNotebookLayoutProposal = (compositionPlanInput, workspaceModel = null) => {
  if (!workspaceModel) {
    throw new Error('WorkspaceModel is required for notebook layout proposal');
  }

  
  let semanticScene = compositionPlanInput;
  if (!semanticScene?.groups) {
    semanticScene = buildSemanticScene(workspaceModel, compositionPlanInput);
  }

  
  const visualObjects = buildVisualObjectModel(workspaceModel);
  const { atomicUnits, visualIntegrity } = reconstructVisualUnits(visualObjects, semanticScene);

  
  const { titleUnit, contentRows } = inferSpatialRows(atomicUnits, semanticScene);

  
  const { finalRows, horizontalRedistributions, verticalRedistributions } = balanceNotebookRows(contentRows);

  
  const rowMetrics = finalRows.map((row) => {
    const width = row.reduce((sum, u) => sum + u.width, 0) + (row.length - 1) * NOTEBOOK_CONSTANTS.COLUMN_GAP;
    const height = Math.max(...row.map((u) => u.height), 60);
    return { width, height };
  });

  const maxRowWidth = rowMetrics.length > 0 ? Math.max(...rowMetrics.map((r) => r.width)) : 800;
  
  const targetPageWidth = Math.min(NOTEBOOK_CONSTANTS.MAX_PAGE_WIDTH, maxRowWidth);

  
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

  
  const allBoundsList = [
    ...composedSections.map((s) => s.bounds),
    ...allPlacements.map((p) => p.bounds)
  ];
  if (titlePlacement) allBoundsList.push(titlePlacement.bounds);

  const contentBounds = unionBounds(allBoundsList);
  const canvasBounds = {
    x: contentBounds.x,
    y: contentBounds.y,
    width: contentBounds.width,
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
