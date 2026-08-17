import React, { useEffect, useState, useRef } from 'react';
import socketService from '../../services/socket';

const SELECTION_COLORS = [
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
  const index = Math.abs(hash) % SELECTION_COLORS.length;
  return SELECTION_COLORS[index];
};

export const CollaborativeSelectionsOverlay = ({ boardId, fabricCanvasRef, selectedProps }) => {
  const [remoteSelections, setRemoteSelections] = useState({});
  const [, setTick] = useState(0);

  const getCanvasInstance = () => {
    if (!fabricCanvasRef?.current) return null;
    return typeof fabricCanvasRef.current.getCanvas === 'function'
      ? fabricCanvasRef.current.getCanvas()
      : fabricCanvasRef.current;
  };

  useEffect(() => {
    if (!boardId) return;

    if (selectedProps && selectedProps.hasSelection && selectedProps.id) {
      const ids = Array.isArray(selectedProps.ids) ? selectedProps.ids : [selectedProps.id];
      socketService.emit('selection:change', {
        boardId,
        objectIds: ids
      });
    } else {
      socketService.emit('selection:clear', { boardId });
    }
  }, [boardId, selectedProps]);

  useEffect(() => {
    if (!boardId) return;

    const socket = socketService.getSocket();
    if (!socket) return;

    const handleRemoteSelectionChange = (data) => {
      if (!data || data.boardId !== boardId || !data.clientId) return;
      setRemoteSelections((prev) => ({
        ...prev,
        [data.clientId]: {
          clientId: data.clientId,
          userId: data.userId,
          name: data.name || 'Collaborator',
          objectIds: Array.isArray(data.objectIds) ? data.objectIds : [],
          color: getUserColor(data.userId || data.clientId)
        }
      }));
    };

    const handleRemoteSelectionClear = (data) => {
      if (!data || !data.clientId) return;
      setRemoteSelections((prev) => {
        const next = { ...prev };
        delete next[data.clientId];
        return next;
      });
    };

    const handleUserLeft = (data) => {
      if (!data) return;
      setRemoteSelections((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (next[key].userId === data.userId || key === data.socketId) {
            delete next[key];
          }
        });
        return next;
      });
    };

    socket.on('selection:change', handleRemoteSelectionChange);
    socket.on('selection:clear', handleRemoteSelectionClear);
    socket.on('board:user:left', handleUserLeft);

    return () => {
      socket.off('selection:change', handleRemoteSelectionChange);
      socket.off('selection:clear', handleRemoteSelectionClear);
      socket.off('board:user:left', handleUserLeft);
      setRemoteSelections({});
    };
  }, [boardId]);

  useEffect(() => {
    const canvas = getCanvasInstance();
    if (!canvas || typeof canvas.on !== 'function') return;

    const triggerUpdate = () => {
      setTick((t) => (t + 1) % 1000);
    };

    canvas.on('after:render', triggerUpdate);
    canvas.on('object:moving', triggerUpdate);
    canvas.on('object:scaling', triggerUpdate);
    canvas.on('object:rotating', triggerUpdate);
    canvas.on('object:modified', triggerUpdate);

    return () => {
      canvas.off('after:render', triggerUpdate);
      canvas.off('object:moving', triggerUpdate);
      canvas.off('object:scaling', triggerUpdate);
      canvas.off('object:rotating', triggerUpdate);
      canvas.off('object:modified', triggerUpdate);
    };
  }, [boardId, fabricCanvasRef.current]);

  const canvas = getCanvasInstance();
  if (!canvas || typeof canvas.getElement !== 'function') return null;

  let domRect = { left: 0, top: 0 };
  try {
    domRect = canvas.getElement().getBoundingClientRect();
  } catch (err) {
    console.error('[SelectionsOverlay] rect error:', err);
  }

  const activeSelections = Object.values(remoteSelections);
  if (activeSelections.length === 0) return null;

  const allObjects = canvas.getObjects ? canvas.getObjects() : [];
  const selectionBoxes = [];

  activeSelections.forEach((sel) => {
    if (!Array.isArray(sel.objectIds)) return;

    sel.objectIds.forEach((targetId) => {
      const obj = allObjects.find((o) => o.id === targetId || o.elementId === targetId);
      if (!obj || typeof obj.getBoundingRect !== 'function') return;

      try {
        const rect = obj.getBoundingRect(true);
        selectionBoxes.push({
          key: `${sel.clientId}_${targetId}`,
          name: sel.name,
          color: sel.color,
          screenLeft: domRect.left + rect.left,
          screenTop: domRect.top + rect.top,
          width: rect.width,
          height: rect.height
        });
      } catch (err) {
        console.error('[SelectionsOverlay] getBoundingRect error:', err);
      }
    });
  });

  if (selectionBoxes.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[9996] pointer-events-none overflow-hidden select-none">
      {selectionBoxes.map((box) => (
        <div
          key={box.key}
          style={{
            transform: `translate3d(${box.screenLeft}px, ${box.screenTop}px, 0)`,
            width: `${Math.max(box.width, 10)}px`,
            height: `${Math.max(box.height, 10)}px`,
            borderColor: box.color,
            boxShadow: `0 0 12px ${box.color}66`
          }}
          className="absolute left-0 top-0 border-2 border-dashed rounded-lg transition-transform duration-75 ease-out pointer-events-none select-none z-40"
        >
          <span
            style={{ backgroundColor: box.color }}
            className="absolute -top-6 left-0 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md whitespace-nowrap opacity-95 tracking-wide"
          >
            {box.name}
          </span>
        </div>
      ))}
    </div>
  );
};

export default CollaborativeSelectionsOverlay;
