import React, { useMemo } from 'react';
import ReactDOM from 'react-dom';
import { buildPreviewRenderModel } from './previewModel.js';

const getPreviewShapeStyle = (shapeType, isStickyNote, noteColor) => {
  if (isStickyNote) {
    return {
      backgroundColor: noteColor,
      backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 22px, rgba(15, 23, 42, 0.08) 23px)'
    };
  }

  if (shapeType === 'circle') return { borderRadius: '50%' };
  if (shapeType === 'rounded_rect') return { borderRadius: '24px' };
  if (shapeType === 'triangle') return { clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' };
  if (shapeType === 'diamond') return { clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' };
  if (shapeType === 'hexagon') return { clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' };
  return { borderRadius: '8px' };
};

const getContentStyle = (object, bounds, renderBounds, scale, padding) => {
  const left = object.anchor === 'center'
    ? object.position.x - object.size.width / 2
    : object.position.x;
  const top = object.anchor === 'center'
    ? object.position.y - object.size.height / 2
    : object.position.y;

  return {
    left: `${(left - renderBounds.x) * scale + padding}px`,
    top: `${(top - renderBounds.y) * scale + padding}px`,
    width: `${object.size.width * scale}px`,
    height: `${object.size.height * scale}px`,
    transform: `rotate(${object.rotation || 0}deg) scale(${object.scale?.x || 1}, ${object.scale?.y || 1})`,
    transformOrigin: object.anchor === 'center' ? 'center center' : 'left top'
  };
};

export const MessCleanupPreviewModal = ({
  isOpen,
  workspaceModel,
  layoutProposal,
  loading = false,
  error = '',
  onCancel
}) => {
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

  const mapPoint = (point) => ({
    x: (point.x - renderBounds.x) * scale + padding,
    y: (point.y - renderBounds.y) * scale + padding
  });

  const renderObject = (object) => {
    if (object.type === 'connector' || object.type === 'line' || object.type === 'stroke') return null;
    if (object.type === 'text') {
      return (
        <div
          key={object.originalObjectId}
          data-original-object-id={object.originalObjectId}
          className="absolute overflow-hidden rounded px-1 text-center font-semibold text-slate-800"
          style={{
            ...getContentStyle(object, renderBounds, renderBounds, scale, padding),
            fontSize: `${Math.max(9, (object.metadata?.fontSize || 16) * scale)}px`,
            fontFamily: object.metadata?.fontFamily || 'Nunito Sans',
            lineHeight: 1.2,
            pointerEvents: 'none'
          }}
        >
          {object.text}
        </div>
      );
    }

    if (object.type === 'image') {
      return (
        <div
          key={object.originalObjectId}
          data-original-object-id={object.originalObjectId}
          className="absolute flex items-center justify-center rounded border-2 border-dashed border-slate-400 bg-slate-100 text-center text-[10px] text-slate-500"
          style={getContentStyle(object, renderBounds, renderBounds, scale, padding)}
        >
          Image unavailable in preview
        </div>
      );
    }

    if (object.type === 'unsupported') return null;

    return (
      <div
        key={object.originalObjectId}
        data-original-object-id={object.originalObjectId}
        className="absolute border-2 border-slate-700/70 bg-sky-200/80 shadow-sm"
        style={{
          ...getContentStyle(object, renderBounds, renderBounds, scale, padding),
          ...getPreviewShapeStyle(object.shapeType, object.isStickyNote, object.noteColor),
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
          <button onClick={onCancel} className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container-high hover:text-primary" aria-label="Close preview" title="Close preview">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
          {loading && <div className="flex min-h-80 items-center justify-center text-sm font-bold text-on-surface-variant">Preparing preview...</div>}
          {!loading && error && <div className="flex min-h-80 items-center justify-center text-sm font-bold text-error">{error}</div>}
          {!loading && !error && (
            <div className="flex min-h-80 items-center justify-center">
              <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white shadow-inner" style={{ width: `${contentWidth}px`, height: `${contentHeight}px` }}>
                <svg className="absolute inset-0" width={contentWidth} height={contentHeight} aria-hidden="true">
                  {renderModel.objects.filter((object) => object.type === 'connector').map((connector) => {
                    const sourceId = connector.relationshipMetadata.sourceShapeId;
                    const targetId = connector.relationshipMetadata.targetShapeId;
                    const source = placementById.get(sourceId);
                    const target = placementById.get(targetId);
                    if (!source || !target) return null;
                    const start = mapPoint(source.position);
                    const end = mapPoint(target.position);
                    return <line key={connector.originalObjectId} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#334155" strokeWidth="2" markerEnd="url(#mess-cleanup-arrow)" />;
                  })}
                  {renderModel.objects.filter((object) => object.type === 'line' || object.type === 'stroke').map((line) => {
                    const start = mapPoint({ x: line.bounds.x, y: line.bounds.y + line.bounds.height / 2 });
                    const end = mapPoint({ x: line.bounds.x + line.bounds.width, y: line.bounds.y + line.bounds.height / 2 });
                    return <line key={line.originalObjectId} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#64748b" strokeWidth="2" strokeDasharray={line.type === 'stroke' ? '5 4' : undefined} />;
                  })}
                  <defs>
                    <marker id="mess-cleanup-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="#334155" />
                    </marker>
                  </defs>
                </svg>
                {renderModel.objects.map(renderObject)}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-outline-variant/60 px-5 py-4">
          <button onClick={onCancel} className="rounded-full px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
          <button disabled className="flex items-center gap-2 rounded-full bg-primary/40 px-4 py-2 text-sm font-bold text-on-primary/80" title="Apply is coming in the next phase">
            Apply coming next
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
};

export default MessCleanupPreviewModal;
