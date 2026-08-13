import React, { useState, useEffect, useRef } from 'react';
import { parseColorToRgb } from '../../utils/contrastUtils';
import ScrollablePopover from './ScrollablePopover';

export const UniversalColorPicker = ({ label = 'Color', color = '#000000', onChange, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const buttonRef = useRef(null);

  const [recentColors, setRecentColors] = useState([
    '#000000', '#ffffff', '#fff3a0', '#fef9c3', '#dcfce7', '#e0f2fe', '#f3e8ff', '#ffedd5', '#ffe4e6', '#fce7f3'
  ]);

  useEffect(() => {
    setHexInput(color);
  }, [color]);

  const presetCategories = [
    {
      name: 'Default Palette',
      colors: [
        '#000000', '#ffffff', '#fff3a0', '#fef9c3', '#dcfce7',
        '#e0f2fe', '#f3e8ff', '#ffedd5', '#ffe4e6', '#fce7f3'
      ]
    },
    {
      name: 'Vibrant Colors',
      colors: [
        '#000000', '#ae2f34', '#ff6b6b', '#ff9800', '#ffd600',
        '#006a65', '#00e5ff', '#3b82f6', '#8b5cf6', '#ec4899'
      ]
    },
    {
      name: 'Neutrals & Tones',
      colors: [
        '#000000', '#151c25', '#334155', '#475569', '#64748b',
        '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9', '#ffffff'
      ]
    }
  ];

  const handleSelectColor = (selectedColor) => {
    setHexInput(selectedColor);
    if (onChange) onChange(selectedColor);

    setRecentColors((prev) => {
      const filtered = prev.filter((c) => c.toLowerCase() !== selectedColor.toLowerCase());
      return [selectedColor, ...filtered].slice(0, 10);
    });
  };

  const rgb = parseColorToRgb(color);

  const handleRgbChange = (channel, val) => {
    const newRgb = { ...rgb, [channel]: Math.max(0, Math.min(255, Number(val) || 0)) };
    const hex = '#' + ((1 << 24) + (newRgb.r << 16) + (newRgb.g << 8) + newRgb.b).toString(16).slice(1);
    handleSelectColor(hex);
  };

  const isLightColor = (hex) => {
    if (!hex || typeof hex !== 'string') return false;
    const cleanHex = hex.replace('#', '');
    if (cleanHex.length !== 6) return false;
    const r = parseInt(cleanHex.substr(0, 2), 16);
    const g = parseInt(cleanHex.substr(2, 2), 16);
    const b = parseInt(cleanHex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 165;
  };

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={`relative ${className}`}
    >
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="flex items-center justify-between w-full px-3 py-1.5 rounded-xl border border-outline-variant bg-surface-container-high hover:border-primary transition-all cursor-pointer shadow-2xs"
        title={`Change ${label}`}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded-full border border-black/20 shadow-inner shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="font-label text-xs font-bold text-on-surface">{label}</span>
        </div>
        <span className="font-mono text-[11px] text-on-surface-variant uppercase font-bold">{color}</span>
      </button>

      <ScrollablePopover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        anchorRef={buttonRef}
        width={280}
        maxHeight="calc(100vh - 100px)"
      >
        <div className="flex justify-between items-center mb-3 pb-2 border-b border-surface-variant">
          <h4 className="font-label font-bold text-xs text-on-surface uppercase tracking-wider">{label} Picker</h4>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            className="text-on-surface-variant hover:text-primary p-0.5 rounded cursor-pointer"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {recentColors.length > 0 && (
          <div className="mb-3">
            <span className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
              Recently Used
            </span>
            <div className="flex flex-wrap gap-2 items-center w-full">
              {recentColors.map((c, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectColor(c);
                  }}
                  style={{ backgroundColor: c }}
                  className="w-6 h-6 rounded-full border border-black/20 hover:scale-115 transition-transform cursor-pointer shadow-2xs shrink-0"
                  title={c}
                />
              ))}
            </div>
          </div>
        )}

        {presetCategories.map((cat) => (
          <div key={cat.name} className="mb-3">
            <span className="font-label text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">
              {cat.name}
            </span>
            <div className="flex flex-wrap gap-2 items-center w-full">
              {cat.colors.map((c) => {
                const isSelected = color && color.toLowerCase() === c.toLowerCase();
                const light = isLightColor(c);

                return (
                  <button
                    key={c}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectColor(c);
                    }}
                    style={{ backgroundColor: c }}
                    className={`w-6 h-6 rounded-full border shrink-0 transition-all cursor-pointer flex items-center justify-center ${
                      isSelected
                        ? 'scale-110 border-primary ring-2 ring-primary ring-offset-1 z-10 shadow-2xs'
                        : 'border-black/20 hover:scale-110'
                    }`}
                    title={c}
                  >
                    {isSelected && (
                      <span className={`material-symbols-outlined text-[12px] font-bold ${light ? 'text-slate-900' : 'text-white'}`}>
                        check
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="pt-2.5 border-t border-surface-variant flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-label text-xs font-bold text-on-surface-variant">HEX:</span>
              <input
                type="text"
                value={hexInput}
                onChange={(e) => {
                  setHexInput(e.target.value);
                  if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
                    handleSelectColor(e.target.value);
                  }
                }}
                className="w-20 bg-surface-container-high border border-outline-variant rounded-lg px-2 py-1 text-xs font-mono text-on-surface outline-none focus:border-primary uppercase"
              />
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer bg-surface-container-high px-2.5 py-1 rounded-lg border border-outline-variant hover:border-primary transition-all">
              <input
                type="color"
                value={color && color.startsWith('#') ? color : '#000000'}
                onInput={(e) => handleSelectColor(e.target.value)}
                onChange={(e) => handleSelectColor(e.target.value)}
                className="w-4 h-4 rounded cursor-pointer border-none bg-transparent"
              />
              <span className="font-label text-xs font-bold">Custom</span>
            </label>
          </div>

          <div className="flex items-center justify-between text-xs font-label pt-1">
            <span className="text-on-surface-variant font-bold">RGB:</span>
            <div className="flex items-center gap-1.5">
              {['r', 'g', 'b'].map((ch) => (
                <div key={ch} className="flex items-center gap-1">
                  <span className="uppercase text-[10px] text-on-surface-variant font-bold">{ch}</span>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={rgb[ch]}
                    onChange={(e) => handleRgbChange(ch, e.target.value)}
                    className="w-10 bg-surface-container-high border border-outline-variant rounded-md px-1 py-0.5 text-xs text-center font-mono text-on-surface outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollablePopover>
    </div>
  );
};

export default UniversalColorPicker;
