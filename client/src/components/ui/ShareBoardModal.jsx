import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../../api/apiClient';
import { useAuth } from '../../context/AuthContext';

export const ShareBoardModal = ({ isOpen, onClose, board: initialBoard, isOwner: propIsOwner, addToast }) => {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchedBoard, setFetchedBoard] = useState(null);

  const board = useMemo(() => {
    if (initialBoard && (initialBoard.owner || initialBoard.ownerId)) {
      return initialBoard;
    }
    return fetchedBoard || initialBoard;
  }, [initialBoard, fetchedBoard]);

  const isOwner = useMemo(() => {
    if (propIsOwner === true) return true;
    if (!board || !user) return false;

    const currentUserId = String(user.id || user._id || user.userId || '').trim();
    if (!currentUserId) return false;

    let boardOwnerId = '';
    if (board.owner) {
      if (typeof board.owner === 'object') {
        boardOwnerId = String(board.owner.id || board.owner._id || board.owner.userId || '').trim();
      } else {
        boardOwnerId = String(board.owner).trim();
      }
    } else if (board.ownerId) {
      boardOwnerId = String(board.ownerId).trim();
    } else if (board.user) {
      if (typeof board.user === 'object') {
        boardOwnerId = String(board.user.id || board.user._id || '').trim();
      } else {
        boardOwnerId = String(board.user).trim();
      }
    } else if (board.userId) {
      boardOwnerId = String(board.userId).trim();
    }

    if (boardOwnerId && boardOwnerId === currentUserId) {
      return true;
    }

    return false;
  }, [board, user, propIsOwner]);

  const fetchBoardDetails = useCallback(async (boardId) => {
    if (!boardId) return;
    try {
      const res = await apiClient.get(`/boards/${boardId}`);
      if (res.success && res.data?.board) {
        setFetchedBoard(res.data.board);
      }
    } catch (err) {
      console.error('[ShareBoardModal] Failed to fetch board details:', err);
    }
  }, []);

  const fetchCollaborators = useCallback(async () => {
    if (!board?.id) return;
    try {
      setLoading(true);
      setError('');
      const res = await apiClient.get(`/boards/${board.id}/collaborators`);
      if (res.success && Array.isArray(res.data?.collaborators)) {
        setCollaborators(res.data.collaborators);
      }
    } catch (err) {
      console.error('[ShareBoardModal] Failed to fetch collaborators:', err);
      setError(err.message || 'Failed to load collaborators');
    } finally {
      setLoading(false);
    }
  }, [board?.id]);

  useEffect(() => {
    if (isOpen && initialBoard?.id) {
      setEmail('');
      setError('');
      setFetchedBoard(null);

      if (!initialBoard.owner && !initialBoard.ownerId) {
        fetchBoardDetails(initialBoard.id);
      }

      fetchCollaborators();
    }
  }, [isOpen, initialBoard?.id, initialBoard?.owner, initialBoard?.ownerId, fetchBoardDetails, fetchCollaborators]);

  if (!isOpen || !board) return null;

  const handleAddCollaborator = async (e) => {
    e.preventDefault();
    if (!email || !email.trim() || actionLoading) return;

    try {
      setActionLoading(true);
      setError('');
      const res = await apiClient.post(`/boards/${board.id}/collaborators`, { email: email.trim() });

      if (res.success && res.data?.collaborator) {
        setCollaborators((prev) => {
          if (prev.some((c) => c.id === res.data.collaborator.id)) return prev;
          return [...prev, res.data.collaborator];
        });
        setEmail('');
        if (addToast) {
          addToast('Collaborator Added', `${res.data.collaborator.name || email} can now access this board`, 'person_add', 'success');
        }
      }
    } catch (err) {
      console.error('[ShareBoardModal] Add collaborator error:', err);
      const errMsg = err.message || 'Failed to add collaborator';
      setError(errMsg);
      if (addToast) {
        addToast('Error', errMsg, 'error', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveCollaborator = async (collaboratorId, collaboratorName) => {
    if (actionLoading) return;
    try {
      setActionLoading(true);
      setError('');
      const res = await apiClient.delete(`/boards/${board.id}/collaborators/${collaboratorId}`);

      if (res.success) {
        setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
        if (addToast) {
          addToast('Collaborator Removed', `Removed ${collaboratorName || 'user'} from this board`, 'person_remove', 'info');
        }
      }
    } catch (err) {
      console.error('[ShareBoardModal] Remove collaborator error:', err);
      const errMsg = err.message || 'Failed to remove collaborator';
      setError(errMsg);
      if (addToast) {
        addToast('Error', errMsg, 'error', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-xs" onClick={onClose}>
      <div
        className="w-full max-w-md bg-surface-container-lowest border-2 border-outline rounded-3xl shadow-2xl overflow-hidden font-body relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-surface-variant flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container border-2 border-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-primary">group_add</span>
            </div>
            <div>
              <h2 className="font-headline font-bold text-lg text-on-surface line-clamp-1">
                Share "{board.title || 'Board'}"
              </h2>
              <p className="font-body text-xs text-on-surface-variant">
                Manage board collaborators
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-high cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          {isOwner ? (
            <form onSubmit={handleAddCollaborator} className="space-y-2">
              <label className="block text-xs font-label font-bold text-on-surface uppercase tracking-wider">
                Add Collaborator
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="Enter collaborator email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={actionLoading}
                  className="flex-1 bg-surface-container-low border-2 border-outline-variant rounded-xl px-3.5 py-2 text-xs text-on-surface font-body outline-none focus:border-primary transition-colors disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={actionLoading || !email.trim()}
                  className="bg-primary text-on-primary font-label text-xs font-bold px-4 py-2 rounded-xl border-2 border-on-primary-fixed hover:scale-102 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? (
                    <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">person_add</span>
                      <span>Add collaborator</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3 bg-secondary-container/40 text-on-secondary-container rounded-xl text-xs font-bold flex items-center gap-2 border border-secondary/20">
              <span className="material-symbols-outlined text-base">info</span>
              <span>Only the board owner can add or remove collaborators.</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-error-container text-on-error-container rounded-xl text-xs font-bold border border-error/20 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              <span>{error}</span>
            </div>
          )}

          <div>
            <h3 className="text-xs font-label font-bold text-on-surface mb-3 uppercase tracking-wider">
              Collaborators ({collaborators.length})
            </h3>

            {loading ? (
              <div className="py-6 text-center text-xs font-bold text-on-surface-variant flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Loading collaborators...</span>
              </div>
            ) : collaborators.length === 0 ? (
              <div className="py-6 text-center text-xs text-on-surface-variant bg-surface-container-low/50 rounded-2xl border border-dashed border-outline-variant/60 font-semibold">
                No collaborators added yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {collaborators.map((member) => (
                  <div
                    key={member.id}
                    className="p-3 bg-surface-container-low rounded-2xl border border-outline-variant/60 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 rounded-full bg-primary text-on-primary font-bold text-xs flex items-center justify-center shrink-0">
                        {member.avatar ? (
                          <img src={member.avatar} alt={member.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          (member.name ? member.name.charAt(0).toUpperCase() : 'U')
                        )}
                      </div>
                      <div className="overflow-hidden">
                        <p className="font-headline font-bold text-xs text-on-surface truncate">
                          {member.name}
                        </p>
                        <p className="font-body text-[11px] text-on-surface-variant truncate">
                          {member.email}
                        </p>
                      </div>
                    </div>

                    {isOwner && (
                      <button
                        onClick={() => handleRemoveCollaborator(member.id, member.name)}
                        disabled={actionLoading}
                        className="px-2.5 py-1 rounded-lg bg-error-container/30 text-error hover:bg-error-container text-xs font-label font-bold border border-error/20 transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
                        title="Remove Collaborator"
                      >
                        <span className="material-symbols-outlined text-sm">person_remove</span>
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareBoardModal;
