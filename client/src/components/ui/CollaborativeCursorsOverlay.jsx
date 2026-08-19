import React, { useEffect, useState, useRef } from 'react';
import * as fabric from 'fabric';
import socketService from '../../services/socket';

const CURSOR_COLORS = [
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16'
];

const getUserColor = (idString = '') => {
  let hash = 0;
  for (let i = 0; i < idString.length; i++) {
    hash = idString.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[index];
};

export const CollaborativeCursorsOverlay = ({ boardId, fabricCanvasRef }) => {
  const [remoteCursors, setRemoteCursors] = useState({});
  const lastEmitTimeRef = useRef(0);
  const animFrameRef = useRef(null);

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
      const vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const invVpt = fabric.util?.invertTransform
        ? fabric.util.invertTransform(vpt)
        : null;
      if (invVpt && fabric.util?.transformPoint) {
        const scenePoint = fabric.util.transformPoint(mousePoint, invVpt);
        return { sceneX: scenePoint.x, sceneY: scenePoint.y };
      }
    } catch (err) {
      console.error('[CursorsOverlay] getSceneCoordinates error:', err);
    }
    return { sceneX: clientX, sceneY: clientY };
  };

  useEffect(() => {
    if (!boardId) return;

    const socket = socketService.getSocket();
    if (!socket) return;

    const handleRemoteCursorMove = (data) => {
      if (!data || data.boardId !== boardId || !data.clientId) return;
      setRemoteCursors((prev) => ({
        ...prev,
        [data.clientId]: {
          clientId: data.clientId,
          userId: data.userId,
          name: data.name || 'Collaborator',
          sceneX: data.sceneX,
          sceneY: data.sceneY,
          color: getUserColor(data.userId || data.clientId),
          lastUpdated: Date.now()
        }
      }));
    };

    const handleRemoteCursorHide = (data) => {
      if (!data || !data.clientId) return;
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[data.clientId];
        return next;
      });
    };

    const handleUserLeft = (data) => {
      if (!data) return;
      setRemoteCursors((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (next[key].userId === data.userId || key === data.socketId) {
            delete next[key];
          }
        });
        return next;
      });
    };

    socket.on('cursor:move', handleRemoteCursorMove);
    socket.on('cursor:hide', handleRemoteCursorHide);
    socket.on('board:user:left', handleUserLeft);

    return () => {
      socket.off('cursor:move', handleRemoteCursorMove);
      socket.off('cursor:hide', handleRemoteCursorHide);
      socket.off('board:user:left', handleUserLeft);
      setRemoteCursors({});
    };
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;

    const handleMouseMove = (e) => {
      const now = Date.now();
      if (now - lastEmitTimeRef.current < 20) return;
      lastEmitTimeRef.current = now;

      const { sceneX, sceneY } = getSceneCoordinates(e.clientX, e.clientY);

      socketService.emit('cursor:move', {
        boardId,
        sceneX,
        sceneY
      });
    };

    const handleMouseLeave = () => {
      socketService.emit('cursor:hide', { boardId });
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [boardId]);

  const canvas = getCanvasInstance();
  if (!canvas || typeof canvas.getElement !== 'function') return null;

  let rect = { left: 0, top: 0 };
  let vpt = [1, 0, 0, 1, 0, 0];
  try {
    rect = canvas.getElement().getBoundingClientRect();
    vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
  } catch (err) {
    console.error('[CursorsOverlay] render transform error:', err);
  }

  const activeRemoteCursors = Object.values(remoteCursors);
  if (activeRemoteCursors.length === 0) return null;

  return (
    <div className="fixed inset-0 z-9998 pointer-events-none overflow-hidden select-none">
      {activeRemoteCursors.map((cursor) => {
        let screenX = cursor.sceneX;
        let screenY = cursor.sceneY;

        if (vpt && fabric.util?.transformPoint) {
          const pt = fabric.util.transformPoint({ x: cursor.sceneX, y: cursor.sceneY }, vpt);
          screenX = pt.x + rect.left;
          screenY = pt.y + rect.top;
        }

        return (
          <div
            key={cursor.clientId}
            style={{
              transform: `translate3d(${screenX}px, ${screenY}px, 0)`
            }}
            className="absolute left-0 top-0 transition-transform duration-75 ease-out pointer-events-none select-none flex items-center gap-1.5 z-50"
          >
            <svg
              className="w-5 h-5 drop-shadow-md -rotate-45 transform -translate-x-1 -translate-y-1"
              viewBox="0 0 24 24"
              fill={cursor.color}
            >
              <path d="M5.653 3.123A1 1 0 004 4v16.5a1 1 0 001.653.75l4.512-3.87 3.235 6.07a1 1 0 001.378.397l2.5-1.332a1 1 0 00.397-1.378l-3.235-6.07 5.76-1.047A1 1 0 0020.5 14V4a1 1 0 00-1-1H5.653z" />
            </svg>
            <span
              style={{ backgroundColor: cursor.color }}
              className="text-white text-xs font-semibold px-2 py-0.5 rounded-full shadow-md whitespace-nowrap opacity-90 tracking-wide"
            >
              {cursor.name}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default CollaborativeCursorsOverlay;
