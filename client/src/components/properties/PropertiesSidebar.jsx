import React, { useState, useEffect, useRef } from 'react';
import UniversalColorPicker from '../ui/UniversalColorPicker';
import LaserInspector from './LaserInspector';
import PenInspector from './PenInspector';
import { isLowContrast, getBestReadableTextColor, getContrastRatio } from '../../utils/contrastUtils';
import { getRegisteredSectionsForObject, PROPERTY_SECTIONS } from './PropertyRegistry';

export const PropertiesSidebar = ({
  activeTool,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  selectedProps,
  penConfig = { color: '#000000', width: 4, opacity: 1.0, brushType: 'standard' },
  onPenConfigChange,
  laserConfig = { color: '#ef4444', width: 16, duration: 1500, glow: 'medium' },
  onLaserConfigChange,
  onApplyProperty,
  onDuplicate,
  onDelete,
  onBringToFront,
  onSendToBack,
  onSidebarExpandChange,
  className = ''
}) => {
  const [isManualCollapsed, setIsManualCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});
  const typographySectionRef = useRef(null);

  const hasSelection = selectedProps && selectedProps.hasSelection;
  const isLaserMode = activeTool === 'laser';
  const isPenMode = activeTool === 'draw';
  const isExpanded = (hasSelection || isLaserMode || isPenMode || activeTool !== 'select') && !isManualCollapsed;

  useEffect(() => {
    if (typeof onSidebarExpandChange === 'function') {
      onSidebarExpandChange(isExpanded);
    }
  }, [isExpanded, onSidebarExpandChange]);
  const editingContext = selectedProps?.editingContext || 'background';

  const sections = getRegisteredSectionsForObject(selectedProps);

  const {
    fill,
    noteColor,
    stroke,
    textColor,
    strokeWidth = 1,
    strokeDashArray = 'solid',
    opacity = 1,
    fontSize = 16,
    fontFamily = 'Quicksand',
    fontWeight = 'normal',
    textAlign = 'left',
    hasText = false,
    contrastResolved = false,
    isStickyNote,
    isChecklistNote,
    isCalloutNote,
    isStraightLine,
    isConnector,
    type
  } = selectedProps || {};

  useEffect(() => {
    if (editingContext === 'text') {
      setCollapsedSections((prev) => ({
        ...prev,
        [PROPERTY_SECTIONS.TYPOGRAPHY]: false
      }));
      setTimeout(() => {
        if (typographySectionRef.current) {
          typographySectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 60);
    }
  }, [editingContext, selectedProps?.id]);

  const effectiveBg = noteColor || (typeof fill === 'string' && fill !== 'transparent' ? fill : '#ffffff');
  const effectiveText = textColor || '#1e293b';
  const currentRatio = getContrastRatio(effectiveBg, effectiveText);
  const hasContrastIssue = hasText && !contrastResolved && isLowContrast(effectiveBg, effectiveText);

  const handleFixContrast = (e) => {
    e.stopPropagation();
    const recommended = getBestReadableTextColor(effectiveBg);
    onApplyProperty('autoFixContrast', recommended);
  };

  const toggleSection = (sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }));
  };

  return (
    <aside
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`fixed left-0 top-16 bottom-0 z-30 bg-surface/95 backdrop-blur-lg border-r border-outline-variant/60 shadow-xl flex flex-col transition-all duration-220 ease-out ${
        isExpanded ? 'w-80 opacity-100 pointer-events-auto' : 'w-12 opacity-90 pointer-events-auto'
      } ${className}`}
    >
      <div className="h-14 px-4 border-b border-outline-variant/40 flex items-center justify-between bg-surface-container-low/50 shrink-0">
        {isExpanded ? (
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="material-symbols-outlined text-primary text-xl">
              {isLaserMode ? 'flare' : editingContext === 'text' ? 'edit_note' : 'tune'}
            </span>
            <div className="flex flex-col overflow-hidden">
              <span className="font-label font-bold text-sm text-on-surface truncate capitalize leading-tight">
                {isLaserMode
                  ? 'Laser Pointer'
                  : isStickyNote
                  ? 'Sticky Note'
                  : isChecklistNote
                  ? 'Checklist'
                  : isCalloutNote
                  ? 'Callout'
                  : isStraightLine
                  ? 'Straight Line'
                  : isConnector
                  ? 'Connector'
                  : type || 'Workspace Control'}
              </span>
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">
                {isLaserMode ? 'Presentation Mode' : editingContext === 'text' ? 'Text Editing Mode' : 'Control Center'}
              </span>
            </div>
          </div>
        ) : (
          <div className="mx-auto text-primary" title="Workspace Control Center">
            <span className="material-symbols-outlined text-xl">tune</span>
          </div>
        )}

        <button
          onClick={() => setIsManualCollapsed(!isManualCollapsed)}
          className="p-1.5 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors cursor-pointer flex items-center justify-center"
          title={isExpanded ? 'Collapse Sidebar' : 'Expand Sidebar'}
        >
          <span className="material-symbols-outlined text-lg">
            {isExpanded ? 'chevron_left' : 'chevron_right'}
          </span>
        </button>
      </div>

      {isExpanded && (
        <div className="flex-1 overflow-y-auto flex flex-col custom-scrollbar">
          <div className="p-3 bg-surface-container-low/60 border-b border-outline-variant/40 flex items-center justify-between gap-2 shrink-0">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="flex-1 py-1.5 px-3 rounded-xl bg-surface-container-lowest border border-outline-variant/60 hover:bg-primary hover:text-on-primary disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center gap-1.5 font-label text-xs font-bold text-on-surface shadow-2xs"
              title="Undo (Ctrl Z)"
            >
              <span className="material-symbols-outlined text-base">undo</span>
              <span>Undo</span>
            </button>

            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="flex-1 py-1.5 px-3 rounded-xl bg-surface-container-lowest border border-outline-variant/60 hover:bg-primary hover:text-on-primary disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center gap-1.5 font-label text-xs font-bold text-on-surface shadow-2xs"
              title="Redo (Ctrl Shift Z or Ctrl Y)"
            >
              <span className="material-symbols-outlined text-base">redo</span>
              <span>Redo</span>
            </button>
          </div>

          <div className="p-4 space-y-4 flex-1">
            {isPenMode && (
              <PenInspector
                config={penConfig}
                onChange={onPenConfigChange}
              />
            )}

            {isLaserMode && (
              <LaserInspector
                config={laserConfig}
                onChange={onLaserConfigChange}
              />
            )}

            {!isLaserMode && hasContrastIssue && (
              <div className="p-3 bg-warning-container text-on-warning-container rounded-xl border border-warning/40 shadow-sm flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-warning text-lg">warning</span>
                  <span className="font-label font-bold text-xs">Low Contrast ({currentRatio.toFixed(1)}:1)</span>
                </div>
                <p className="text-[11px] text-on-warning-container/80 leading-relaxed">
                  Text color may be hard to read against the current background.
                </p>
                <button
                  onClick={handleFixContrast}
                  className="self-start px-3 py-1 bg-warning text-on-warning text-xs font-bold rounded-lg hover:brightness-110 transition-all cursor-pointer shadow-xs"
                >
                  Auto-Fix Contrast
                </button>
              </div>
            )}

            {!isLaserMode &&
              sections.map((sec) => {
                const isSecCollapsed = collapsedSections[sec.id];
                const isTypoTarget = sec.id === PROPERTY_SECTIONS.TYPOGRAPHY && editingContext === 'text';

                return (
                  <div
                    key={sec.id}
                    ref={sec.id === PROPERTY_SECTIONS.TYPOGRAPHY ? typographySectionRef : null}
                    className={`border rounded-xl bg-surface-container-lowest overflow-hidden transition-all duration-200 ${
                      isTypoTarget
                        ? 'border-primary ring-2 ring-primary/60 bg-primary/5 shadow-md'
                        : 'border-outline-variant/40 shadow-2xs'
                    }`}
                  >
                    <button
                      onClick={() => toggleSection(sec.id)}
                      className={`w-full px-3.5 py-2.5 flex items-center justify-between transition-colors cursor-pointer text-left ${
                        isTypoTarget ? 'bg-primary/10 hover:bg-primary/15' : 'bg-surface-container-low/40 hover:bg-surface-container-high/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-base">{sec.icon}</span>
                        <span className="font-label font-bold text-xs text-on-surface">{sec.title}</span>
                        {isTypoTarget && (
                          <span className="px-1.5 py-0.5 bg-primary text-on-primary text-[9px] font-bold rounded-full uppercase tracking-wide">
                            Active
                          </span>
                        )}
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant text-base transition-transform duration-200">
                        {isSecCollapsed ? 'expand_more' : 'expand_less'}
                      </span>
                    </button>

                    {!isSecCollapsed && (
                      <div className="p-3.5 space-y-3 text-xs font-label">
                        {sec.id === PROPERTY_SECTIONS.APPEARANCE && (
                          <div className="space-y-3">
                            {sec.hasFill && (
                              <UniversalColorPicker
                                label="Fill Color"
                                color={effectiveBg}
                                onChange={(val) => onApplyProperty('fill', val)}
                              />
                            )}
                            {sec.hasBorder && (
                              <UniversalColorPicker
                                label="Border Color"
                                color={stroke || '#000000'}
                                onChange={(val) => onApplyProperty('stroke', val)}
                              />
                            )}
                          </div>
                        )}

                        {sec.id === PROPERTY_SECTIONS.STROKE && (
                          <div className="space-y-3">
                            {sec.hasStrokeWidth && (
                              <div className="flex items-center justify-between">
                                <span className="text-on-surface-variant font-bold">Thickness:</span>
                                <select
                                  value={strokeWidth}
                                  onChange={(e) => onApplyProperty('strokeWidth', Number(e.target.value))}
                                  className="bg-surface-container-high border border-outline-variant rounded-lg px-2.5 py-1 text-xs text-on-surface outline-none cursor-pointer hover:border-primary font-mono"
                                >
                                  <option value={1}>1px</option>
                                  <option value={2}>2px</option>
                                  <option value={4}>4px</option>
                                  <option value={6}>6px</option>
                                  <option value={8}>8px</option>
                                </select>
                              </div>
                            )}

                            {sec.hasStrokeStyle && (
                              <div className="flex items-center justify-between">
                                <span className="text-on-surface-variant font-bold">Style:</span>
                                <div className="flex items-center gap-1">
                                  {['solid', 'dashed', 'dotted'].map((style) => (
                                    <button
                                      key={style}
                                      onClick={() => onApplyProperty('strokeDashArray', style)}
                                      className={`px-2.5 py-1 rounded-lg border text-[11px] capitalize cursor-pointer transition-all ${
                                        strokeDashArray === style
                                          ? 'bg-primary text-on-primary border-primary font-bold shadow-xs'
                                          : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                                      }`}
                                    >
                                      {style}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {sec.id === PROPERTY_SECTIONS.TYPOGRAPHY && (
                          <div className="space-y-3">
                            {sec.hasTextColor && (
                              <UniversalColorPicker
                                label="Text Color"
                                color={effectiveText}
                                onChange={(val) => onApplyProperty('textColor', val)}
                              />
                            )}

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <span className="text-on-surface-variant font-bold text-[11px] block mb-1">Font:</span>
                                <select
                                  value={fontFamily}
                                  onChange={(e) => onApplyProperty('fontFamily', e.target.value)}
                                  className="w-full bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none cursor-pointer hover:border-primary font-bold"
                                >
                                  <option value="Quicksand">Quicksand</option>
                                  <option value="Nunito Sans">Nunito Sans</option>
                                  <option value="Inter">Inter</option>
                                  <option value="Roboto">Roboto</option>
                                  <option value="Space Grotesk">Space Grotesk</option>
                                </select>
                              </div>

                              <div>
                                <span className="text-on-surface-variant font-bold text-[11px] block mb-1">Size:</span>
                                <select
                                  value={fontSize}
                                  onChange={(e) => onApplyProperty('fontSize', Number(e.target.value))}
                                  className="w-full bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none cursor-pointer hover:border-primary font-bold"
                                >
                                  <option value={12}>12px</option>
                                  <option value={14}>14px</option>
                                  <option value={16}>16px</option>
                                  <option value={20}>20px</option>
                                  <option value={24}>24px</option>
                                  <option value={32}>32px</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => onApplyProperty('fontWeight', fontWeight === 'bold' ? 'normal' : 'bold')}
                                  className={`p-1.5 rounded-lg border cursor-pointer transition-all ${
                                    fontWeight === 'bold'
                                      ? 'bg-primary text-on-primary border-primary shadow-xs font-black'
                                      : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                                  }`}
                                  title="Toggle Bold"
                                >
                                  <span className="material-symbols-outlined text-base">format_bold</span>
                                </button>
                              </div>

                              <div className="flex items-center gap-0.5 border border-outline-variant rounded-lg p-0.5">
                                {['left', 'center', 'right'].map((align) => (
                                  <button
                                    key={align}
                                    onClick={() => onApplyProperty('textAlign', align)}
                                    className={`p-1 rounded cursor-pointer transition-colors ${
                                      textAlign === align ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'
                                    }`}
                                    title={`Align ${align}`}
                                  >
                                    <span className="material-symbols-outlined text-sm">format_align_{align}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {sec.id === PROPERTY_SECTIONS.LAYOUT && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-on-surface-variant font-bold">Opacity:</span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="0.1"
                                  max="1"
                                  step="0.05"
                                  value={opacity}
                                  onChange={(e) => onApplyProperty('opacity', Number(e.target.value))}
                                  className="w-24 accent-primary cursor-pointer"
                                />
                                <span className="text-[11px] font-mono text-on-surface min-w-[32px] text-right">
                                  {Math.round(opacity * 100)}%
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-on-surface-variant font-bold">Rotation:</span>
                              <div className="relative flex items-center">
                                <input
                                  type="number"
                                  min="0"
                                  max="360"
                                  value={Math.round((selectedProps?.angle || 0) % 360 + 360) % 360}
                                  onChange={(e) => onApplyProperty('angle', Number(e.target.value))}
                                  className="w-16 bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none hover:border-primary font-mono text-right pr-4"
                                />
                                <span className="absolute right-1.5 text-[11px] text-on-surface-variant select-none pointer-events-none">°</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {sec.id === PROPERTY_SECTIONS.ACTIONS && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={onDuplicate}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-surface-container-high hover:bg-primary hover:text-on-primary rounded-xl text-on-surface border border-outline-variant transition-all cursor-pointer font-bold shadow-xs text-xs"
                              >
                                <span className="material-symbols-outlined text-base">content_copy</span>
                                <span>Duplicate</span>
                              </button>

                              <button
                                onClick={onBringToFront}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-surface-container-high hover:bg-primary hover:text-on-primary rounded-xl text-on-surface border border-outline-variant transition-all cursor-pointer font-bold shadow-xs text-xs"
                              >
                                <span className="material-symbols-outlined text-base">flip_to_front</span>
                                <span>Front</span>
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={onSendToBack}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-surface-container-high hover:bg-primary hover:text-on-primary rounded-xl text-on-surface border border-outline-variant transition-all cursor-pointer font-bold shadow-xs text-xs"
                              >
                                <span className="material-symbols-outlined text-base">flip_to_back</span>
                                <span>Back</span>
                              </button>

                              <button
                                onClick={onDelete}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-error-container hover:bg-error hover:text-on-error text-on-error-container rounded-xl border border-error/30 transition-all cursor-pointer font-bold shadow-xs text-xs"
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                                <span>Delete</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </aside>
  );
};

export default PropertiesSidebar;
