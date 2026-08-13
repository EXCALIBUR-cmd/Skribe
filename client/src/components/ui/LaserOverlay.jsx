import React, { useEffect, useRef } from 'react';
import { isReducedMotion } from '../../animations/config';

export const LaserOverlay = ({
  activeTool,
  laserConfig = {
    color: '#ef4444',
    width: 8,
    duration: 1500,
    glow: 'medium'
  }
}) => {
  const isLaserActive = activeTool === 'laser';

  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const isMouseDownRef = useRef(false);
  const animFrameRef = useRef(null);

  useEffect(() => {
    if (!isLaserActive) {
      pointsRef.current = [];
      isMouseDownRef.current = false;
      return;
    }

    const handleMouseDown = (e) => {

      if (e.button === 0) {
        isMouseDownRef.current = true;
        const now = Date.now();
        pointsRef.current.push({
          x: e.clientX,
          y: e.clientY,
          timestamp: now,
          color: laserConfig.color || '#ef4444',
          width: laserConfig.width || 8,
          userId: 'local'
        });
      }
    };

    const handleMouseMove = (e) => {
      if (isMouseDownRef.current) {
        const now = Date.now();
        pointsRef.current.push({
          x: e.clientX,
          y: e.clientY,
          timestamp: now,
          color: laserConfig.color || '#ef4444',
          width: laserConfig.width || 8,
          userId: 'local'
        });
      }
    };

    const handleMouseUp = () => {
      isMouseDownRef.current = false;
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isLaserActive, laserConfig]);

  useEffect(() => {
    if (!isLaserActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const renderLoop = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const now = Date.now();
      const duration = laserConfig.duration || 1500;
      const reduced = isReducedMotion();

      pointsRef.current = pointsRef.current.filter((p) => now - p.timestamp < duration);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const points = pointsRef.current;

      if (points.length > 0) {
        if (reduced) {

          const lastPoint = points[points.length - 1];
          const age = now - lastPoint.timestamp;
          const alpha = Math.max(0, 1 - age / duration);

          if (alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = laserConfig.color || '#ef4444';
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, (laserConfig.width || 8) * 0.75, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        } else {

          ctx.save();

          const glowRadius = laserConfig.glow === 'high' ? 18 : laserConfig.glow === 'low' ? 6 : 12;

          for (let i = 1; i < points.length; i++) {
            const p1 = points[i - 1];
            const p2 = points[i];

            const age = now - p2.timestamp;
            const alpha = Math.max(0, 1 - age / duration);

            if (alpha <= 0) continue;

            ctx.beginPath();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = p2.color;
            ctx.lineWidth = p2.width * alpha;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.shadowColor = p2.color;
            ctx.shadowBlur = glowRadius * alpha;

            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;

            ctx.moveTo(p1.x, p1.y);
            ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
            ctx.stroke();
          }

          if (isMouseDownRef.current && points.length > 0) {
            const head = points[points.length - 1];
            ctx.beginPath();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = head.color;
            ctx.shadowBlur = glowRadius * 1.5;
            ctx.arc(head.x, head.y, (head.width || 8) * 0.6, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        }
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [isLaserActive, laserConfig]);

  if (!isLaserActive) return null;

  return (
    <div className="fixed inset-0 z-[9997] pointer-events-none overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
};

export default LaserOverlay;
