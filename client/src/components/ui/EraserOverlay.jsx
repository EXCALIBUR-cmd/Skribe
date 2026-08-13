import React, { useEffect, useRef, useState } from 'react';
import { isReducedMotion } from '../../animations/config';
import eraserManager from '../../utils/EraserManager';

export const EraserOverlay = ({ activeTool }) => {
  const isEraserActive = activeTool === 'eraser';

  const overlayRef = useRef(null);
  const particleCanvasRef = useRef(null);

  const targetPosRef = useRef({ x: -100, y: -100 });
  const currentPosRef = useRef({ x: -100, y: -100, angle: 0 });
  const trailRef = useRef([]);
  const particlesRef = useRef([]);
  const animFrameRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isEraserActive) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);

    const handleMouseMove = (e) => {
      targetPosRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('mousemove', handleMouseMove);

    eraserManager.setEraseCallback((pos) => {
      spawnDissolveParticles(pos);
    });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      eraserManager.setEraseCallback(null);
    };
  }, [isEraserActive]);

  const spawnDissolveParticles = (pos) => {
    if (isReducedMotion() || !pos) return;

    const count = 16;
    const newParticles = [];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      newParticles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        size: 3 + Math.random() * 4,
        alpha: 1,
        life: 1,
        decay: 0.04 + Math.random() * 0.05,
        color: Math.random() > 0.4 ? '#ffffff' : Math.random() > 0.5 ? '#f1f5f9' : '#cbd5e1'
      });
    }

    particlesRef.current.push(...newParticles);
  };

  useEffect(() => {
    if (!isEraserActive) return;

    const canvas = particleCanvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    let prevX = targetPosRef.current.x;
    let prevY = targetPosRef.current.y;

    const renderLoop = () => {
      const reduced = isReducedMotion();
      const target = targetPosRef.current;
      const current = currentPosRef.current;

      if (reduced) {
        current.x = target.x;
        current.y = target.y;
        current.angle = 0;
      } else {

        const lerp = 0.24;
        current.x += (target.x - current.x) * lerp;
        current.y += (target.y - current.y) * lerp;

        const vx = current.x - prevX;
        const vy = current.y - prevY;
        prevX = current.x;
        prevY = current.y;

        const rawAngle = vx * 0.5;
        const targetAngle = Math.max(-12, Math.min(12, rawAngle));
        current.angle += (targetAngle - current.angle) * 0.2;

        const speed = Math.hypot(vx, vy);
        if (speed > 1.5) {
          trailRef.current.unshift({ x: current.x, y: current.y, angle: current.angle, opacity: 0.4 });
          if (trailRef.current.length > 4) trailRef.current.pop();
        }
      }

      trailRef.current.forEach((t) => {
        t.opacity *= 0.72;
      });
      trailRef.current = trailRef.current.filter((t) => t.opacity > 0.05);

      if (overlayRef.current) {
        overlayRef.current.style.transform = `translate3d(${current.x - 18}px, ${current.y - 36}px, 0px) rotate(${current.angle}deg)`;
      }

      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          particlesRef.current.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            p.alpha = Math.max(0, p.life);

            if (p.alpha > 0) {
              ctx.save();
              ctx.globalAlpha = p.alpha;
              ctx.fillStyle = p.color;
              ctx.shadowColor = 'rgba(239, 68, 68, 0.4)';
              ctx.shadowBlur = 4;
              ctx.beginPath();
              ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          });

          particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
        }
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);

    const handleResize = () => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [isEraserActive]);

  if (!isEraserActive || !isVisible) return null;

  return (
    <div className="fixed inset-0 z-[9998] pointer-events-none overflow-hidden">
      <canvas ref={particleCanvasRef} className="absolute inset-0 pointer-events-none" />

      {!isReducedMotion() &&
        trailRef.current.map((t, idx) => (
          <div
            key={idx}
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              transform: `translate3d(${t.x - 18}px, ${t.y - 36}px, 0px) rotate(${t.angle}deg)`,
              opacity: t.opacity * 0.35,
              willChange: 'transform, opacity'
            }}
            className="pointer-events-none"
          >
            <div className="w-10 h-14 bg-slate-200/50 rounded-xl blur-[1px]" />
          </div>
        ))}

      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          willChange: 'transform',
          filter: 'drop-shadow(0 12px 20px rgba(0, 0, 0, 0.28))'
        }}
        className="pointer-events-none transition-opacity duration-150"
      >
        <svg
          width="42"
          height="58"
          viewBox="0 0 42 58"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="select-none"
        >
          <defs>
            <linearGradient id="eraserRubberGrad" x1="0" y1="0" x2="42" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="60%" stopColor="#f1f5f9" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>

            <linearGradient id="eraserSleeveGrad" x1="0" y1="22" x2="42" y2="58" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="50%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>

            <filter id="bevelInset" x="0" y="0" width="42" height="58" filterUnits="userSpaceOnUse">
              <feGaussianBlur stdDeviation="1" />
            </filter>
          </defs>

          <rect x="3" y="3" width="36" height="32" rx="7" fill="url(#eraserRubberGrad)" stroke="#cbd5e1" strokeWidth="1.5" />

          <path d="M7 6H35" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
          <path d="M7 10L35 10" stroke="#e2e8f0" strokeWidth="0.75" strokeLinecap="round" opacity="0.6" />

          <rect x="2" y="22" width="38" height="33" rx="5" fill="url(#eraserSleeveGrad)" stroke="#1e40af" strokeWidth="1.5" />

          <line x1="2" y1="26" x2="40" y2="26" stroke="#fbbf24" strokeWidth="1.5" />
          <line x1="2" y1="30" x2="40" y2="30" stroke="#ffffff" strokeWidth="1" opacity="0.8" />

          <circle cx="21" cy="41" r="5" fill="#ffffff" opacity="0.9" />
          <path d="M19 41L23 41M21 39L21 43" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" />

          <path d="M4 53C12 55 30 55 38 53" stroke="#1e3a8a" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        </svg>
      </div>
    </div>
  );
};

export default EraserOverlay;
