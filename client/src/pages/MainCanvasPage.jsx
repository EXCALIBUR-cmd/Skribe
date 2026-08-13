import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FabricCanvas from '../components/canvas/FabricCanvas';
import PropertiesSidebar from '../components/properties/PropertiesSidebar';
import ContextMenu from '../components/canvas/ContextMenu';
import ToastNotification from '../components/ui/ToastNotification';
import ToolWheel from '../components/ui/ToolWheel';
import EraserOverlay from '../components/ui/EraserOverlay';
import LaserOverlay from '../components/ui/LaserOverlay';
import apiClient from '../api/apiClient';
import eraserManager from '../utils/EraserManager';
import socketService from '../services/socket';
import { ShareBoardModal } from '../components/ui/ShareBoardModal';
import { useAuth } from '../context/AuthContext';

export const MainCanvasPage = () => {
  const { id: boardId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [boardTitle, setBoardTitle] = useState('Untitled Board');
  const [currentBoard, setCurrentBoard] = useState(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [activeUsers, setActiveUsers] = useState([]);

  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#000000');
  const [selectedProps, setSelectedProps] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [contextMenuPos, setContextMenuPos] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((title, message, icon = 'info', type = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, title, message, icon, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  const isInitialLoadingRef = useRef(true);
  const lastSavedJsonRef = useRef(null);
  const latestCanvasDataRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const saveSequenceRef = useRef(0);
  const abortControllerRef = useRef(null);

  const saveBoardData = useCallback(async (canvasDataToSave, isFlush = false) => {
    if (!boardId || isInitialLoadingRef.current || !canvasDataToSave) {
      console.log('[BOARD SAVE DEBUG] saveBoardData SKIPPED — boardId:', boardId, '| isInitialLoading:', isInitialLoadingRef.current, '| hasData:', !!canvasDataToSave);
      return;
    }

    const jsonString = JSON.stringify(canvasDataToSave);
    if (jsonString === lastSavedJsonRef.current && !isFlush) {
      console.log('[BOARD SAVE DEBUG] No change since last save — skipping');
      setSaveStatus('saved');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentSeq = ++saveSequenceRef.current;
    setSaveStatus('saving');

    console.log('[BOARD SAVE DEBUG] Saving board:', boardId);
    console.log('[BOARD SAVE DEBUG] Payload keys:', Object.keys(canvasDataToSave));
    console.log('[BOARD SAVE DEBUG] Payload object count:', canvasDataToSave?.objects?.length);

    try {
      const res = await apiClient.patch(
        `/boards/${boardId}`,
        { canvasData: canvasDataToSave },
        { signal: controller.signal }
      );

      console.log('[BOARD SAVE DEBUG] Save response status: 200');
      console.log('[BOARD SAVE DEBUG] Save response:', JSON.stringify(res).slice(0, 300));

      if (currentSeq !== saveSequenceRef.current) {
        console.log('[BOARD SAVE DEBUG] Stale save response — discarding (seq mismatch)');
        return;
      }

      if (res.success) {
        lastSavedJsonRef.current = jsonString;
        setSaveStatus('saved');
        console.log('[BOARD SAVE DEBUG] Board saved successfully. Persisted object count:', res.data?.board?.canvasData?.objects?.length);
      } else {
        setSaveStatus('error');
        console.error('[BOARD SAVE ERROR] Response success=false:', res);
      }
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError' || err.message === 'canceled') {
        console.log('[BOARD SAVE DEBUG] Request aborted (superseded by newer save)');
        return;
      }
      if (currentSeq === saveSequenceRef.current) {
        console.error('[BOARD SAVE ERROR] Status: unknown | Error:', err?.message || err);
        console.error('[BOARD SAVE ERROR] Full error:', err);
        setSaveStatus('error');
      }
    }
  }, [boardId]);

  const handleCanvasChange = useCallback(() => {
    if (isInitialLoadingRef.current) {
      console.log('[BOARD SAVE DEBUG] handleCanvasChange fired but isInitialLoading=true — suppressed');
      return;
    }

    const currentCanvasData = fabricCanvasRef.current?.toJSON();
    if (!currentCanvasData) {
      console.log('[BOARD SAVE DEBUG] handleCanvasChange fired but fabricCanvasRef.toJSON() returned null');
      return;
    }

    console.log('[BOARD SAVE DEBUG] handleCanvasChange — serializing canvas');
    console.log('[BOARD SAVE DEBUG] Serialized object count:', currentCanvasData?.objects?.length);

    latestCanvasDataRef.current = currentCanvasData;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setSaveStatus('saving');

    debounceTimerRef.current = setTimeout(() => {
      saveBoardData(latestCanvasDataRef.current);
    }, 1200);
  }, [saveBoardData]);

  useEffect(() => {
    if (!boardId) return;

    let isMounted = true;
    isInitialLoadingRef.current = true;

    const fetchBoardData = async () => {
      try {
        setLoadingBoard(true);
        const res = await apiClient.get(`/boards/${boardId}`);
        if (!isMounted) return;

        if (res.success && res.data?.board) {
          setCurrentBoard(res.data.board);
          setBoardTitle(res.data.board.title || 'Untitled Board');
          const canvasData = res.data.board.canvasData;

          console.log('[BOARD LOAD DEBUG] Board ID:', boardId);
          console.log('[BOARD LOAD DEBUG] Received canvas data:', !!canvasData);
          console.log('[BOARD LOAD DEBUG] Serialized object count:', canvasData?.objects?.length ?? 0);

          const initialJson = canvasData || { version: '6.5.1', objects: [] };
          lastSavedJsonRef.current = JSON.stringify(initialJson);
          latestCanvasDataRef.current = initialJson;

          const applyCanvasData = () => {
            if (!isMounted) return;
            if (fabricCanvasRef.current && typeof fabricCanvasRef.current.loadFromJSON === 'function') {
              console.log('[BOARD LOAD DEBUG] Loading', initialJson?.objects?.length ?? 0, 'objects into Fabric');
              fabricCanvasRef.current.loadFromJSON(initialJson, () => {
                if (isMounted) {
                  const afterCount = fabricCanvasRef.current?.getCanvas?.()?.getObjects?.()?.length ?? '?';
                  console.log('[BOARD LOAD DEBUG] Canvas object count after load:', afterCount);
                  isInitialLoadingRef.current = false;
                  setSaveStatus('saved');
                }
              });
            } else {
              console.log('[BOARD LOAD DEBUG] Canvas ref not ready — retrying in 50ms');
              setTimeout(applyCanvasData, 50);
            }
          };
          applyCanvasData();
        }
      } catch (err) {
        console.error('[MainCanvasPage] Failed to fetch board:', err);
        const errMsg = typeof err === 'string' ? err : err?.message || 'Could not load board';
        addToast('Board Error', errMsg, 'error', 'error');
        if (isMounted) {
          isInitialLoadingRef.current = false;
          setSaveStatus('error');
        }
      } finally {
        if (isMounted) setLoadingBoard(false);
      }
    };

    fetchBoardData();

    return () => {
      isMounted = false;
    };
  }, [boardId, addToast]);

  useEffect(() => {
    if (!boardId) return;

    const handlePresence = ({ boardId: id, users }) => {
      if (id === boardId && Array.isArray(users)) {
        setActiveUsers(users);
      }
    };

    const handleUserJoined = ({ boardId: id, user }) => {
      if (id === boardId && user) {
        setActiveUsers((prev) => {
          if (prev.some((u) => u.id === user.id)) return prev;
          return [...prev, user];
        });
      }
    };

    const handleUserLeft = ({ boardId: id, userId }) => {
      if (id === boardId && userId) {
        setActiveUsers((prev) => prev.filter((u) => u.id !== userId));
      }
    };

    socketService.on('board:presence', handlePresence);
    socketService.on('board:user:joined', handleUserJoined);
    socketService.on('board:user:left', handleUserLeft);

    socketService.joinBoard(boardId);

    return () => {
      socketService.off('board:presence', handlePresence);
      socketService.off('board:user:joined', handleUserJoined);
      socketService.off('board:user:left', handleUserLeft);
      socketService.leaveBoard(boardId);
      setActiveUsers([]);
    };
  }, [boardId]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (
        !isInitialLoadingRef.current &&
        latestCanvasDataRef.current &&
        boardId
      ) {
        const currentJson = JSON.stringify(latestCanvasDataRef.current);
        if (currentJson !== lastSavedJsonRef.current) {
          apiClient.patch(`/boards/${boardId}`, { canvasData: latestCanvasDataRef.current }).catch((err) => {
            console.error('[MainCanvasPage] Unmount flush failed:', err);
          });
        }
      }
    };
  }, [boardId]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (
        !isInitialLoadingRef.current &&
        latestCanvasDataRef.current &&
        boardId
      ) {
        const currentJson = JSON.stringify(latestCanvasDataRef.current);
        if (currentJson !== lastSavedJsonRef.current) {
          const blob = new Blob([JSON.stringify({ canvasData: latestCanvasDataRef.current })], {
            type: 'application/json'
          });
          navigator.sendBeacon(`/api/v1/boards/${boardId}`, blob);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [boardId]);

  const [penConfig, setPenConfig] = useState({
    color: '#000000',
    width: 4,
    opacity: 1.0,
    brushType: 'standard'
  });

  const [laserConfig, setLaserConfig] = useState({
    color: '#ef4444',
    width: 8,
    duration: 1500,
    glow: 'medium'
  });

  const [activeWheel, setActiveWheel] = useState(null);
  const [wheelAnchorPos, setWheelAnchorPos] = useState({ x: 120, y: 300 });

  const fabricCanvasRef = useRef(null);
  const paletteRef = useRef(null);
  const globalUndoRedoRef = useRef(null);
  const fabRef = useRef(null);
  const aiBtnRef = useRef(null);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        fabricCanvasRef.current?.undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        fabricCanvasRef.current?.redo();
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setActiveTool('eraser');
        setActiveWheel(null);
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
        setActiveTool('laser');
        setActiveWheel(null);
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
        setActiveTool('select');
        setActiveWheel(null);
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
        setActiveTool('pan');
        setActiveWheel(null);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== 'eraser') return;

    const handleGlobalClick = (e) => {
      const target = e.target;
      if (!target) return;

      const isOutsideCanvas = !!target.closest(
        'aside, header, button, #skribe-color-picker-portal, [data-scrollable-popover], .wheel-item-node, .wheel-label-node'
      );

      if (isOutsideCanvas) {
        console.log('[ToolLifecycle] Eraser auto-deactivated due to UI interaction outside canvas');
        eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
        setActiveTool('select');
      }
    };

    window.addEventListener('mousedown', handleGlobalClick, true);
    return () => {
      window.removeEventListener('mousedown', handleGlobalClick, true);
    };
  }, [activeTool]);

  const handleToggleFABWheel = (e) => {
    e.stopPropagation();
    if (activeWheel === 'tools') {
      setActiveWheel(null);
    } else {
      if (fabRef.current) {
        const rect = fabRef.current.getBoundingClientRect();
        setWheelAnchorPos({
          x: rect.left + rect.width / 2,
          y: rect.top - 120
        });
      } else {
        setWheelAnchorPos({
          x: window.innerWidth / 2,
          y: window.innerHeight - 180
        });
      }
      setActiveWheel('tools');
    }
  };

  const handleToggleAIWheel = (e) => {
    e.stopPropagation();
    if (activeWheel === 'ai') {
      setActiveWheel(null);
    } else {
      if (aiBtnRef.current) {
        const rect = aiBtnRef.current.getBoundingClientRect();
        setWheelAnchorPos({ x: rect.right + 120, y: rect.top + rect.height / 2 });
      }
      setActiveWheel('ai');
    }
  };

  const aiWheelItems = useMemo(() => [
    {
      id: 'brainstorm',
      label: 'Brainstorm',
      icon: 'lightbulb',
      action: () => {
        fabricCanvasRef.current?.triggerAIAction('brainstorm');
        addToast('AI Brainstorm', 'Generated sticky note ideas', 'auto_awesome', 'success');
      }
    },
    {
      id: 'architecture',
      label: 'Architecture Assist',
      icon: 'account_tree',
      action: () => {
        fabricCanvasRef.current?.triggerAIAction('architecture');
        addToast('AI Architecture Assist', 'Generated system architecture blocks', 'auto_awesome', 'success');
      }
    },
    {
      id: 'summarize',
      label: 'Summarize Canvas',
      icon: 'description',
      action: () => {
        fabricCanvasRef.current?.triggerAIAction('summarize');
        addToast('AI Summary', 'Summarized whiteboard elements into notes', 'description', 'info');
      }
    },
    {
      id: 'sticky_gen',
      label: 'Generate Sticky Notes',
      icon: 'grid_view',
      action: () => {
        fabricCanvasRef.current?.triggerAIAction('sticky_gen');
        addToast('AI Sticky Generator', 'Created sticky note cluster', 'grid_view', 'success');
      }
    },
    {
      id: 'analyze_diagram',
      label: 'Analyze Diagram',
      icon: 'analytics',
      action: () => {
        fabricCanvasRef.current?.triggerAIAction('analyze_diagram');
        addToast('AI Diagram Insights', 'Analyzed whiteboard structure', 'analytics', 'info');
      }
    }
  ], [addToast]);

  const handleBackToBoards = useCallback(async () => {
    if (
      !isInitialLoadingRef.current &&
      latestCanvasDataRef.current &&
      boardId
    ) {
      const currentJson = JSON.stringify(latestCanvasDataRef.current);
      if (currentJson !== lastSavedJsonRef.current) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        try {
          setSaveStatus('saving');
          await apiClient.patch(`/boards/${boardId}`, { canvasData: latestCanvasDataRef.current });
          lastSavedJsonRef.current = currentJson;
          setSaveStatus('saved');
        } catch (err) {
          console.error('[MainCanvasPage] Flush before navigate failed:', err);
        }
      }
    }
    navigate('/boards');
  }, [boardId, navigate]);

  return (
    <div className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-background">
      <div className="fixed top-20 left-6 z-40 flex items-center gap-2.5 bg-surface/90 backdrop-blur-md rounded-full px-3.5 py-1.5 border border-outline-variant/80 shadow-md pointer-events-auto select-none">
        <button
          onClick={handleBackToBoards}
          className="flex items-center justify-center w-7 h-7 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors cursor-pointer"
          title="Back to All Boards"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>

        <span className="font-headline font-bold text-xs text-on-surface truncate max-w-[150px] sm:max-w-[220px]">
          {boardTitle}
        </span>

        <div className="h-3.5 w-px bg-outline-variant/60 mx-0.5" />

        {saveStatus === 'saving' && (
          <div className="flex items-center gap-1.5 text-primary text-[11px] font-bold font-mono">
            <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <span>Saving...</span>
          </div>
        )}
        {saveStatus === 'saved' && (
          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold font-mono">
            <span className="material-symbols-outlined text-sm font-bold">check_circle</span>
            <span>Saved</span>
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="flex items-center gap-1 text-error text-[11px] font-bold font-mono">
            <span className="material-symbols-outlined text-sm font-bold">error</span>
            <span>Save failed</span>
          </div>
        )}

        {activeUsers.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1 border-l border-outline-variant/60 pl-2">
            <div className="flex items-center -space-x-1.5">
              {activeUsers.slice(0, 4).map((u) => (
                <div
                  key={u.id}
                  className="w-6 h-6 rounded-full bg-primary text-on-primary font-bold text-[10px] flex items-center justify-center ring-2 ring-surface shadow-xs"
                  title={u.name || 'User'}
                >
                  {u.avatar ? (
                    <img src={u.avatar} alt={u.name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    (u.name ? u.name.charAt(0).toUpperCase() : 'U')
                  )}
                </div>
              ))}
            </div>
            {activeUsers.length > 4 && (
              <span className="text-[10px] font-bold text-on-surface-variant">
                +{activeUsers.length - 4}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => setIsShareModalOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 bg-surface-container-high hover:bg-primary-container text-on-surface hover:text-primary rounded-full text-xs font-label font-bold border border-outline-variant transition-colors ml-1 cursor-pointer"
          title="Share Board"
        >
          <span className="material-symbols-outlined text-base">share</span>
          <span className="hidden sm:inline">Share</span>
        </button>
      </div>

      <ShareBoardModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        board={currentBoard || { id: boardId, title: boardTitle }}
        addToast={addToast}
      />

      <ContextMenu
        position={contextMenuPos}
        selectedProps={selectedProps}
        onEditText={() => fabricCanvasRef.current?.editText()}
        onDuplicate={() => fabricCanvasRef.current?.duplicateSelected()}
        onDeleteText={() => fabricCanvasRef.current?.deleteTextOnly()}
        onDeleteShape={() => fabricCanvasRef.current?.deleteShapeOnly()}
        onDeleteEntire={() => fabricCanvasRef.current?.deleteEntire()}
        onBringToFront={() => fabricCanvasRef.current?.bringToFront()}
        onSendToBack={() => fabricCanvasRef.current?.sendToBack()}
        onClose={() => setContextMenuPos(null)}
      />

      <div className="fixed top-20 right-6 z-50 flex flex-col items-end pointer-events-auto">
        {toasts.map((t) => (
          <ToastNotification
            key={t.id}
            id={t.id}
            title={t.title}
            message={t.message}
            icon={t.icon}
            type={t.type}
            onClose={removeToast}
          />
        ))}
      </div>

      <PropertiesSidebar
        activeTool={activeTool}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => fabricCanvasRef.current?.undo()}
        onRedo={() => fabricCanvasRef.current?.redo()}
        selectedProps={selectedProps}
        penConfig={penConfig}
        onPenConfigChange={(cfg) => setPenConfig(cfg)}
        laserConfig={laserConfig}
        onLaserConfigChange={(cfg) => setLaserConfig(cfg)}
        onApplyProperty={(prop, val) => fabricCanvasRef.current?.applyProperty(prop, val)}
        onDuplicate={() => fabricCanvasRef.current?.duplicateSelected()}
        onDelete={() => fabricCanvasRef.current?.deleteSelected()}
        onBringToFront={() => fabricCanvasRef.current?.bringToFront()}
        onSendToBack={() => fabricCanvasRef.current?.sendToBack()}
      />

      <EraserOverlay activeTool={activeTool} />

      <LaserOverlay activeTool={activeTool} laserConfig={laserConfig} />

      <FabricCanvas
        ref={fabricCanvasRef}
        activeTool={activeTool}
        penConfig={penConfig}
        onZoomChange={(newZoom) => setZoom(newZoom)}
        onSelectionChange={(props) => setSelectedProps(props)}
        onToolComplete={() => setActiveTool('select')}
        onContextMenu={(pos) => setContextMenuPos(pos)}
        onHistoryChange={(undoable, redoable) => {
          setCanUndo(undoable);
          setCanRedo(redoable);
        }}
        onCanvasChange={handleCanvasChange}
        className="absolute inset-0 z-0"
      />

      <div
        ref={paletteRef}
        className="fixed top-[72px] left-1/2 -translate-x-1/2 z-40 bg-surface/95 backdrop-blur-md rounded-full px-3.5 py-1.5 border border-outline-variant/80 shadow-md flex items-center gap-1.5 transition-all duration-200 ease-out pointer-events-auto select-none"
      >
        <button
          onClick={() => {
            if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
            setActiveTool('select');
            setActiveWheel(null);
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer relative group ${
            activeTool === 'select'
              ? 'bg-primary text-on-primary shadow-xs scale-105 font-bold'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105'
          }`}
          title="Select Tool (V)"
        >
          <span className="material-symbols-outlined text-[20px]">near_me</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            Select (V)
          </span>
        </button>

        <button
          onClick={() => {
            if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
            setActiveTool('pan');
            setActiveWheel(null);
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer relative group ${
            activeTool === 'pan'
              ? 'bg-primary text-on-primary shadow-xs scale-105 font-bold'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105'
          }`}
          title="Pan Canvas (H)"
        >
          <span className="material-symbols-outlined text-[20px]">pan_tool</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            Pan (H)
          </span>
        </button>

        <button
          onClick={() => {
            if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
            setActiveTool('draw');
            setActiveWheel(null);
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer relative group ${
            activeTool === 'draw'
              ? 'bg-primary text-on-primary shadow-xs scale-105 font-bold'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105'
          }`}
          title="Pen / Draw Tool"
        >
          <span className="material-symbols-outlined text-[20px]">edit</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            Draw
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTool('eraser');
            setActiveWheel(null);
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer relative group ${
            activeTool === 'eraser'
              ? 'bg-primary text-on-primary shadow-xs scale-105 font-bold'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105'
          }`}
          title="Smart Eraser Tool (E)"
        >
          <span className="material-symbols-outlined text-[20px]">auto_fix_high</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            Smart Eraser (E)
          </span>
        </button>

        <button
          onClick={() => {
            if (activeTool === 'eraser') eraserManager.clearHoverPreview(fabricCanvasRef.current?.getCanvas());
            setActiveTool('laser');
            setActiveWheel(null);
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer relative group ${
            activeTool === 'laser'
              ? 'bg-primary text-on-primary shadow-xs scale-105 font-bold'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105'
          }`}
          title="Laser Pointer Tool (L)"
        >
          <span className="material-symbols-outlined text-[20px]">flare</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            Laser Pointer (L)
          </span>
        </button>

        <div className="h-5 w-px bg-outline-variant/60 my-auto" />

        <button
          ref={aiBtnRef}
          onClick={handleToggleAIWheel}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer relative group ${
            activeWheel === 'ai'
              ? 'bg-primary text-on-primary shadow-md scale-105 ring-2 ring-primary ring-offset-1 font-bold'
              : 'bg-surface-container-high text-accent hover:bg-primary hover:text-on-primary hover:scale-105'
          }`}
          title="AI Assistant Wheel"
        >
          <span className="material-symbols-outlined text-[20px]">psychology</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            AI Assistant
          </span>
        </button>

        <button
          onClick={() => {
            addToast('Settings', 'Skribe Preferences & Shortcuts', 'settings', 'info');
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105 transition-all cursor-pointer relative group"
          title="Settings"
        >
          <span className="material-symbols-outlined text-[20px]">settings</span>
          <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-inverse-surface text-inverse-on-surface text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">
            Settings
          </span>
        </button>
      </div>

      <div className="fixed left-1/2 -translate-x-1/2 bottom-20 z-50 pointer-events-auto">
        <button
          ref={fabRef}
          onClick={handleToggleFABWheel}
          className={`w-14 h-14 rounded-full border-2 border-primary sticker-shadow flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-95 group focus:outline-none focus:ring-4 focus:ring-primary/30 ${
            activeWheel === 'tools'
              ? 'bg-primary text-on-primary shadow-2xl scale-115 ring-4 ring-primary/40 rotate-45'
              : 'bg-primary text-on-primary shadow-2xl hover:scale-110'
          }`}
          aria-label="Universal Creation Tool Wheel"
          title="Create Something (Tools Wheel)"
        >
          <span className="material-symbols-outlined text-2xl font-bold transition-transform duration-200">
            add
          </span>
        </button>
      </div>

      <ToolWheel
        isOpen={activeWheel === 'tools'}
        onClose={() => setActiveWheel(null)}
        title="Creation Tools"
        anchorPos={wheelAnchorPos}
        activeToolId={activeTool}
        onSelectTool={(toolId, itemObj) => {
          if (itemObj) {
            if (itemObj.actionType === 'upload') {
              addToast('Upload Image', 'Select an image file from your computer', 'upload_file', 'info');
            } else if (itemObj.toolType === 'draw') {
              setActiveTool('draw');
              addToast('Pen Tool Active', 'Freehand drawing mode', 'edit', 'info');
            } else if (itemObj.toolType) {
              fabricCanvasRef.current?.addShape(itemObj.toolType, itemObj);
              setActiveTool('select');
            }
          } else {
            fabricCanvasRef.current?.addShape(toolId);
            setActiveTool('select');
          }
          setActiveWheel(null);
        }}
      />

      <ToolWheel
        isOpen={activeWheel === 'ai'}
        onClose={() => setActiveWheel(null)}
        title="AI Assistant"
        anchorPos={wheelAnchorPos}
        activeToolId={null}
        onSelectTool={() => setActiveWheel(null)}
      />
    </div>
  );
};

export default MainCanvasPage;
