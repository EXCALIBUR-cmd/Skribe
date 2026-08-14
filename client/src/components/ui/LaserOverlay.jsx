import React, { useEffect, useRef } from 'react';
import { isReducedMotion } from '../../animations/config';
import socketService from '../../services/socket';

export const LaserOverlay = ({
  activeTool,
  laserConfig = {
    color: '#ef4444',
    width: 8,
    duration: 1500,
    glow: 'medium'
  },
  boardId,
  fabricCanvasRef
}) => {
  const isLaserActive = activeTool === 'laser';

  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const remotePointsMapRef = useRef(new Map());
  const isMouseDownRef = useRef(false);
  const animFrameRef = useRef(null);
  const lastEmitTimeRef = useRef(0);

  const getCanvasInstance = () => {
    if (!fabricCanvasRef?.current) return null;
    return typeof fabricCanvasRef.current.getCanvas === 'function'
      ? fabricCanvasRef.current.getCanvas()
      : fabricCanvasRef.current;
  };

  const getSceneCoordinates = (clientX, clientY) => {
    const canvas = getCanvasInstance();
    if (!canvas || typeof canvas.getElement !== 'function') return { sceneX: clientX, sceneY: clientY };
    try {
      const rect = canvas.getElement().getBoundingClientRect();
      const mousePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const invVpt = window.fabric?.util?.invertTransform
        ? window.fabric.util.invertTransform(canvas.viewportTransform)
        : null;
      if (invVpt && window.fabric?.util?.transformPoint) {
        const scenePoint = window.fabric.util.transformPoint(mousePoint, invVpt);
        return { sceneX: scenePoint.x, sceneY: scenePoint.y };
      }
    } catch (err) {
      console.error('[LaserOverlay] getSceneCoordinates error:', err);
    }
    return { sceneX: clientX, sceneY: clientY };
  };

  useEffect(() => {
    if (!boardId) return;

    const socket = socketService.getSocket();
    if (!socket) return;

    const handleRemoteMove = (data) => {
      if (!data || data.boardId !== boardId || !data.clientId) return;
      const key = data.clientId;
      const now = Date.now();
      const existing = remotePointsMapRef.current.get(key) || [];

      existing.push({
        sceneX: data.sceneX,
        sceneY: data.sceneY,
        timestamp: now,
        color: data.color || '#ef4444',
        width: data.width || 8,
        active: true
      });

      remotePointsMapRef.current.set(key, existing);
    };

    const handleRemoteHide = (data) => {
      if (!data || !data.clientId) return;
      const key = data.clientId;
      const points = remotePointsMapRef.current.get(key);
      if (points) {
        points.forEach((p) => (p.active = false));
      }
    };

    const handleUserLeft = (data) => {
      if (!data) return;
      remotePointsMapRef.current.forEach((pts, key) => {
        if (key.includes(data.userId) || key === data.socketId) {
          remotePointsMapRef.current.delete(key);
        }
      });
    };

    socket.on('laser:move', handleRemoteMove);
    socket.on('laser:hide', handleRemoteHide);
    socket.on('board:user:left', handleUserLeft);

    return () => {
      socket.off('laser:move', handleRemoteMove);
      socket.off('laser:hide', handleRemoteHide);
      socket.off('board:user:left', handleUserLeft);
      remotePointsMapRef.current.clear();
    };
  }, [boardId]);

  useEffect(() => {
    if (!isLaserActive) {
      if (isMouseDownRef.current && boardId) {
        socketService.emit('laser:hide', { boardId });
      }
      pointsRef.current = [];
      isMouseDownRef.current = false;
      return;
    }

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        isMouseDownRef.current = true;
        const now = Date.now();
        const { sceneX, sceneY } = getSceneCoordinates(e.clientX, e.clientY);

        pointsRef.current.push({
          x: e.clientX,
          y: e.clientY,
          sceneX,
          sceneY,
          timestamp: now,
          color: laserConfig.color || '#ef4444',
          width: laserConfig.width || 8,
          userId: 'local'
        });

        if (boardId) {
          lastEmitTimeRef.current = now;
          socketService.emit('laser:move', {
            boardId,
            sceneX,
            sceneY,
            color: laserConfig.color || '#ef4444',
            width: laserConfig.width || 8
          });
        }
      }
    };

    const handleMouseMove = (e) => {
      if (isMouseDownRef.current) {
        const now = Date.now();
        const { sceneX, sceneY } = getSceneCoordinates(e.clientX, e.clientY);

        pointsRef.current.push({
          x: e.clientX,
          y: e.clientY,
          sceneX,
          sceneY,
          timestamp: now,
          color: laserConfig.color || '#ef4444',
          width: laserConfig.width || 8,
          userId: 'local'
        });

        if (boardId && now - lastEmitTimeRef.current > 16) {
          lastEmitTimeRef.current = now;
          socketService.emit('laser:move', {
            boardId,
            sceneX,
            sceneY,
            color: laserConfig.color || '#ef4444',
            width: laserConfig.width || 8
          });
        }
      }
    };

    const handleMouseUp = () => {
      if (isMouseDownRef.current && boardId) {
        socketService.emit('laser:hide', { boardId });
      }
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
  }, [isLaserActive, laserConfig, boardId]);

  useEffect(() => {
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
      const fabricCanvas = getCanvasInstance();

      pointsRef.current = pointsRef.current.filter((p) => now - p.timestamp < duration);

      remotePointsMapRef.current.forEach((pts, key) => {
        const valid = pts.filter((p) => now - p.timestamp < duration);
        if (valid.length === 0) {
          remotePointsMapRef.current.delete(key);
        } else {
          remotePointsMapRef.current.set(key, valid);
        }
      });

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const renderTrail = (points, isMouseDown) => {
        if (!points || points.length === 0) return;

        if (reduced) {
          const lastPoint = points[points.length - 1];
          const age = now - lastPoint.timestamp;
          const alpha = Math.max(0, 1 - age / duration);

          if (alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = lastPoint.color || laserConfig.color || '#ef4444';
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, (lastPoint.width || 8) * 0.75, 0, Math.PI * 2);
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

          if (isMouseDown && points.length > 0) {
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
      };

      if (isLaserActive) {
        renderTrail(pointsRef.current, isMouseDownRef.current);
      }

      if (fabricCanvas && typeof fabricCanvas.getElement === 'function') {
        try {
          const rect = fabricCanvas.getElement().getBoundingClientRect();
          const vpt = fabricCanvas.viewportTransform;

          remotePointsMapRef.current.forEach((remotePts) => {
            if (!remotePts || remotePts.length === 0) return;

            const screenPoints = remotePts.map((p) => {
              let x = p.sceneX;
              let y = p.sceneY;
              if (vpt && window.fabric?.util?.transformPoint) {
                const pt = window.fabric.util.transformPoint({ x: p.sceneX, y: p.sceneY }, vpt);
                x = pt.x + rect.left;
                y = pt.y + rect.top;
              }
              return {
                x,
                y,
                timestamp: p.timestamp,
                color: p.color,
                width: p.width,
                active: p.active
              };
            });

            const lastRemotePoint = remotePts[remotePts.length - 1];
            const isRemoteActive = lastRemotePoint ? lastRemotePoint.active !== false : false;

            renderTrail(screenPoints, isRemoteActive);
          });
        } catch (err) {
          console.error('[LaserOverlay] remote render error:', err);
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

  return (
    <div className="fixed inset-0 z-[9997] pointer-events-none overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
};

export default LaserOverlay;
