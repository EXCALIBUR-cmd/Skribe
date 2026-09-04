import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { buildPreviewRenderModel, worldToPreview } from './previewModel.js';
import { mapSvgPathCommands, parseConnectorPath } from './connectorGeometry.js';
import { buildCleanupResult } from './buildCleanupResult.js';

const isDarkColor = (color) => {
  if (!color || color === 'transparent' || color === 'none') return false;
  let r, g, b;
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else return false;
  } else if (color.startsWith('rgb')) {
    const match = color.match(/\d+/g);
    if (!match || match.length < 3) return false;
    [r, g, b] = match.map(Number);
  } else if (color === 'black' || color === '#000' || color === '#000000') {
    return true;
  } else {
    return false;
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.45;
};

const getPreviewShapeStyle = (object, scale = 1) => {
  const shapeType = object.shapeType;
  const isStickyNote = object.isStickyNote;
  const noteColor = object.noteColor;
  const originalFill = object.fill;
  const originalStroke = object.visual?.stroke || object.stroke;
  const hasFill = originalFill && originalFill !== 'transparent' && originalFill !== 'none';
  const hasStroke = originalStroke && originalStroke !== 'transparent' && originalStroke !== 'none';

  const base = {};

  if (hasFill) {
    base.backgroundColor = originalFill;
  } else if (object.backgroundColor && object.backgroundColor !== 'transparent') {
    base.backgroundColor = object.backgroundColor;
  } else {
    base.backgroundColor = isStickyNote ? (noteColor || '#fef08a') : 'rgba(186, 230, 253, 0.8)';
  }

  const rawStrokeWidth = object.strokeWidth !== undefined && object.strokeWidth !== null
    ? object.strokeWidth
    : (object.visual?.strokeWidth !== undefined && object.visual?.strokeWidth !== null ? object.visual.strokeWidth : null);

  const scaledBorderWidth = rawStrokeWidth !== null
    ? Math.max(1, rawStrokeWidth * scale)
    : (hasStroke ? Math.max(1, 2 * scale) : 0);

  base.borderWidth = `${scaledBorderWidth}px`;

  const dashArray = object.strokeDashArray || object.visual?.strokeDashArray;
  if (Array.isArray(dashArray) && dashArray.length >= 2) {
    const isDotted = dashArray[0] <= 3 && dashArray[1] <= 3;
    base.borderStyle = isDotted ? 'dotted' : 'dashed';
  } else if (hasStroke || rawStrokeWidth > 0) {
    base.borderStyle = 'solid';
  } else {
    base.borderStyle = 'none';
  }

  base.borderColor = originalStroke || (hasStroke ? '#334155' : 'transparent');

  const opacity = object.opacity !== undefined && object.opacity !== null
    ? object.opacity
    : (object.visual?.opacity !== undefined && object.visual?.opacity !== null ? object.visual.opacity : 1);
  base.opacity = opacity;

  const shadow = object.shadow || object.visual?.shadow;
  if (shadow) {
    const sx = (shadow.offsetX || 0) * scale;
    const sy = (shadow.offsetY || 0) * scale;
    const sBlur = (shadow.blur || 0) * scale;
    const sColor = shadow.color || 'rgba(0,0,0,0.2)';
    base.boxShadow = `${sx}px ${sy}px ${sBlur}px ${sColor}`;
  }

  if (isStickyNote) {
    return {
      ...base,
      backgroundColor: noteColor || base.backgroundColor,
      backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 22px, rgba(15, 23, 42, 0.08) 23px)'
    };
  }

  if (shapeType === 'circle' || shapeType === 'ellipse') return { ...base, borderRadius: '50%' };
  if (shapeType === 'rounded_rect') return { ...base, borderRadius: `${Math.max(4, 24 * scale)}px` };
  if (shapeType === 'triangle') return { ...base, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' };
  if (shapeType === 'diamond' || shapeType === 'polygon') return { ...base, clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' };
  if (shapeType === 'hexagon') return { ...base, clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' };
  return { ...base, borderRadius: `${Math.max(2, 8 * scale)}px` };
};

const getContentStyle = (object, bounds, renderBounds, scale, padding) => {
  const left = object.bounds?.x !== undefined
    ? object.bounds.x
    : (object.anchor === 'center' ? object.position.x - object.size.width / 2 : object.position.x);
  const top = object.bounds?.y !== undefined
    ? object.bounds.y
    : (object.anchor === 'center' ? object.position.y - object.size.height / 2 : object.position.y);

  const p = worldToPreview({ x: left, y: top }, renderBounds, scale, padding);

  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    width: `${(object.bounds?.width || object.size?.width || 0) * scale}px`,
    height: `${(object.bounds?.height || object.size?.height || 0) * scale}px`,
    transform: `rotate(${object.rotation || 0}deg)`,
    transformOrigin: 'center center'
  };
};

export const MessCleanupPreviewModal = ({
  isOpen,
  workspaceModel,
  layoutProposal,
  loading = false,
  isApplying = false,
  error = '',
  onApply,
  onCancel
}) => {
  const [selectedActionId, setSelectedActionId] = useState(null);

  const cleanupResult = useMemo(() => {
    if (!layoutProposal || !workspaceModel) return null;
    if (layoutProposal.metadata?.cleanupResult) return layoutProposal.metadata.cleanupResult;
    return buildCleanupResult(layoutProposal.metadata?.cleanupPlan, layoutProposal, workspaceModel, { debug: true });
  }, [workspaceModel, layoutProposal]);

  const renderModel = useMemo(
    () => buildPreviewRenderModel(workspaceModel, layoutProposal),
    [workspaceModel, layoutProposal]
  );

  if (!isOpen) return null;

  const renderBounds = renderModel.bounds;
  const previewWidth = 900;
  const previewHeight = 500;
  const padding = 24;
  const scale = Math.min(
    (previewWidth - padding * 2) / Math.max(renderBounds.width, 1),
    (previewHeight - padding * 2) / Math.max(renderBounds.height, 1),
    1
  );
  const contentWidth = Math.max(renderBounds.width * scale + padding * 2, 1);
  const contentHeight = Math.max(renderBounds.height * scale + padding * 2, 1);
  const placementById = new Map(renderModel.objects.map((object) => [object.originalObjectId, object]));

  const activeAction = cleanupResult?.actions?.find((a) => a.id === selectedActionId);
  const activeActionObjectIds = new Set(activeAction ? (activeAction.ownedObjectIds || activeAction.objectIds) : []);

  const mapPoint = (point) => ({
    x: (point.x - renderBounds.x) * scale + padding,
    y: (point.y - renderBounds.y) * scale + padding
  });

  const renderObject = (object, index) => {
    if (object.type === 'connector' || object.type === 'line' || object.type === 'stroke') return null;
    const uniqueKey = `${object.type}_${object.originalObjectId || 'item'}_${index}`;
    const isHighlighted = selectedActionId && activeActionObjectIds.has(object.originalObjectId);

    if (object.type === 'text') {
      const parentShapeId = object.relationshipMetadata?.parentShapeId;
      const parentShape = parentShapeId ? placementById.get(parentShapeId) : null;
      const isInsideDarkShape = parentShape && isDarkColor(parentShape.fill);

      const customColor = object.style?.color || object.metadata?.color;
      const resolvedColor = customColor || (isInsideDarkShape ? '#ffffff' : '#1e293b');
      const isSingleWord = object.text && !object.text.includes('\n') && !object.text.trim().includes(' ');
      const isNoteOrCallout = Boolean(parentShape?.isStickyNote || parentShape?.isCalloutNote || parentShape?.shapeType === 'callout');
      const textAlign = object.style?.textAlign || (isNoteOrCallout ? 'left' : 'center');
      const fontWeight = object.style?.fontWeight || 'bold';

      return (
        <div
          key={uniqueKey}
          data-original-object-id={object.originalObjectId}
          className={`absolute flex overflow-visible px-1 transition-all ${
            isHighlighted ? 'ring-2 ring-primary ring-offset-2 rounded' : ''
          }`}
          style={{
            ...getContentStyle(object, renderBounds, renderBounds, scale, padding),
            alignItems: isNoteOrCallout ? 'flex-start' : 'center',
            justifyContent: textAlign === 'left' ? 'flex-start' : (textAlign === 'right' ? 'flex-end' : 'center'),
            fontSize: `${Math.max(8, (object.style?.fontSize || object.metadata?.fontSize || 16) * scale)}px`,
            fontFamily: object.style?.fontFamily || object.metadata?.fontFamily || 'Nunito Sans',
            fontWeight,
            fontStyle: object.style?.fontStyle || 'normal',
            textDecoration: [object.style?.underline && 'underline', object.style?.linethrough && 'line-through', object.style?.overline && 'overline'].filter(Boolean).join(' ') || undefined,
            letterSpacing: object.style?.charSpacing ? `${object.style.charSpacing * scale}px` : undefined,
            lineHeight: 1.2,
            color: resolvedColor,
            opacity: object.style?.opacity !== undefined ? object.style.opacity : (object.opacity !== undefined ? object.opacity : 1),
            pointerEvents: 'none',
            whiteSpace: isSingleWord ? 'nowrap' : (parentShape ? 'normal' : 'nowrap'),
            wordBreak: isSingleWord ? 'normal' : 'break-word',
            overflowWrap: 'break-word',
            textAlign
          }}
        >
          {object.text}
        </div>
      );
    }

    if (object.type === 'image') {
      return (
        <div
          key={uniqueKey}
          data-original-object-id={object.originalObjectId}
          className={`absolute flex items-center justify-center rounded border-2 border-dashed border-slate-400 bg-slate-100 text-center text-[10px] text-slate-500 ${
            isHighlighted ? 'ring-2 ring-primary ring-offset-2' : ''
          }`}
          style={getContentStyle(object, renderBounds, renderBounds, scale, padding)}
        >
          Image unavailable in preview
        </div>
      );
    }

    if (object.type === 'unsupported') return null;

    const originalFill = object.fill;
    const originalStroke = object.visual?.stroke || object.stroke;
    const hasFill = originalFill && originalFill !== 'transparent' && originalFill !== 'none';
    const hasStroke = originalStroke && originalStroke !== 'transparent' && originalStroke !== 'none';

    const rawStrokeWidth = object.strokeWidth !== undefined && object.strokeWidth !== null
      ? object.strokeWidth
      : (object.visual?.strokeWidth !== undefined && object.visual?.strokeWidth !== null ? object.visual.strokeWidth : null);
    const scaledStrokeWidth = rawStrokeWidth !== null
      ? Math.max(1, rawStrokeWidth * scale)
      : (hasStroke ? Math.max(1, 2 * scale) : 0);

    const strokeDashArray = object.strokeDashArray || object.visual?.strokeDashArray;
    const hasDash = Array.isArray(strokeDashArray) && strokeDashArray.length > 0;
    const scaledDashArrayStr = hasDash
      ? strokeDashArray.map((v) => Math.round(v * scale * 1000) / 1000).join(' ')
      : undefined;

    const strokeLineCap = object.strokeLineCap || 'butt';
    const strokeLineJoin = object.strokeLineJoin || 'miter';
    const opacity = object.opacity !== undefined && object.opacity !== null ? object.opacity : 1;

    if (object.shapeType === 'callout' || object.isCalloutNote) {
      const calloutStrokeWidth = object.strokeWidth !== undefined && object.strokeWidth !== null ? object.strokeWidth : 2;
      return (
        <div
          key={uniqueKey}
          data-original-object-id={object.originalObjectId}
          className={`absolute transition-all ${isHighlighted ? 'ring-2 ring-primary ring-offset-2' : ''}`}
          style={{
            ...getContentStyle(object, renderBounds, renderBounds, scale, padding),
            pointerEvents: 'none'
          }}
        >
          <svg viewBox="0 0 180 115" preserveAspectRatio="none" className="w-full h-full overflow-visible">
            <path
              d="M 10 0 L 170 0 C 180 0 180 0 180 10 L 180 80 C 180 90 180 90 170 90 L 50 90 L 25 115 L 35 90 L 10 90 C 0 90 0 90 0 80 L 0 10 C 0 0 0 0 10 0 Z"
              fill={originalFill || '#fef3c7'}
              stroke={originalStroke || '#f59e0b'}
              strokeWidth={calloutStrokeWidth}
              strokeDasharray={scaledDashArrayStr}
              strokeLinecap={strokeLineCap}
              strokeLinejoin={strokeLineJoin}
              opacity={opacity}
            />
          </svg>
        </div>
      );
    }

    const isVectorSvgShape = (
      object.shapeType === 'diamond' ||
      object.shapeType === 'triangle' ||
      object.shapeType === 'hexagon' ||
      object.shapeType === 'polygon' ||
      (object.shapeType === 'circle' && hasDash) ||
      (object.shapeType === 'ellipse' && hasDash) ||
      ((object.shapeType === 'rect' || object.shapeType === 'rounded_rect') && hasDash && !object.isStickyNote)
    );

    if (isVectorSvgShape) {
      const wScreen = (object.size?.width || 100) * scale;
      const hScreen = (object.size?.height || 100) * scale;
      const resolvedFill = hasFill ? originalFill : (originalFill === 'transparent' ? 'transparent' : 'rgba(186, 230, 253, 0.8)');
      const resolvedStroke = hasStroke || rawStrokeWidth > 0 ? (originalStroke || '#000000') : 'none';

      let svgElement = null;

      if (object.shapeType === 'circle' || object.shapeType === 'ellipse') {
        svgElement = (
          <ellipse
            cx={wScreen / 2}
            cy={hScreen / 2}
            rx={Math.max(1, wScreen / 2 - scaledStrokeWidth / 2)}
            ry={Math.max(1, hScreen / 2 - scaledStrokeWidth / 2)}
            fill={resolvedFill}
            stroke={resolvedStroke}
            strokeWidth={scaledStrokeWidth}
            strokeDasharray={scaledDashArrayStr}
            strokeLinecap={strokeLineCap}
            strokeLinejoin={strokeLineJoin}
            opacity={opacity}
          />
        );
      } else if (object.shapeType === 'rect' || object.shapeType === 'rounded_rect') {
        const rx = object.shapeType === 'rounded_rect' ? Math.max(4, 24 * scale) : 0;
        svgElement = (
          <rect
            x={scaledStrokeWidth / 2}
            y={scaledStrokeWidth / 2}
            width={Math.max(1, wScreen - scaledStrokeWidth)}
            height={Math.max(1, hScreen - scaledStrokeWidth)}
            rx={rx}
            ry={rx}
            fill={resolvedFill}
            stroke={resolvedStroke}
            strokeWidth={scaledStrokeWidth}
            strokeDasharray={scaledDashArrayStr}
            strokeLinecap={strokeLineCap}
            strokeLinejoin={strokeLineJoin}
            opacity={opacity}
          />
        );
      } else {
        let pointsStr = '';
        if (Array.isArray(object.points) && object.points.length > 0) {
          pointsStr = object.points
            .map((p) => `${Math.round(p.x * scale * 1000) / 1000},${Math.round(p.y * scale * 1000) / 1000}`)
            .join(' ');
        } else if (object.shapeType === 'diamond') {
          pointsStr = `${wScreen / 2},0 ${wScreen},${hScreen / 2} ${wScreen / 2},${hScreen} 0,${hScreen / 2}`;
        } else if (object.shapeType === 'triangle') {
          pointsStr = `${wScreen / 2},0 ${wScreen},${hScreen} 0,${hScreen}`;
        } else if (object.shapeType === 'hexagon') {
          pointsStr = `${wScreen * 0.25},0 ${wScreen * 0.75},0 ${wScreen},${hScreen * 0.5} ${wScreen * 0.75},${hScreen} ${wScreen * 0.25},${hScreen} 0,${hScreen * 0.5}`;
        }

        svgElement = (
          <polygon
            points={pointsStr}
            fill={resolvedFill}
            stroke={resolvedStroke}
            strokeWidth={scaledStrokeWidth}
            strokeDasharray={scaledDashArrayStr}
            strokeLinecap={strokeLineCap}
            strokeLinejoin={strokeLineJoin}
            opacity={opacity}
          />
        );
      }

      return (
        <div
          key={uniqueKey}
          data-original-object-id={object.originalObjectId}
          className={`absolute transition-all ${isHighlighted ? 'ring-2 ring-primary ring-offset-2' : ''}`}
          style={{
            ...getContentStyle(object, renderBounds, renderBounds, scale, padding),
            pointerEvents: 'none'
          }}
        >
          <svg width="100%" height="100%" className="w-full h-full overflow-visible">
            {svgElement}
          </svg>
        </div>
      );
    }

    return (
      <div
        key={uniqueKey}
        data-original-object-id={object.originalObjectId}
        className={`absolute shadow-sm transition-all ${
          isHighlighted ? 'ring-2 ring-primary ring-offset-2' : ''
        }`}
        style={{
          ...getContentStyle(object, renderBounds, renderBounds, scale, padding),
          ...getPreviewShapeStyle(object, scale),
          pointerEvents: 'none'
        }}
      />
    );
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={onCancel}>
      <section
        className="flex max-h-[calc(100vh-32px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-2 border-primary bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mess-cleanup-preview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-outline-variant/60 px-5 py-4">
          <div>
            <h2 id="mess-cleanup-preview-title" className="font-headline text-lg font-bold text-on-surface">Mess Cleanup Preview</h2>
            <p className="mt-1 text-xs text-on-surface-variant">This is a proposed organization. Your board has not been changed.</p>
          </div>
          <button onClick={onCancel} disabled={isApplying} className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-primary disabled:opacity-50 cursor-pointer" aria-label="Close preview" title="Close preview">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {}
        {cleanupResult && (
          <div className="bg-primary-container/20 border-b border-outline-variant/40 px-5 py-2.5 flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 text-on-surface font-medium truncate">
              <span className="material-symbols-outlined text-primary text-base shrink-0">check_circle</span>
              <span className="truncate">{cleanupResult.summary.humanSummary}</span>
            </div>
            <div className="flex items-center gap-1.5 text-on-surface-variant font-semibold shrink-0">
              <span className="inline-flex items-center gap-1 bg-surface-container-high px-2.5 py-1 rounded-full text-[11px] text-on-surface">
                <span className="w-2 h-2 rounded-full bg-primary"></span>
                {cleanupResult.summary.modifiedObjectCount} improved
              </span>
              <span className="inline-flex items-center gap-1 bg-surface-container-high px-2.5 py-1 rounded-full text-[11px] text-on-surface-variant">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                {cleanupResult.summary.untouchedObjectCount} preserved
              </span>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {loading && <div className="flex min-h-80 items-center justify-center text-sm font-bold text-on-surface-variant">Preparing preview...</div>}
          {!loading && error && <div className="flex min-h-80 items-center justify-center text-sm font-bold text-error">{error}</div>}
          {!loading && !error && (
            <div className="flex min-h-80 items-center justify-center">
              <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white shadow-inner" style={{ width: `${contentWidth}px`, height: `${contentHeight}px` }}>
                {}
                <svg className="absolute inset-0 z-0 pointer-events-none" width={contentWidth} height={contentHeight} aria-hidden="true">
                  {renderModel.objects.filter((object) => object.type === 'line').map((item, idx) => {
                    const pathSource = item.worldPathCommands || item.worldPath || item.pathCommands || item.pathData || item.path;
                    if (pathSource) {
                      const svgPath = mapSvgPathCommands(pathSource, mapPoint);
                      if (svgPath) {
                        return (
                          <path
                            key={`line_${item.originalObjectId || 'l'}_${idx}`}
                            d={svgPath}
                            stroke={item.stroke || '#64748b'}
                            strokeWidth={item.strokeWidth !== null && item.strokeWidth !== undefined ? Math.max(1, item.strokeWidth * scale) : Math.max(1, 2 * scale)}
                            strokeDasharray={item.strokeDashArray ? item.strokeDashArray.map((d) => Math.max(1, d * scale)).join(' ') : undefined}
                            strokeLinecap={item.strokeLineCap || 'butt'}
                            strokeLinejoin={item.strokeLineJoin || 'miter'}
                            opacity={item.opacity !== undefined ? item.opacity : 1}
                          />
                        );
                      }
                    }
                    const isVertical = (item.bounds?.height || 0) > (item.bounds?.width || 0) * 2;
                    const start = isVertical
                      ? mapPoint({ x: item.bounds.x + item.bounds.width / 2, y: item.bounds.y })
                      : mapPoint({ x: item.bounds.x, y: item.bounds.y + item.bounds.height / 2 });
                    const end = isVertical
                      ? mapPoint({ x: item.bounds.x + item.bounds.width / 2, y: item.bounds.y + item.bounds.height })
                      : mapPoint({ x: item.bounds.x + item.bounds.width, y: item.bounds.y + item.bounds.height / 2 });
                    return (
                      <line
                        key={`line_${item.originalObjectId || 'l'}_${idx}`}
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke={item.stroke || '#64748b'}
                        strokeWidth={item.strokeWidth !== null && item.strokeWidth !== undefined ? Math.max(1, item.strokeWidth * scale) : Math.max(1, 2 * scale)}
                        strokeDasharray={item.strokeDashArray ? item.strokeDashArray.map((d) => Math.max(1, d * scale)).join(' ') : undefined}
                        strokeLinecap={item.strokeLineCap || 'butt'}
                        opacity={item.opacity !== undefined ? item.opacity : 1}
                      />
                    );
                  })}
                </svg>

                {}
                {renderModel.objects.map(renderObject)}

                {}
                <svg className="absolute inset-0 z-30 pointer-events-none" width={contentWidth} height={contentHeight} aria-hidden="true">
                  <defs>
                    <marker
                      id="mess-cleanup-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth={Math.max(4, 6 * scale)}
                      markerHeight={Math.max(4, 6 * scale)}
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#334155" />
                    </marker>
                  </defs>
                  {}
                  {renderModel.objects.filter((object) => object.type === 'stroke').map((item, idx) => {
                    const pathSource = item.worldPathCommands || item.worldPath || item.pathCommands || item.pathData || item.path;
                    if (pathSource) {
                      const svgPath = mapSvgPathCommands(pathSource, mapPoint);
                      if (svgPath) {
                        return (
                          <path
                            key={`stroke_${item.originalObjectId || 's'}_${idx}`}
                            d={svgPath}
                            fill="none"
                            stroke={item.stroke || '#334155'}
                            strokeWidth={item.strokeWidth !== null && item.strokeWidth !== undefined ? Math.max(1, item.strokeWidth * scale) : Math.max(1.5, 3 * scale)}
                            strokeDasharray={item.strokeDashArray ? item.strokeDashArray.map((d) => Math.max(1, d * scale)).join(' ') : undefined}
                            strokeLinecap={item.strokeLineCap || 'round'}
                            strokeLinejoin={item.strokeLineJoin || 'round'}
                            opacity={item.opacity !== undefined ? item.opacity : 1}
                          />
                        );
                      }
                    }
                    return null;
                  })}

                  {}
                  {renderModel.objects.filter((object) => object.type === 'connector').map((connector, idx) => {
                    const pathSource = connector.worldPathCommands || connector.worldPath || connector.pathCommands || connector.pathData || connector.path;
                    if (pathSource) {
                      const svgPath = mapSvgPathCommands(pathSource, mapPoint);
                      if (svgPath) {
                        const needsMarker = connector.endArrow !== false && !svgPath.includes(' L ');
                        return (
                          <path
                            key={`conn_path_${connector.originalObjectId || 'c'}_${idx}`}
                            d={svgPath}
                            fill="none"
                            stroke={connector.stroke || '#334155'}
                            strokeWidth={connector.strokeWidth !== null && connector.strokeWidth !== undefined ? Math.max(1, connector.strokeWidth * scale) : Math.max(1.5, 2.5 * scale)}
                            strokeDasharray={connector.strokeDashArray ? connector.strokeDashArray.map((d) => Math.max(1, d * scale)).join(' ') : undefined}
                            strokeLinecap={connector.strokeLineCap || 'round'}
                            strokeLinejoin={connector.strokeLineJoin || 'round'}
                            opacity={connector.opacity !== undefined ? connector.opacity : 1}
                            markerEnd={needsMarker ? 'url(#mess-cleanup-arrow)' : undefined}
                          />
                        );
                      }
                    }

                    console.error('[MessCleanup] Connector has no valid geometry:', {
                      id: connector.originalObjectId,
                      type: connector.type,
                      connectorType: connector.connectorType,
                      relationshipMetadata: connector.relationshipMetadata
                    });
                    return null;
                  })}

                  <defs>
                    <marker id="mess-cleanup-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="#334155" />
                    </marker>
                  </defs>
                </svg>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-outline-variant/60 px-5 py-4">
          <button onClick={onCancel} disabled={isApplying} className="rounded-full px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50">Cancel</button>
          <button
            onClick={onApply}
            disabled={loading || Boolean(error) || isApplying || !layoutProposal}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary shadow-md hover:bg-primary/90 disabled:bg-primary/40 disabled:text-on-primary/80 disabled:cursor-not-allowed cursor-pointer"
          >
            {isApplying ? (
              <>
                <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                <span>Applying...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">auto_awesome</span>
                <span>Apply Cleanup</span>
              </>
            )}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
};

export default MessCleanupPreviewModal;
