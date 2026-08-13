import React from 'react';
import UniversalColorPicker from '../ui/UniversalColorPicker';
import { isLowContrast, getBestReadableTextColor, getContrastRatio } from '../../utils/contrastUtils';

export const ObjectPropertiesPanel = ({
  selectedProps,
  onApplyProperty,
  onDuplicate,
  onDelete
}) => {
  if (!selectedProps || !selectedProps.hasSelection) return null;

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
    contrastResolved = false
  } = selectedProps;

  const effectiveBg = noteColor || (typeof fill === 'string' && fill !== 'transparent' ? fill : '#ffffff');

  const effectiveText = textColor || '#1e293b';

  const currentRatio = getContrastRatio(effectiveBg, effectiveText);

  const hasContrastIssue = hasText && !contrastResolved && isLowContrast(effectiveBg, effectiveText);

  const handleFixContrast = (e) => {
    e.stopPropagation();
    const recommended = getBestReadableTextColor(effectiveBg);
    onApplyProperty('autoFixContrast', recommended);
  };

  const handleDeleteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDelete) onDelete();
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-surface/95 backdrop-blur-md rounded-2xl p-2.5 border-2 border-primary sticker-shadow flex flex-wrap items-center gap-3 text-xs font-label"
    >
      <UniversalColorPicker
        label="Fill"
        color={effectiveBg}
        onChange={(val) => onApplyProperty('fill', val)}
      />

      <UniversalColorPicker
        label="Border"
        color={stroke || '#000000'}
        onChange={(val) => onApplyProperty('stroke', val)}
      />

      {hasText && (
        <UniversalColorPicker
          label="Text"
          color={effectiveText}
          onChange={(val) => onApplyProperty('textColor', val)}
        />
      )}

      {hasContrastIssue && (
        <div className="flex items-center gap-1.5 bg-warning-container text-on-warning-container px-2.5 py-1 rounded-full border border-warning">
          <span className="material-symbols-outlined text-sm text-warning">warning</span>
          <span className="font-bold text-[11px]">Low Contrast ({currentRatio.toFixed(1)}:1)</span>
          <button
            onClick={handleFixContrast}
            className="underline font-bold text-[11px] hover:text-primary cursor-pointer ml-1"
            title="Auto Fix Contrast (Smart Readability)"
          >
            Auto-Fix
          </button>
        </div>
      )}

      <div className="h-4 w-px bg-outline-variant/60 mx-0.5" />

      <div className="flex items-center gap-1.5">
        <span className="text-on-surface-variant font-bold">Width:</span>
        <select
          value={strokeWidth}
          onChange={(e) => onApplyProperty('strokeWidth', Number(e.target.value))}
          className="bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none cursor-pointer hover:border-primary"
        >
          <option value={1}>1px</option>
          <option value={2}>2px</option>
          <option value={4}>4px</option>
          <option value={6}>6px</option>
          <option value={8}>8px</option>
        </select>
      </div>

      <div className="flex items-center gap-1">
        {['solid', 'dashed', 'dotted'].map((style) => (
          <button
            key={style}
            onClick={() => onApplyProperty('strokeDashArray', style)}
            className={`px-2 py-1 rounded-lg border text-[11px] capitalize cursor-pointer transition-all ${
              strokeDashArray === style
                ? 'bg-primary text-on-primary border-primary font-bold shadow-sm'
                : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {style}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-outline-variant/60 mx-0.5" />

      <div className="flex items-center gap-2">
        <span className="text-on-surface-variant font-bold">Opacity:</span>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(e) => onApplyProperty('opacity', Number(e.target.value))}
          className="w-16 accent-primary cursor-pointer"
        />
        <span className="text-[11px] font-mono text-on-surface min-w-[28px]">
          {Math.round(opacity * 100)}%
        </span>
      </div>

      <div className="h-4 w-px bg-outline-variant/60 mx-0.5" />

      <div className="flex items-center gap-1.5">
        <span className="text-on-surface-variant font-bold">Rotate:</span>
        <div className="relative flex items-center">
          <input
            type="number"
            min="0"
            max="360"
            value={Math.round((selectedProps?.angle || 0) % 360 + 360) % 360}
            onChange={(e) => onApplyProperty('angle', Number(e.target.value))}
            className="w-14 bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none hover:border-primary font-mono text-right pr-4"
          />
          <span className="absolute right-1.5 text-[11px] text-on-surface-variant select-none pointer-events-none">°</span>
        </div>
      </div>

      {hasText && (
        <>
          <div className="h-4 w-px bg-outline-variant/60 mx-0.5" />
          <div className="flex items-center gap-2">
            <select
              value={fontFamily}
              onChange={(e) => onApplyProperty('fontFamily', e.target.value)}
              className="bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none cursor-pointer hover:border-primary font-bold"
            >
              <option value="Quicksand">Quicksand</option>
              <option value="Nunito Sans">Nunito Sans</option>
              <option value="Inter">Inter</option>
              <option value="Roboto">Roboto</option>
              <option value="Space Grotesk">Space Grotesk</option>
            </select>

            <select
              value={fontSize}
              onChange={(e) => onApplyProperty('fontSize', Number(e.target.value))}
              className="bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs text-on-surface outline-none cursor-pointer hover:border-primary font-bold"
            >
              <option value={12}>12px</option>
              <option value={14}>14px</option>
              <option value={16}>16px</option>
              <option value={20}>20px</option>
              <option value={24}>24px</option>
              <option value={32}>32px</option>
            </select>

            <button
              onClick={() => onApplyProperty('fontWeight', fontWeight === 'bold' ? 'normal' : 'bold')}
              className={`p-1.5 rounded-lg border cursor-pointer transition-all ${
                fontWeight === 'bold'
                  ? 'bg-primary text-on-primary border-primary shadow-sm font-black'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
              }`}
              title="Toggle Bold"
            >
              <span className="material-symbols-outlined text-base">format_bold</span>
            </button>

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
        </>
      )}

      <div className="h-4 w-px bg-outline-variant/60 mx-0.5" />

      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-container-high hover:bg-primary hover:text-on-primary rounded-xl text-on-surface border border-outline-variant transition-all cursor-pointer font-bold shadow-sm"
          title="Duplicate Object"
        >
          <span className="material-symbols-outlined text-base">content_copy</span>
          <span>Duplicate</span>
        </button>

        <button
          onClick={handleDeleteClick}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-error-container text-on-error-container hover:bg-error hover:text-on-error rounded-xl transition-all cursor-pointer font-bold shadow-sm"
          title="Delete Object"
        >
          <span className="material-symbols-outlined text-base">delete</span>
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
};

export default ObjectPropertiesPanel;
