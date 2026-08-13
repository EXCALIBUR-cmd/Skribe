import React, { useEffect, useRef } from 'react';
import UniversalColorPicker from '../ui/UniversalColorPicker';
import { isReducedMotion } from '../../animations/config';

export const PenInspector = ({
  config = {
    color: '#000000',
    width: 4,
    opacity: 1.0,
    brushType: 'standard'
  },
  onChange
}) => {
  const previewCanvasRef = useRef(null);
  const animFrameRef = useRef(null);

  const presetColors = [
    { name: 'Black', hex: '#000000' },
    { name: 'Charcoal', hex: '#334155' },
    { name: 'Red', hex: '#ef4444' },
    { name: 'Blue', hex: '#3b82f6' },
    { name: 'Green', hex: '#22c55e' },
    { name: 'Purple', hex: '#a855f7' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'White', hex: '#ffffff' }
  ];

  const handleConfigChange = (newConfig) => {
    if (newConfig.color !== config.color) {
      console.log(`[Pen Inspector] Selected Color: ${newConfig.color} | PenToolState Updated: ${newConfig.color}`);
    }
    if (onChange) {
      onChange(newConfig);
    }
  };

  const handleReset = () => {
    const defaultConfig = {
      color: '#000000',
      width: 4,
      opacity: 1.0,
      brushType: 'standard'
    };
    console.log(`[Pen Inspector] Selected Color: ${defaultConfig.color} | PenToolState Updated: ${defaultConfig.color}`);
    if (onChange) {
      onChange(defaultConfig);
    }
  };

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth || 280;
    canvas.height = canvas.offsetHeight || 96;

    let t = 0;

    const renderPreview = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width;
      const height = canvas.height;
      const cy = height / 2;

      ctx.save();
      ctx.globalAlpha = config.opacity ?? 1.0;
      ctx.strokeStyle = config.color || '#000000';
      ctx.lineWidth = config.width || 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      const margin = 24;
      const drawWidth = width - margin * 2;

      t += 0.03;

      for (let x = 0; x <= drawWidth; x += 2) {
        const px = margin + x;
        const py = cy + Math.sin(x * 0.04 + t) * 16 + Math.cos(x * 0.02 - t) * 8;
        if (x === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();

      ctx.restore();

      if (!isReducedMotion()) {
        animFrameRef.current = requestAnimationFrame(renderPreview);
      }
    };

    renderPreview();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [config.color, config.width, config.opacity]);

  return (
    <div className="space-y-4 font-label">
      <div className="border border-outline-variant/60 rounded-2xl bg-surface-container-lowest overflow-hidden shadow-2xs">
        <div className="px-3.5 py-2 flex items-center justify-between bg-surface-container-low/50 border-b border-outline-variant/40">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-sm">edit</span>
            <span className="font-label font-bold text-[11px] text-on-surface uppercase tracking-wider">
              Pen Stroke Preview
            </span>
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[10px] font-bold text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
            title="Reset to Default Pen Settings"
          >
            <span className="material-symbols-outlined text-xs">restart_alt</span>
            <span>Reset</span>
          </button>
        </div>

        <div className="p-3 bg-surface-container-low/30 relative flex items-center justify-center">
          <canvas
            ref={previewCanvasRef}
            className="w-full h-24 rounded-xl pointer-events-none"
          />
          <span className="absolute bottom-1.5 right-2 text-[9px] font-mono text-on-surface-variant/80 select-none">
            {config.width || 4}px • {Math.round((config.opacity ?? 1) * 100)}% Opacity
          </span>
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block">
          Stroke Color
        </span>

        <div className="flex flex-wrap gap-2 items-center w-full">
          {presetColors.map((c) => {
            const isSelected = config.color && config.color.toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                onClick={() => handleConfigChange({ ...config, color: c.hex })}
                style={{ backgroundColor: c.hex }}
                className={`w-6 h-6 rounded-full border transition-all cursor-pointer flex items-center justify-center ${
                  isSelected
                    ? 'scale-115 border-primary ring-2 ring-primary ring-offset-1 z-10 shadow-xs'
                    : 'border-black/20 hover:scale-110'
                }`}
                title={c.name}
              >
                {isSelected && (
                  <span className={`material-symbols-outlined text-[12px] font-bold ${c.hex === '#ffffff' ? 'text-slate-900' : 'text-white'}`}>
                    check
                  </span>
                )}
              </button>
            );
          })}

          <div className="ml-auto">
            <UniversalColorPicker
              label="Custom"
              color={config.color || '#000000'}
              onChange={(val) => handleConfigChange({ ...config, color: val })}
            />
          </div>
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between text-xs">
          <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
            Stroke Thickness
          </span>
          <span className="font-mono text-xs font-bold text-primary">{config.width || 4}px</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-on-surface-variant">Fine</span>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            value={config.width || 4}
            onChange={(e) => handleConfigChange({ ...config, width: Number(e.target.value) })}
            className="w-full accent-primary cursor-pointer h-1.5 bg-surface-container-high rounded-lg"
          />
          <span className="text-[10px] font-bold text-on-surface-variant">Bold</span>
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between text-xs">
          <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
            Stroke Opacity
          </span>
          <span className="font-mono text-xs font-bold text-primary">
            {Math.round((config.opacity ?? 1.0) * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-on-surface-variant">10%</span>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={config.opacity ?? 1.0}
            onChange={(e) => handleConfigChange({ ...config, opacity: Number(e.target.value) })}
            className="w-full accent-primary cursor-pointer h-1.5 bg-surface-container-high rounded-lg"
          />
          <span className="text-[10px] font-bold text-on-surface-variant">100%</span>
        </div>
      </div>
    </div>
  );
};

export default PenInspector;
