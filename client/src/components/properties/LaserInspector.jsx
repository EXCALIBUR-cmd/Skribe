import React, { useEffect, useRef } from 'react';
import UniversalColorPicker from '../ui/UniversalColorPicker';
import { isReducedMotion } from '../../animations/config';

export const LaserInspector = ({
  config = {
    color: '#ef4444',
    width: 16,
    duration: 1500,
    glow: 'medium'
  },
  onChange
}) => {
  const previewCanvasRef = useRef(null);
  const animFrameRef = useRef(null);

  const presetColors = [
    { name: 'Red', hex: '#ef4444' },
    { name: 'Blue', hex: '#3b82f6' },
    { name: 'Green', hex: '#22c55e' },
    { name: 'Purple', hex: '#a855f7' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'White', hex: '#ffffff' }
  ];

  const durations = [
    { label: '0.5s', value: 500 },
    { label: '1.0s', value: 1000 },
    { label: '1.5s', value: 1500 },
    { label: '2.0s', value: 2000 },
    { label: '3.0s', value: 3000 }
  ];

  const glowLevels = [
    { label: 'Low', value: 'low', blur: 6 },
    { label: 'Med', value: 'medium', blur: 12 },
    { label: 'High', value: 'high', blur: 18 },
    { label: 'Max', value: 'vhigh', blur: 24 }
  ];

  const handleReset = () => {
    if (onChange) {
      onChange({
        color: '#ef4444',
        width: 16,
        duration: 1500,
        glow: 'medium'
      });
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
    const trailPoints = [];

    const renderPreview = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      const scaleX = width * 0.35;
      const scaleY = height * 0.28;

      t += 0.04;
      const x = cx + Math.sin(t) * scaleX;
      const y = cy + Math.sin(2 * t) / 2 * scaleY;

      const now = Date.now();
      trailPoints.push({ x, y, timestamp: now });

      const duration = config.duration || 1500;
      const currentGlow = glowLevels.find((g) => g.value === config.glow) || glowLevels[1];
      const glowBlur = currentGlow.blur;

      const validPoints = trailPoints.filter((p) => now - p.timestamp < duration);

      ctx.save();

      if (isReducedMotion()) {
        const last = validPoints[validPoints.length - 1];
        if (last) {
          ctx.fillStyle = config.color || '#ef4444';
          ctx.beginPath();
          ctx.arc(last.x, last.y, (config.width || 16) * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        for (let i = 1; i < validPoints.length; i++) {
          const p1 = validPoints[i - 1];
          const p2 = validPoints[i];
          const age = now - p2.timestamp;
          const alpha = Math.max(0, 1 - age / duration);

          if (alpha <= 0) continue;

          ctx.beginPath();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = config.color || '#ef4444';
          ctx.lineWidth = (config.width || 16) * alpha;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = config.color || '#ef4444';
          ctx.shadowBlur = glowBlur * alpha;

          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;

          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
          ctx.stroke();
        }

        if (validPoints.length > 0) {
          const head = validPoints[validPoints.length - 1];
          ctx.beginPath();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = config.color || '#ef4444';
          ctx.shadowBlur = glowBlur * 1.4;
          ctx.arc(head.x, head.y, (config.width || 16) * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();

      while (trailPoints.length > 120) trailPoints.shift();

      animFrameRef.current = requestAnimationFrame(renderPreview);
    };

    animFrameRef.current = requestAnimationFrame(renderPreview);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [config.color, config.width, config.duration, config.glow]);

  return (
    <div className="space-y-4 font-label">
      <div className="border border-outline-variant/60 rounded-2xl bg-surface-container-lowest overflow-hidden shadow-2xs">
        <div className="px-3.5 py-2 flex items-center justify-between bg-surface-container-low/50 border-b border-outline-variant/40">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-sm">play_circle</span>
            <span className="font-label font-bold text-[11px] text-on-surface uppercase tracking-wider">
              Live Preview
            </span>
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[10px] font-bold text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
            title="Reset to Default Settings"
          >
            <span className="material-symbols-outlined text-xs">restart_alt</span>
            <span>Reset</span>
          </button>
        </div>

        <div className="p-3 bg-slate-950/95 relative flex items-center justify-center">
          <canvas
            ref={previewCanvasRef}
            className="w-full h-24 rounded-xl pointer-events-none"
          />
          <span className="absolute bottom-1.5 right-2 text-[9px] font-mono text-slate-400 select-none opacity-80">
            {config.width || 16}px • {((config.duration || 1500) / 1000).toFixed(1)}s • {config.glow || 'medium'}
          </span>
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block">
          Laser Color
        </span>

        <div className="flex flex-wrap gap-2 items-center w-full">
          {presetColors.map((c) => {
            const isSelected = config.color && config.color.toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                onClick={() => onChange({ ...config, color: c.hex })}
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
              color={config.color || '#ef4444'}
              onChange={(val) => onChange({ ...config, color: val })}
            />
          </div>
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between text-xs">
          <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
            Trail Width
          </span>
          <span className="font-mono text-xs font-bold text-primary">{config.width || 16}px</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-on-surface-variant">Thin</span>
          <input
            type="range"
            min="4"
            max="24"
            step="1"
            value={config.width || 16}
            onChange={(e) => onChange({ ...config, width: Number(e.target.value) })}
            className="w-full accent-primary cursor-pointer h-1.5 bg-surface-container-high rounded-lg"
          />
          <span className="text-[10px] font-bold text-on-surface-variant">Thick</span>
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block">
          Trail Duration
        </span>

        <div className="grid grid-cols-5 gap-1 bg-surface-container-high p-1 rounded-xl border border-outline-variant/50">
          {durations.map((d) => {
            const isSelected = (config.duration || 1500) === d.value;
            return (
              <button
                key={d.value}
                onClick={() => onChange({ ...config, duration: d.value })}
                className={`py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer text-center ${
                  isSelected
                    ? 'bg-primary text-on-primary shadow-2xs font-bold scale-102'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border border-outline-variant/40 rounded-2xl bg-surface-container-lowest p-3 space-y-2.5 shadow-2xs">
        <span className="font-label text-[11px] font-bold text-on-surface-variant uppercase tracking-wider block">
          Glow Intensity
        </span>

        <div className="grid grid-cols-4 gap-1 bg-surface-container-high p-1 rounded-xl border border-outline-variant/50">
          {glowLevels.map((g) => {
            const isSelected = (config.glow || 'medium') === g.value;
            return (
              <button
                key={g.value}
                onClick={() => onChange({ ...config, glow: g.value })}
                className={`py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer text-center ${
                  isSelected
                    ? 'bg-primary text-on-primary shadow-2xs font-bold scale-102'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LaserInspector;
