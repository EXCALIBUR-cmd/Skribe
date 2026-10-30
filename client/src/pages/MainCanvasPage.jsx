import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { flushCanvasBeforeNavigate, openSettingsFromBoard } from '../features/settings/boardSettingsNavigation';
import { usePreferences } from '../context/PreferencesContext';
import { resolveCanvasBackground } from '../features/settings/preferenceOptions';
import BoardPreferencesPanel from '../components/canvas/BoardPreferencesPanel';
import FabricCanvas from '../components/canvas/FabricCanvas';
import PropertiesSidebar from '../components/properties/PropertiesSidebar';
import ContextMenu from '../components/canvas/ContextMenu';
import ToastNotification from '../components/ui/ToastNotification';
import ToolWheel from '../components/ui/ToolWheel';
import EraserOverlay from '../components/ui/EraserOverlay';
import LaserOverlay from '../components/ui/LaserOverlay';
import CollaborativeCursorsOverlay from '../components/ui/CollaborativeCursorsOverlay';
import CollaborativeSelectionsOverlay from '../components/ui/CollaborativeSelectionsOverlay';
import UndoRedoFloating from '../components/ui/UndoRedoFloating';
import apiClient from '../api/apiClient';
import eraserManager from '../utils/EraserManager';
import socketService from '../services/socket';
import { ShareBoardModal } from '../components/ui/ShareBoardModal';
import { useAuth } from '../context/AuthContext';
import { extractWorkspaceModel } from '../features/messCleanup/extractWorkspaceModel.js';
import { analyzeWorkspace } from '../features/messCleanup/analyzeWorkspace.js';
import { createLayoutProposal } from '../features/messCleanup/layoutEngine.js';
import { buildPreviewRenderModel } from '../features/messCleanup/previewModel.js';
import { auditCleanupPipeline, computeGeometryDiagnostics } from '../features/messCleanup/auditCleanupPipeline.js';
import MessCleanupPreviewModal from '../features/messCleanup/MessCleanupPreviewModal.jsx';
import VoiceDictationModal from '../features/voice/VoiceDictationModal.jsx';
import { runVoiceCommand, confirmVoiceCommandProposal, requestVoiceCommandInterpretation, resolveVoiceCommandStyle } from '../features/voice/voiceCommands.js';
import { runBindingDiagnostic } from '../features/messCleanup/bindingDiagnostics.js';
import { createBoardSyncController } from '../features/collab/boardSyncController.js';

const isValidViewport = (viewport) => (
  viewport &&
  typeof viewport.x === 'number' && Number.isFinite(viewport.x) &&
  typeof viewport.y === 'number' && Number.isFinite(viewport.y) &&
  typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom) &&
  viewport.zoom >= 0.2 && viewport.zoom <= 5
);

const PENDING_OPERATION_PREFIX = 'skribe:pending-canvas-ops:';

const createPendingOperationJournal = (boardId) => {
  const prefix = `${PENDING_OPERATION_PREFIX}${boardId}:`;
  try {
    window.localStorage.setItem(`${PENDING_OPERATION_PREFIX}probe`, '1');
    window.localStorage.removeItem(`${PENDING_OPERATION_PREFIX}probe`);
  } catch {
    return null;
  }
  return {
    available: true,
    write: (instanceId, record) => window.localStorage.setItem(`${prefix}${instanceId}`, JSON.stringify(record)),
    remove: (instanceId) => window.localStorage.removeItem(`${prefix}${instanceId}`),
    list: () => {
      const records = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        try {
          records.push({ instanceId: key.slice(prefix.length), record: JSON.parse(window.localStorage.getItem(key)) });
        } catch {
          records.push({ instanceId: key.slice(prefix.length), record: null });
        }
      }
      return records;
    }
  };
};

export const MainCanvasPage = () => {
  const { id: boardId } = useParams();
  const { user } = useAuth();
  const { resolvedTheme, t } = usePreferences();
  const [canvasBackground, setCanvasBackground] = useState('default');
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const navigate = useNavigate();

  const [boardTitle, setBoardTitle] = useState('Untitled Board');
  const [currentBoard, setCurrentBoard] = useState(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const isOwner = useMemo(() => {
    if (!currentBoard || !user) return false;
    const currentUserId = String(user.id || user._id || user.userId || '').trim();
    if (!currentUserId) return false;

    let boardOwnerId = '';
    if (currentBoard.owner) {
      if (typeof currentBoard.owner === 'object') {
        boardOwnerId = String(currentBoard.owner.id || currentBoard.owner._id || currentBoard.owner.userId || '').trim();
      } else {
        boardOwnerId = String(currentBoard.owner).trim();
      }
    } else if (currentBoard.ownerId) {
      boardOwnerId = String(currentBoard.ownerId).trim();
    } else if (currentBoard.user) {
      if (typeof currentBoard.user === 'object') {
        boardOwnerId = String(currentBoard.user.id || currentBoard.user._id || '').trim();
      } else {
        boardOwnerId = String(currentBoard.user).trim();
      }
    } else if (currentBoard.userId) {
      boardOwnerId = String(currentBoard.userId).trim();
    }

    return !!(boardOwnerId && boardOwnerId === currentUserId);
  }, [currentBoard, user]);
  const [activeUsers, setActiveUsers] = useState([]);

  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#000000');
  const [selectedProps, setSelectedProps] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [contextMenuPos, setContextMenuPos] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

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
  const lastCanvasHandleRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const saveSequenceRef = useRef(0);
  const syncControllerRef = useRef(null);
  const handleCanvasChangeRef = useRef(null);
  const viewportSaveTimerRef = useRef(null);
  const latestViewportRef = useRef(null);

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

    const syncController = syncControllerRef.current;
    if (!syncController) return;

    const currentSeq = ++saveSequenceRef.current;
    setSaveStatus('saving');

    console.log('[BOARD SAVE DEBUG] Saving board:', boardId);
    console.log('[BOARD SAVE DEBUG] Payload keys:', Object.keys(canvasDataToSave));
    console.log('[BOARD SAVE DEBUG] Payload object count:', canvasDataToSave?.objects?.length);

    try {
      const res = await syncController.persist(canvasDataToSave);

      console.log('[BOARD SAVE DEBUG] Save response status: 200');
      console.log('[BOARD SAVE DEBUG] Save response:', JSON.stringify(res).slice(0, 300));

      if (currentSeq !== saveSequenceRef.current) {
        console.log('[BOARD SAVE DEBUG] Stale save response — discarding (seq mismatch)');
        return;
      }

      if (res.ok) {
        lastSavedJsonRef.current = jsonString;
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
        console.error('[BOARD SAVE ERROR] Save was not accepted:', res.code);
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

  const saveViewport = useCallback(async (viewport) => {
    if (!boardId || !isValidViewport(viewport)) return;

    try {
      await apiClient.patch(`/boards/${boardId}/viewport`, viewport);
    } catch (err) {
      console.error('[MainCanvasPage] Failed to save viewport:', err);
    }
  }, [boardId]);

  const handleViewportChange = useCallback((viewport) => {
    if (!isValidViewport(viewport)) return;

    latestViewportRef.current = viewport;
    if (viewportSaveTimerRef.current) {
      clearTimeout(viewportSaveTimerRef.current);
    }

    viewportSaveTimerRef.current = setTimeout(() => {
      viewportSaveTimerRef.current = null;
      saveViewport(viewport);
    }, 500);
  }, [saveViewport]);

  const flushViewportSave = useCallback(async () => {
    if (viewportSaveTimerRef.current) {
      clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    await saveViewport(latestViewportRef.current);
  }, [saveViewport]);

  const handleCanvasChange = useCallback(() => {
    if (isInitialLoadingRef.current) {
      console.log('[BOARD SAVE DEBUG] handleCanvasChange fired but isInitialLoading=true — suppressed');
      return;
    }

    const handle = fabricCanvasRef.current;
    const currentCanvasData = handle?.serializeForSync
      ? { version: handle.getCanvas?.()?.version || '6.5.1', objects: handle.serializeForSync() }
      : handle?.toJSON?.();
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

    const syncController = syncControllerRef.current;
    if (syncController?.isEnabled?.()) {
      const ticket = ++saveSequenceRef.current;
      syncController.submitLocalChanges().then((result) => {
        if (syncControllerRef.current !== syncController || ticket !== saveSequenceRef.current) return;
        if (result?.mode === 'operation' || result?.mode === 'noop' || result?.mode === 'save') {
          setSaveStatus('saved');
        } else if (result?.mode === 'legacy') {
          saveBoardData(latestCanvasDataRef.current);
        } else if (result?.mode !== 'disposed') {
          setSaveStatus('error');
        }
      });
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      saveBoardData(latestCanvasDataRef.current);
    }, 400);
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
          setCanvasBackground(res.data.board.canvasBackground || 'default');
          const canvasData = res.data.board.canvasData;
          const userViewportState = res.data.board.viewportStates?.find(
            (s) => String(s.userId) === String(user?._id || user?.id)
          );
          const savedViewport = userViewportState?.viewport || res.data.board.viewportStates?.[0]?.viewport;
          latestViewportRef.current = isValidViewport(savedViewport) ? savedViewport : null;

          console.log('[BOARD LOAD DEBUG] Board ID:', boardId);
          console.log('[BOARD LOAD DEBUG] Received canvas data:', !!canvasData);
          console.log('[BOARD LOAD DEBUG] Serialized object count:', canvasData?.objects?.length ?? 0);

          const initialJson = canvasData || { version: '6.5.1', objects: [] };
          lastSavedJsonRef.current = JSON.stringify(initialJson);
          latestCanvasDataRef.current = initialJson;

          syncControllerRef.current?.dispose();
          syncControllerRef.current = createBoardSyncController({
            boardId,
            journal: createPendingOperationJournal(boardId),
            api: {
              getBoard: async () => {
                const latest = await apiClient.get(`/boards/${boardId}`);
                const latestBoard = latest?.data?.board;
                return latestBoard ? { revision: latestBoard.canvasRevision ?? 0, objects: latestBoard.canvasData?.objects || [] } : null;
              },
              saveOnUnload: (body) => {
                try {
                  const payload = JSON.stringify(body);
                  if (payload.length > 60000) return false;
                  fetch(`${apiClient.defaults.baseURL}/boards/${boardId}`, { method: 'PATCH', keepalive: true, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: payload });
                  return true;
                } catch {
                  return false;
                }
              },
              saveBoard: async (body) => {
                try {
                  const saved = await apiClient.patch(`/boards/${boardId}`, body);
                  return saved?.success ? { ok: true, revision: saved.data?.board?.canvasRevision } : { ok: false, code: 'SAVE_FAILED' };
                } catch (saveErr) {
                  return { ok: false, code: saveErr?.errors?.code || 'NETWORK_ERROR', currentRevision: saveErr?.errors?.currentRevision };
                }
              }
            },
            socket: {
              emitOperation: (payload, timeoutMs) => socketService.emitWithAck('canvas:op', payload, timeoutMs),
              send: (payload) => socketService.emit('canvas:op', payload),
              isConnected: () => Boolean(socketService.getSocket()?.connected),
              rejoin: () => socketService.joinBoard(boardId)
            },
            canvas: {
              serialize: () => fabricCanvasRef.current?.serializeForSync?.() || [],
              serializeIds: (ids) => fabricCanvasRef.current?.serializeForSync?.(ids) || [],
              finalSnapshot: () => {
                const handle = fabricCanvasRef.current || lastCanvasHandleRef.current;
                const liveCanvas = handle?.getCanvas?.();
                if (!liveCanvas || !handle?.serializeForSync) return null;
                return { version: liveCanvas.version || '6.5.1', objects: handle.serializeForSync() };
              },
              snapshot: () => {
                const handle = fabricCanvasRef.current;
                if (!handle?.serializeForSync) return null;
                return { version: handle.getCanvas?.()?.version || '6.5.1', objects: handle.serializeForSync() };
              },
              prepare: async (objects) => (await fabricCanvasRef.current?.prepareSyncObjects?.(objects)) || new Map(),
              applyMerge: (merge) => fabricCanvasRef.current?.applySyncMerge?.(merge),
              isBusy: () => Boolean(fabricCanvasRef.current?.isSyncBusy?.())
            },
            notify: (kind, detail) => {
              if (kind === 'conflict' && detail.ids.length > 0) {
                addToast('Edit conflict', `${detail.ids.length} of your changes overlapped with a collaborator's edits. Your version was kept; press Undo to restore theirs.`, 'sync_problem', 'info');
              } else if (kind === 'conflict' && detail.orderConflict) {
                addToast('Layer order conflict', 'You and a collaborator both changed the layer order. Your order was kept.', 'sync_problem', 'info');
              } else if (kind === 'sync-error') {
                setSaveStatus('error');
              } else if (kind === 'recovered') {
                addToast('Changes recovered', detail.conflicts > 0
                  ? `${detail.recovered} unsaved change${detail.recovered === 1 ? '' : 's'} from your last visit were restored. ${detail.conflicts} could not be restored because a collaborator changed the same object.`
                  : `${detail.recovered} unsaved change${detail.recovered === 1 ? '' : 's'} from your last visit were restored.`, 'restore', 'info');
              } else if (kind === 'synced') {
                setSaveStatus('saved');
              }
            },
            requestSave: () => handleCanvasChangeRef.current?.()
          });
          syncControllerRef.current.load({ revision: res.data.board.canvasRevision ?? 0, objects: initialJson.objects || [], enabled: res.data.collaboration?.operationsEnabled === true });

          const applyCanvasData = () => {
            if (!isMounted) return;
            if (fabricCanvasRef.current && typeof fabricCanvasRef.current.loadFromJSON === 'function') {
              console.log('[BOARD LOAD DEBUG] Loading', initialJson?.objects?.length ?? 0, 'objects into Fabric');
              fabricCanvasRef.current.loadFromJSON(initialJson, () => {
                if (isMounted) {
                  if (isValidViewport(savedViewport)) {
                    fabricCanvasRef.current.setViewport(savedViewport);
                  }
                  if (!fabricCanvasRef.current.hasVisibleObjects?.()) {
                    console.log('[BOARD LOAD DEBUG] Restored viewport has no visible objects. Auto-fitting content...');
                    fabricCanvasRef.current.fitToContent?.();
                  }
                  const afterCount = fabricCanvasRef.current?.getCanvas?.()?.getObjects?.()?.length ?? '?';
                  console.log('[BOARD LOAD DEBUG] Canvas object count after load:', afterCount);
                  syncControllerRef.current?.markLoaded();
                  syncControllerRef.current?.recoverPending().catch((err) => {
                    console.error('[MainCanvasPage] Pending change recovery failed:', err);
                  });
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

  useEffect(() => () => {
    if (viewportSaveTimerRef.current) {
      clearTimeout(viewportSaveTimerRef.current);
      viewportSaveTimerRef.current = null;
    }
    if (latestViewportRef.current) {
      saveViewport(latestViewportRef.current);
    }
  }, [saveViewport]);

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
    if (!boardId) return;

    const acceptRemote = (result, ids) => {
      Promise.resolve(result).then(() => {
        const controller = syncControllerRef.current;
        if (controller?.boardId === boardId) controller.acceptRemoteObjects(ids);
      }).catch(() => {});
    };

    const handleRemoteObjectAdded = ({ boardId: id, objectId, objectData }) => {
      if (id === boardId && fabricCanvasRef.current) {
        acceptRemote(fabricCanvasRef.current.applyRemoteObjectAdded({ objectId, objectData }), [objectId || objectData?.id]);
      }
    };

    const handleRemotePathCreated = ({ boardId: id, objectId, strokeId, objectData }) => {
      if (id === boardId && fabricCanvasRef.current) {
        acceptRemote(fabricCanvasRef.current.applyRemotePathCreated({ objectId, strokeId, objectData }), [objectId || objectData?.id]);
      }
    };

    const handleRemoteObjectModified = ({ boardId: id, objectId, objectData }) => {
      if (id === boardId && fabricCanvasRef.current) {
        acceptRemote(fabricCanvasRef.current.applyRemoteObjectModified({ objectId, objectData }), [objectId || objectData?.id]);
      }
    };

    const handleRemoteBatchModified = ({ boardId: id, transactionId, changes }) => {
      if (id === boardId && fabricCanvasRef.current) {
        acceptRemote(fabricCanvasRef.current.applyRemoteBatchObjectsModified({ transactionId, changes }), (Array.isArray(changes) ? changes : []).map((change) => change?.objectId));
      }
    };

    const handleRemoteObjectTransform = ({ boardId: id, objectId, transform }) => {
      if (id === boardId && fabricCanvasRef.current) {
        fabricCanvasRef.current.applyRemoteObjectTransform({ objectId, transform });
        const controller = syncControllerRef.current;
        if (controller?.boardId === boardId && controller.isEnabled()) {
          controller.notePreview(fabricCanvasRef.current.linkedObjectIds?.(objectId) || [objectId]);
        }
      }
    };

    const handleRemoteDrawStream = (data) => {
      if (data && data.boardId === boardId && fabricCanvasRef.current) {
        fabricCanvasRef.current.applyRemoteDrawStream(data);
      }
    };

    const handleRemoteObjectRemoved = ({ boardId: id, objectId, objectIds }) => {
      if (id === boardId && fabricCanvasRef.current) {
        acceptRemote(fabricCanvasRef.current.applyRemoteObjectRemoved({ objectId, objectIds }), objectIds || [objectId]);
      }
    };


    socketService.on('canvas:object-added', handleRemoteObjectAdded);
    socketService.on('canvas:path-created', handleRemotePathCreated);
    socketService.on('canvas:object-modified', handleRemoteObjectModified);
    socketService.on('canvas:batch-modified', handleRemoteBatchModified);
    socketService.on('canvas:object-transform', handleRemoteObjectTransform);
    socketService.on('canvas:draw-stream', handleRemoteDrawStream);
    socketService.on('canvas:object-removed', handleRemoteObjectRemoved);

    return () => {
      socketService.off('canvas:object-added', handleRemoteObjectAdded);
      socketService.off('canvas:path-created', handleRemotePathCreated);
      socketService.off('canvas:object-modified', handleRemoteObjectModified);
      socketService.off('canvas:batch-modified', handleRemoteBatchModified);
      socketService.off('canvas:object-transform', handleRemoteObjectTransform);
      socketService.off('canvas:draw-stream', handleRemoteDrawStream);
      socketService.off('canvas:object-removed', handleRemoteObjectRemoved);
    };
  }, [boardId]);

  useEffect(() => {
    handleCanvasChangeRef.current = handleCanvasChange;
  }, [handleCanvasChange]);

  useEffect(() => {
    if (!boardId) return;

    let disconnected = false;
    const boardSync = () => (syncControllerRef.current?.boardId === boardId ? syncControllerRef.current : null);
    const handleRemoteOperation = (event) => {
      if (event?.boardId === boardId) boardSync()?.receiveOperation(event);
    };
    const handleRemoteRevision = (event) => {
      if (event?.boardId === boardId) boardSync()?.receiveRevision(event);
    };
    const handleSocketDisconnect = () => {
      disconnected = true;
    };
    const handleSocketReconnect = () => {
      if (!disconnected) return;
      disconnected = false;
      socketService.joinBoard(boardId);
      boardSync()?.reconnect();
    };

    socketService.on('canvas:op-committed', handleRemoteOperation);
    socketService.on('board:revision', handleRemoteRevision);
    socketService.on('disconnect', handleSocketDisconnect);
    socketService.on('connect', handleSocketReconnect);

    return () => {
      socketService.off('canvas:op-committed', handleRemoteOperation);
      socketService.off('board:revision', handleRemoteRevision);
      socketService.off('disconnect', handleSocketDisconnect);
      socketService.off('connect', handleSocketReconnect);
      syncControllerRef.current?.dispose();
    };
  }, [boardId]);

  const handleLocalHistoryOperation = useCallback(({ kind, legacyBroadcast }) => {
    const syncController = syncControllerRef.current?.boardId === boardId ? syncControllerRef.current : null;
    if (!syncController) {
      legacyBroadcast();
      return;
    }
    syncController.submitHistoryOperation({ kind, legacyBroadcast }).catch((err) => {
      console.error('[MainCanvasPage] History sync failed:', err);
    });
  }, [boardId]);

  const handleLocalObjectAdded = useCallback(({ objectId, objectData }) => {
    if (syncControllerRef.current?.isEnabled?.()) return;
    if (boardId && objectId && objectData) {
      socketService.emit('canvas:object-added', { boardId, objectId, objectData });
    }
  }, [boardId]);

  const handleLocalPathCreated = useCallback(({ objectId, strokeId, objectData }) => {
    if (syncControllerRef.current?.isEnabled?.()) return;
    if (boardId && objectId && objectData) {
      socketService.emit('canvas:path-created', { boardId, objectId, strokeId, objectData });
    }
  }, [boardId]);

  const handleLocalObjectModified = useCallback(({ objectId, objectData }) => {
    if (syncControllerRef.current?.isEnabled?.()) return;
    if (boardId && objectId && objectData) {
      socketService.emit('canvas:object-modified', { boardId, objectId, objectData });
    }
  }, [boardId]);

  const handleLocalObjectTransform = useCallback(({ objectId, transform }) => {
    if (boardId && objectId && transform) {
      socketService.emit('canvas:object-transform', { boardId, objectId, transform });
    }
  }, [boardId]);

  const handleLocalDrawStream = useCallback((data) => {
    if (boardId && data) {
      socketService.emit('canvas:draw-stream', { boardId, ...data });
    }
  }, [boardId]);

  const handleLocalObjectRemoved = useCallback(({ objectId, objectIds }) => {
    if (syncControllerRef.current?.isEnabled?.()) return;
    if (boardId && (objectId || objectIds)) {
      socketService.emit('canvas:object-removed', { boardId, objectId, objectIds });
    }
  }, [boardId]);

  useLayoutEffect(() => {
    if (fabricCanvasRef.current) lastCanvasHandleRef.current = fabricCanvasRef.current;
  });

  useLayoutEffect(() => () => {
    const controller = syncControllerRef.current;
    if (controller?.boardId !== boardId || !controller.isEnabled()) return;
    controller.persist(null, { final: true }).then((result) => {
      if (result && !result.ok && !result.skipped) console.error('[MainCanvasPage] Leave flush was not saved:', result.code);
    }).catch((err) => {
      console.error('[MainCanvasPage] Leave flush failed:', err);
    });
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
          syncControllerRef.current?.persist(latestCanvasDataRef.current, { final: true }).then((result) => {
            if (result && !result.ok && !result.skipped) console.error('[MainCanvasPage] Unmount flush was not saved:', result.code);
          }).catch((err) => {
            console.error('[MainCanvasPage] Unmount flush failed:', err);
          });
        }
      }
    };
  }, [boardId]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (boardId && isValidViewport(latestViewportRef.current)) {
        const viewportBlob = new Blob([JSON.stringify(latestViewportRef.current)], {
          type: 'application/json'
        });
        navigator.sendBeacon(`/api/v1/boards/${boardId}/viewport`, viewportBlob);
      }
      const controller = syncControllerRef.current;
      if (controller?.boardId === boardId && controller.isEnabled()) {
        controller.flushOnUnload();
        if (!controller.canRecover() && controller.hasUnsavedWork()) {
          event.preventDefault();
          event.returnValue = '';
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
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [toolbarTooltip, setToolbarTooltip] = useState(null);
  const [messCleanupPreview, setMessCleanupPreview] = useState({
    isOpen: false,
    workspaceModel: null,
    organizationPlan: null,
    layoutProposal: null,
    loading: false,
    isApplying: false,
    error: ''
  });
  const [wheelAnchorPos, setWheelAnchorPos] = useState({ x: 120, y: 300 });
  const [isVoiceDictationOpen, setIsVoiceDictationOpen] = useState(false);

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
      } else if (
        ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.key === '1')) ||
        (e.shiftKey && e.key === '1')
      ) {
        e.preventDefault();
        fabricCanvasRef.current?.fitToContent?.();
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

  const skribeFeatureItems = [
    {
      id: 'mess-cleanup',
      label: 'Mess Cleanup',
      icon: 'auto_awesome',
      tooltip: 'Clean up rough drawings and messy geometry'
    },
    {
      id: 'voice-dictation',
      label: 'Voice Dictation',
      icon: 'mic',
      tooltip: 'Dictate notes or create text, sticky notes and shapes with voice commands'
    }
  ];

  const handleInsertDictatedText = useCallback((text) => {
    const result = fabricCanvasRef.current?.insertDictatedText(text);
    if (result?.success) {
      addToast('Text Inserted', 'Dictated text added to canvas', 'check_circle', 'success');
    }
    return result;
  }, [addToast]);

  const executeVoiceCommandOnCanvas = useCallback((command) => {
    const canvasApi = fabricCanvasRef.current;
    if (!canvasApi || typeof canvasApi.executeVoiceCommand !== 'function') {
      return { success: false, reason: 'Canvas is not ready' };
    }
    const style = resolveVoiceCommandStyle(command, { activeColor });
    const result = canvasApi.executeVoiceCommand(command, style);
    return style.textAdjusted && result?.success ? { ...result, textAdjusted: true } : result;
  }, [activeColor]);

  const reportVoiceCommandResult = useCallback((result) => {
    if (result?.status === 'executed') {
      addToast('Voice Command', result.summary, 'check_circle', 'success');
    }
    return result;
  }, [addToast]);

  const handleVoiceCommand = useCallback(async (transcript, { signal } = {}) => {
    const result = await runVoiceCommand(transcript, {
      interpret: (instruction, options) => requestVoiceCommandInterpretation(instruction, { signal: options?.signal }),
      execute: executeVoiceCommandOnCanvas,
      signal
    });
    return reportVoiceCommandResult(result);
  }, [executeVoiceCommandOnCanvas, reportVoiceCommandResult]);

  const handleConfirmVoiceCommand = useCallback(async (proposal) => {
    const result = await confirmVoiceCommandProposal(proposal, executeVoiceCommandOnCanvas);
    return reportVoiceCommandResult(result);
  }, [executeVoiceCommandOnCanvas, reportVoiceCommandResult]);

  const handleSkribeFeatureClick = async (feature) => {
    if (feature.id === 'voice-dictation') {
      setIsVoiceDictationOpen(true);
      return;
    }
    if (feature.id !== 'mess-cleanup') return;
    if (messCleanupPreview.loading) return;

    setMessCleanupPreview({
      isOpen: true,
      workspaceModel: null,
      organizationPlan: null,
      layoutProposal: null,
      loading: true,
      isApplying: false,
      error: ''
    });

    try {
      const canvas = fabricCanvasRef.current?.getCanvas();
      const workspaceModel = extractWorkspaceModel(canvas);

      if (!workspaceModel?.board?.objects || workspaceModel.board.objects.length === 0) {
        setMessCleanupPreview({
          isOpen: true,
          workspaceModel: null,
          organizationPlan: null,
          layoutProposal: null,
          loading: false,
          isApplying: false,
          error: 'Your canvas is currently empty. Draw shapes, add sticky notes, or write text on the canvas before running Mess Cleanup.'
        });
        return;
      }

      let screenshot = null;
      if (canvas && typeof canvas.toDataURL === 'function') {
        const width = canvas.width || 800;
        const height = canvas.height || 600;
        const multiplier = Math.min(1, Math.max(0.2, 800 / Math.max(width, height, 1)));
        screenshot = canvas.toDataURL({
          format: 'jpeg',
          quality: 0.7,
          multiplier
        });
      }

      const activeObjects = canvas?.getActiveObjects?.() || [];
      const selectedObjectIds = activeObjects.map(o => o.id || o.skribeId).filter(Boolean);
      const scopeType = selectedObjectIds.length > 0 ? 'SELECTION' : 'BOARD';
      const cleanupContext = { scopeType, selectedObjectIds };

      const organizationPlan = await analyzeWorkspace(workspaceModel, screenshot, { cleanupContext });
      const layoutProposal = createLayoutProposal(organizationPlan, workspaceModel);
      runBindingDiagnostic(workspaceModel, organizationPlan, null);

      const previewRenderModel = buildPreviewRenderModel(workspaceModel, layoutProposal);
      const cleanupPlan = layoutProposal?.metadata?.cleanupPlan || null;
      const audit = auditCleanupPipeline(workspaceModel, cleanupPlan, layoutProposal, previewRenderModel);
      console.log('=== [MESS CLEANUP FULL PRODUCTION AUDIT] ===', audit);
      const cleanupResult = layoutProposal?.metadata?.cleanupResult || null;
      const geometryDiagnostics = computeGeometryDiagnostics(workspaceModel, layoutProposal, cleanupResult);
      console.log('[MessCleanup Diagnostics Publish]', geometryDiagnostics);
      window.__messCleanupDiagnostics = geometryDiagnostics;
      console.log('[MessCleanup Diagnostics Window]', window.__messCleanupDiagnostics);
      console.log('[MessCleanup Diagnostics Stringified]', JSON.stringify(window.__messCleanupDiagnostics));
      if (geometryDiagnostics) {
        console.log('=== [MESS CLEANUP GEOMETRY DIAGNOSTICS] ===', geometryDiagnostics);
      }
      window.__messCleanupAudit = { workspaceModel, organizationPlan, layoutProposal, previewRenderModel, audit, geometryDiagnostics };

      setMessCleanupPreview({
        isOpen: true,
        workspaceModel,
        organizationPlan,
        layoutProposal,
        loading: false,
        isApplying: false,
        error: ''
      });
    } catch (error) {
      console.error('[MessCleanup] Preview preparation failed:', error);
      const errorMessage = error?.message || "Couldn't prepare the cleanup preview. Your board hasn't been changed.";
      setMessCleanupPreview({
        isOpen: true,
        workspaceModel: null,
        organizationPlan: null,
        layoutProposal: null,
        loading: false,
        isApplying: false,
        error: errorMessage
      });
    }
  };

  const handleCancelMessCleanupPreview = () => {
    setMessCleanupPreview({
      isOpen: false,
      workspaceModel: null,
      organizationPlan: null,
      layoutProposal: null,
      loading: false,
      isApplying: false,
      error: ''
    });
  };

  const handleApplyMessCleanup = () => {
    const { layoutProposal, workspaceModel, isApplying } = messCleanupPreview;
    if (isApplying || !layoutProposal || !workspaceModel) return;

    setMessCleanupPreview((prev) => ({ ...prev, isApplying: true, error: '' }));

    try {
      const result = fabricCanvasRef.current?.applyMessCleanup(layoutProposal, workspaceModel);

      if (result?.success) {
        handleCanvasChange();

        setMessCleanupPreview({
          isOpen: false,
          workspaceModel: null,
          organizationPlan: null,
          layoutProposal: null,
          loading: false,
          isApplying: false,
          error: ''
        });

        addToast('Mess Cleanup Applied', `Organized ${result.appliedCount || 0} objects`, 'auto_awesome', 'success');
      } else {
        const failureReason = result?.reason || result?.error || 'Failed to apply Mess Cleanup proposal';
        setMessCleanupPreview((prev) => ({
          ...prev,
          isApplying: false,
          error: failureReason
        }));
        addToast('Cleanup Failed', failureReason, 'error_outline', 'error');
      }
    } catch (error) {
      console.error('[MessCleanup] Apply exception:', error);
      const failureReason = error?.message || 'Unexpected exception during cleanup apply';
      setMessCleanupPreview((prev) => ({
        ...prev,
        isApplying: false,
        error: failureReason
      }));
      addToast('Cleanup Exception', failureReason, 'error_outline', 'error');
    }
  };

  const showToolbarTooltip = (button) => {
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const label = button.dataset.toolbarTooltip;
    if (!label) return;

    const tooltipWidth = 240;
    const left = Math.min(
      Math.max(12, rect.left + (rect.width / 2) - (tooltipWidth / 2)),
      window.innerWidth - tooltipWidth - 12
    );

    setToolbarTooltip({
      label,
      detail: button.dataset.toolbarTooltipDetail || '',
      left,
      top: rect.bottom + 8
    });
  };

  const handleBackToBoards = useCallback(async () => {
    await flushViewportSave();
    await syncControllerRef.current?.drain?.();
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
          const flushed = await syncControllerRef.current?.persist(latestCanvasDataRef.current, { final: true });
          if (flushed?.ok) {
            lastSavedJsonRef.current = currentJson;
            setSaveStatus('saved');
          } else {
            setSaveStatus('error');
          }
        } catch (err) {
          console.error('[MainCanvasPage] Flush before navigate failed:', err);
        }
      }
    }
    navigate('/boards');
  }, [boardId, flushViewportSave, navigate]);

  const isOpeningSettingsRef = useRef(false);
  const handleOpenSettings = useCallback(async () => {
    if (isOpeningSettingsRef.current) return;
    isOpeningSettingsRef.current = true;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const currentJson = latestCanvasDataRef.current ? JSON.stringify(latestCanvasDataRef.current) : null;
    setSaveStatus('saving');
    await openSettingsFromBoard({
      flush: async () => {
        const result = await flushCanvasBeforeNavigate({
          controller: boardId ? syncControllerRef.current : null,
          canvasData: latestCanvasDataRef.current,
          hasUnsavedLegacyChanges: !isInitialLoadingRef.current && currentJson !== null && currentJson !== lastSavedJsonRef.current,
          flushViewport: flushViewportSave
        });
        if (result.saved) lastSavedJsonRef.current = currentJson;
        if (result.ok) setSaveStatus('saved');
        return result;
      },
      navigate,
      from: `/board/${boardId}`,
      onFailure: (result) => {
        setSaveStatus('error');
        addToast(
          'Changes not saved',
          result?.code === 'NO_SYNC_CONTROLLER'
            ? 'This canvas is not saved to a board, so Settings cannot open without losing it.'
            : 'Your latest changes could not be saved, so you are still on this board. Open Settings again to retry.',
          'error',
          'error'
        );
      }
    });
    isOpeningSettingsRef.current = false;
  }, [addToast, boardId, flushViewportSave, navigate]);

  const closePreferences = useCallback(() => setIsPreferencesOpen(false), []);

  const handleCanvasBackgroundChange = useCallback(async (key) => {
    const previous = canvasBackground;
    if (!boardId || key === previous) return;
    setCanvasBackground(key);
    try {
      const res = await apiClient.patch(`/boards/${boardId}`, { canvasBackground: key });
      if (!res?.success) throw new Error('Background was not saved');
    } catch {
      setCanvasBackground((current) => (current === key ? previous : current));
      addToast(t('preferences.backgroundFailedTitle'), t('preferences.backgroundFailed'), 'error', 'error');
    }
  }, [addToast, boardId, canvasBackground, t]);

  useEffect(() => {
    if (!boardId) return undefined;
    const handleBoardPreferences = (payload) => {
      if (payload?.boardId === boardId && typeof payload.canvasBackground === 'string') setCanvasBackground(payload.canvasBackground);
    };
    socketService.on('board:preferences', handleBoardPreferences);
    return () => socketService.off('board:preferences', handleBoardPreferences);
  }, [boardId]);

  return (
    <div className="relative w-full h-[calc(100vh-64px)] overflow-hidden bg-background">
      <MessCleanupPreviewModal
        isOpen={messCleanupPreview.isOpen}
        workspaceModel={messCleanupPreview.workspaceModel}
        layoutProposal={messCleanupPreview.layoutProposal}
        organizationPlan={messCleanupPreview.organizationPlan}
        loading={messCleanupPreview.loading}
        isApplying={messCleanupPreview.isApplying}
        error={messCleanupPreview.error}
        onApply={handleApplyMessCleanup}
        onCancel={handleCancelMessCleanupPreview}
      />

      <VoiceDictationModal
        isOpen={isVoiceDictationOpen}
        onClose={() => setIsVoiceDictationOpen(false)}
        onInsert={handleInsertDictatedText}
        onCommand={handleVoiceCommand}
        onConfirmCommand={handleConfirmVoiceCommand}
      />

      <div
        className="fixed top-20 right-6 md:right-8 z-40 transition-all duration-220 ease-out flex items-center gap-2.5 bg-surface/90 backdrop-blur-md rounded-full px-3.5 py-1.5 border border-outline-variant/80 shadow-md pointer-events-auto select-none overflow-hidden"
      >
        <button
          onClick={handleBackToBoards}
          className="flex items-center justify-center w-7 h-7 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors cursor-pointer shrink-0"
          title="Back to All Boards"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>

        <span className="font-headline font-bold text-xs text-on-surface truncate max-w-[90px] xs:max-w-[130px] sm:max-w-[180px] md:max-w-[240px]">
          {boardTitle}
        </span>

        <div className="h-3.5 w-px bg-outline-variant/60 mx-0.5 shrink-0" />

        {saveStatus === 'saving' && (
          <div className="flex items-center gap-1.5 text-primary text-[11px] font-bold font-mono shrink-0">
            <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <span>Saving...</span>
          </div>
        )}
        {saveStatus === 'saved' && (
          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold font-mono shrink-0">
            <span className="material-symbols-outlined text-sm font-bold">check_circle</span>
            <span>Saved</span>
          </div>
        )}
        {saveStatus === 'error' && (
          <div className="flex items-center gap-1 text-error text-[11px] font-bold font-mono shrink-0">
            <span className="material-symbols-outlined text-sm font-bold">error</span>
            <span>Save failed</span>
          </div>
        )}

        {activeUsers.length > 0 && (
          <div className="flex items-center gap-1.5 ml-1 border-l border-outline-variant/60 pl-2 shrink-0">
            <div className="flex items-center -space-x-1.5">
              {activeUsers.slice(0, 3).map((u) => (
                <div
                  key={u.id}
                  className="w-6 h-6 rounded-full bg-primary text-on-primary font-bold text-[10px] flex items-center justify-center ring-2 ring-surface shadow-xs"
                  title={u.name || 'User'}
                >
                  {u.avatar ? (
                    <img
                      src={u.avatar}
                      alt={u.name}
                      className="w-full h-full rounded-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    (u.name ? u.name.charAt(0).toUpperCase() : 'U')
                  )}
                </div>
              ))}
            </div>
            {activeUsers.length > 3 && (
              <span className="text-[10px] font-bold text-on-surface-variant">
                +{activeUsers.length - 3}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => setIsShareModalOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 bg-surface-container-high hover:bg-primary-container text-on-surface hover:text-primary rounded-full text-xs font-label font-bold border border-outline-variant transition-colors ml-1 cursor-pointer shrink-0"
          title="Share Board"
        >
          <span className="material-symbols-outlined text-base">share</span>
          <span className="hidden sm:inline">Share</span>
        </button>
      </div>

      <BoardPreferencesPanel
        open={isPreferencesOpen}
        onClose={closePreferences}
        canvasBackground={canvasBackground}
        onCanvasBackgroundChange={handleCanvasBackgroundChange}
        onOpenSettings={handleOpenSettings}
      />

      <ShareBoardModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        board={currentBoard || { id: boardId, title: boardTitle }}
        isOwner={isOwner}
        loadingBoard={loadingBoard}
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
        onSidebarExpandChange={(expanded) => setIsSidebarExpanded(expanded)}
      />

      <EraserOverlay activeTool={activeTool} />

      <LaserOverlay
        activeTool={activeTool}
        laserConfig={laserConfig}
        boardId={boardId}
        fabricCanvasRef={fabricCanvasRef}
      />

      <CollaborativeCursorsOverlay
        boardId={boardId}
        fabricCanvasRef={fabricCanvasRef}
      />

      <CollaborativeSelectionsOverlay
        boardId={boardId}
        fabricCanvasRef={fabricCanvasRef}
        selectedProps={selectedProps}
      />

      <FabricCanvas
        ref={fabricCanvasRef}
        activeTool={activeTool}
        penConfig={penConfig}
        onZoomChange={(newZoom) => setZoom(newZoom)}
        onViewportChange={handleViewportChange}
        onSelectionChange={(props) => setSelectedProps(props)}
        onToolComplete={() => setActiveTool('select')}
        onContextMenu={(pos) => setContextMenuPos(pos)}
        onHistoryChange={(undoable, redoable) => {
          setCanUndo(undoable);
          setCanRedo(redoable);
        }}
        onCanvasChange={handleCanvasChange}
        onLocalObjectAdded={handleLocalObjectAdded}
        onLocalPathCreated={handleLocalPathCreated}
        onLocalObjectModified={handleLocalObjectModified}
        onLocalObjectTransform={handleLocalObjectTransform}
        onLocalDrawStream={handleLocalDrawStream}
        onLocalObjectRemoved={handleLocalObjectRemoved}
        onLocalHistoryOperation={handleLocalHistoryOperation}
        canvasBackground={resolveCanvasBackground(canvasBackground, resolvedTheme)}
        className="absolute inset-0 z-0"
      />

      <div
        ref={paletteRef}
        onWheel={(e) => e.stopPropagation()}
        onMouseOver={(e) => {
          const button = e.target.closest('button[data-toolbar-tooltip]');
          if (button && paletteRef.current?.contains(button)) showToolbarTooltip(button);
        }}
        onMouseLeave={() => setToolbarTooltip(null)}
        onScroll={() => setToolbarTooltip(null)}
        className={`fixed top-[136px] xl:top-20 -translate-x-1/2 z-40 bg-surface/95 backdrop-blur-md border border-outline-variant/80 shadow-md transition-all duration-220 ease-out pointer-events-auto select-none ${
          isToolbarCollapsed
            ? 'rounded-full p-1'
            : 'rounded-full px-2.5 sm:px-3.5 py-1.5 flex items-center gap-1 sm:gap-1.5 max-w-[calc(100vw-90px)] overflow-x-auto overflow-y-hidden custom-scrollbar'
        } left-1/2`}
      >
        {isToolbarCollapsed ? (
          <button
            onClick={() => setIsToolbarCollapsed(false)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all cursor-pointer"
            data-toolbar-tooltip="Expand toolbar"
            aria-label="Expand toolbar"
            title="Expand toolbar"
          >
            <span className="material-symbols-outlined text-xl">chevron_right</span>
          </button>
        ) : (
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-max">
            <div className="px-1 text-[8px] font-black uppercase tracking-wider text-on-surface-variant/70" aria-hidden="true">
              Core
            </div>

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
          data-toolbar-tooltip="Select (V)"
          title="Select Tool (V)"
        >
          <span className="material-symbols-outlined text-[20px]">near_me</span>
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
          data-toolbar-tooltip="Pan (H)"
          title="Pan Canvas (H)"
        >
          <span className="material-symbols-outlined text-[20px]">pan_tool</span>
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
          data-toolbar-tooltip="Draw"
          title="Pen / Draw Tool"
        >
          <span className="material-symbols-outlined text-[20px]">edit</span>
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
          data-toolbar-tooltip="Smart Eraser (E)"
          title="Smart Eraser Tool (E)"
        >
          <span className="material-symbols-outlined text-[20px]">auto_fix_high</span>
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
          data-toolbar-tooltip="Laser Pointer (L)"
          title="Laser Pointer Tool (L)"
        >
          <span className="material-symbols-outlined text-[20px]">flare</span>
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
          data-toolbar-tooltip="AI Assistant"
          title="AI Assistant Wheel"
        >
          <span className="material-symbols-outlined text-[20px]">psychology</span>
        </button>

        <button
          onClick={() => setIsPreferencesOpen((open) => !open)}
          aria-expanded={isPreferencesOpen}
          aria-haspopup="dialog"
          data-preferences-toggle
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-primary hover:scale-105 transition-all cursor-pointer relative group"
          data-toolbar-tooltip={t('toolbar.preferences')}
          title={t('toolbar.preferences')}
          aria-label={t('toolbar.preferences')}
        >
          <span className="material-symbols-outlined text-[20px]">settings</span>
        </button>

        <div className="h-5 w-px bg-outline-variant/70 my-auto" aria-hidden="true" />
        <div className="px-1 text-[8px] font-black uppercase tracking-wider text-primary/80" aria-hidden="true">
          Skribe
        </div>

        {skribeFeatureItems.map((feature) => {
          const isLoading = feature.id === 'mess-cleanup' && messCleanupPreview.loading;
          return (
            <button
              key={feature.id}
              onClick={() => handleSkribeFeatureClick(feature)}
              disabled={isLoading}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-all relative group ${
                isLoading
                  ? 'opacity-50 cursor-not-allowed text-primary/50 bg-primary/5'
                  : 'text-primary bg-primary/10 hover:bg-primary hover:text-on-primary hover:scale-105 cursor-pointer'
              }`}
              data-toolbar-tooltip={isLoading ? 'Analyzing...' : feature.label}
              data-toolbar-tooltip-detail={isLoading ? 'Workspace analysis in progress' : feature.tooltip}
              title={isLoading ? 'Analyzing workspace...' : feature.tooltip}
              aria-label={feature.label}
              aria-disabled={isLoading}
            >
              <span className={`material-symbols-outlined text-[20px] ${isLoading ? 'animate-spin' : ''}`}>
                {isLoading ? 'progress_activity' : feature.icon}
              </span>
            </button>
          );
        })}

            <button
              onClick={() => setIsToolbarCollapsed(true)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-all cursor-pointer"
              data-toolbar-tooltip="Collapse toolbar"
              aria-label="Collapse toolbar"
              title="Collapse toolbar"
            >
              <span className="material-symbols-outlined text-xl">chevron_left</span>
            </button>
          </div>
        )}
      </div>

      {toolbarTooltip && ReactDOM.createPortal(
        <div
          className="fixed z-9999 pointer-events-none w-60 rounded-lg bg-inverse-surface px-3 py-2 text-inverse-on-surface shadow-xl"
          style={{ left: `${toolbarTooltip.left}px`, top: `${toolbarTooltip.top}px` }}
        >
          <div className="text-xs font-bold whitespace-nowrap">{toolbarTooltip.label}</div>
          {toolbarTooltip.detail && (
            <div className="mt-0.5 text-[11px] leading-tight text-inverse-on-surface/80">{toolbarTooltip.detail}</div>
          )}
        </div>,
        document.body
      )}

      <div
        className={`fixed -translate-x-1/2 bottom-[88px] md:bottom-20 z-50 transition-all duration-220 ease-out pointer-events-auto ${
          isSidebarExpanded
            ? 'left-[calc(50vw+160px)]'
            : 'left-1/2'
        }`}
      >
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

      <UndoRedoFloating
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => fabricCanvasRef.current?.undo()}
        onRedo={() => fabricCanvasRef.current?.redo()}
        isSidebarExpanded={isSidebarExpanded}
      />

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
