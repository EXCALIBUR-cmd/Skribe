import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import anime from 'animejs';
import { ANIMATION_CONFIG, isReducedMotion } from '../animations/config';
import { CommandPalette } from '../components/ui/CommandPalette';
import { ShareBoardModal } from '../components/ui/ShareBoardModal';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/apiClient';

const BoardCardTitleInput = ({ initialTitle, onSave, onCancel }) => {
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  return (
    <div onClick={(e) => e.stopPropagation()} className="w-full">
      <input
        ref={inputRef}
        type="text"
        maxLength={100}
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave(draftTitle);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onSave(draftTitle)}
        className="w-full bg-surface border-2 border-primary rounded-lg px-2 py-0.5 font-headline font-bold text-sm text-on-surface outline-none shadow-xs"
      />
    </div>
  );
};

export const BoardsPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [boards, setBoards] = useState([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [boardError, setBoardError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All Boards');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeMenuBoardId, setActiveMenuBoardId] = useState(null);
  const [sharingBoard, setSharingBoard] = useState(null);
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);

  const [renamingBoardId, setRenamingBoardId] = useState(null);

  const sidebarRef = useRef(null);
  const mainContentRef = useRef(null);

  const fetchBoards = useCallback(async () => {
    try {
      setLoadingBoards(true);
      setBoardError('');
      const res = await apiClient.get('/boards');
      if (res.success && Array.isArray(res.data?.boards)) {
        setBoards(res.data.boards);
      }
    } catch (err) {
      console.error('[BoardsPage] Failed to fetch boards:', err);
      setBoardError(err.message || 'Failed to load your whiteboards.');
    } finally {
      setLoadingBoards(false);
    }
  }, []);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  const handleCreateBoard = async () => {
    try {
      setIsCreatingBoard(true);
      const res = await apiClient.post('/boards', { title: 'Untitled Board' });
      if (res.success && res.data?.board) {
        navigate(`/board/${res.data.board.id}`);
      }
    } catch (err) {
      console.error('[BoardsPage] Create board failed:', err);
      alert(err.message || 'Failed to create new board.');
    } finally {
      setIsCreatingBoard(false);
    }
  };

  const handleDeleteBoard = async (e, boardId) => {
    e.stopPropagation();
    setActiveMenuBoardId(null);
    if (!window.confirm('Are you sure you want to move this whiteboard to Trash?')) return;

    try {
      const res = await apiClient.delete(`/boards/${boardId}`);
      if (res.success) {
        setBoards((prev) => prev.filter((b) => b.id !== boardId));
      }
    } catch (err) {
      console.error('[BoardsPage] Delete board failed:', err);
      alert(err.message || 'Failed to delete board.');
    }
  };

  const handleStartRename = (e, board) => {
    e.stopPropagation();
    setActiveMenuBoardId(null);
    setRenamingBoardId(board.id);
  };

  const handleCancelRename = () => {
    setRenamingBoardId(null);
  };

  const handleSaveRename = async (boardId, rawNewTitle) => {
    const currentBoard = boards.find((b) => b.id === boardId);
    if (!currentBoard) {
      handleCancelRename();
      return;
    }

    const previousTitle = currentBoard.title;
    let newTitle = (rawNewTitle || '').trim();

    if (!newTitle) {
      newTitle = 'Untitled Board';
    }

    if (newTitle.length > 100) {
      newTitle = newTitle.substring(0, 100);
    }

    if (newTitle === previousTitle) {
      handleCancelRename();
      return;
    }

    setBoards((prev) =>
      prev.map((b) => (b.id === boardId ? { ...b, title: newTitle, updatedAt: new Date().toISOString() } : b))
    );
    setRenamingBoardId(null);

    try {
      const res = await apiClient.patch(`/boards/${boardId}`, { title: newTitle });
      if (!res.success) {
        throw new Error(res.message || 'Failed to save board title');
      }
    } catch (err) {
      console.error('[BoardsPage] Rename board error:', err);

      setBoards((prev) =>
        prev.map((b) => (b.id === boardId ? { ...b, title: previousTitle } : b))
      );
      alert("Couldn't rename board. Please try again.");
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const main = mainContentRef.current;
    if (!sidebar || !main || isReducedMotion()) return;

    const width = isSidebarCollapsed ? 80 : 256;
    const paddingLeft = isSidebarCollapsed ? 104 : 288;

    anime({
      targets: sidebar,
      width: width,
      duration: ANIMATION_CONFIG.durations.elastic,
      easing: ANIMATION_CONFIG.easings.elasticOut
    });

    anime({
      targets: main,
      paddingLeft: paddingLeft,
      duration: ANIMATION_CONFIG.durations.elastic,
      easing: ANIMATION_CONFIG.easings.elasticOut
    });
  }, [isSidebarCollapsed]);

  const filteredBoards = boards.filter((board) => {
    const matchesSearch = board.title.toLowerCase().includes(searchQuery.toLowerCase());
    if (activeTab === 'Starred') return matchesSearch && board.isArchived;
    return matchesSearch;
  });

  return (
    <div className="min-h-screen bg-background text-on-background font-body relative flex">
      <CommandPalette isOpen={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
      <ShareBoardModal
        isOpen={!!sharingBoard}
        onClose={() => setSharingBoard(null)}
        board={sharingBoard}
      />

      <nav
        ref={sidebarRef}
        className="hidden md:flex flex-col py-6 fixed left-0 top-16 h-[calc(100vh-64px)] w-64 rounded-r-2xl bg-surface-container-lowest border-r-2 border-outline-variant shadow-md z-40 overflow-hidden"
      >
        <div className="px-4 py-3 flex items-center justify-between mb-4 border-b border-surface-variant">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-lg bg-secondary-container border-2 border-secondary flex items-center justify-center shrink-0 -rotate-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                folder_open
              </span>
            </div>
            {!isSidebarCollapsed && (
              <div className="overflow-hidden">
                <h2 className="font-headline font-bold text-sm text-primary tracking-tight whitespace-nowrap truncate max-w-[140px]">
                  {user?.name || 'My Workspace'}
                </h2>
                <p className="font-body text-xs text-on-surface-variant whitespace-nowrap">
                  {boards.length} active {boards.length === 1 ? 'board' : 'boards'}
                </p>
              </div>
            )}
          </div>
          <button
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            className="p-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
            title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            <span className="material-symbols-outlined text-xl">
              {isSidebarCollapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
        </div>

        <div className="px-4 mb-6">
          <button
            onClick={handleCreateBoard}
            disabled={isCreatingBoard}
            className="w-full bg-primary text-on-primary font-label text-sm font-bold py-3 px-3 rounded-full border-2 border-on-primary-fixed shadow-md hover:scale-102 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined">add</span>
            {!isSidebarCollapsed && <span>{isCreatingBoard ? 'Creating...' : 'New Board'}</span>}
          </button>
        </div>

        <ul className="flex flex-col gap-1 w-full flex-1 px-2">
          {[
            { name: 'All Boards', icon: 'dashboard' },
            { name: 'Recent', icon: 'schedule', fill: true },
            { name: 'Starred', icon: 'grade' }
          ].map((tab) => {
            const isActive = activeTab === tab.name;
            return (
              <li key={tab.name}>
                <button
                  onClick={() => setActiveTab(tab.name)}
                  className={`w-full flex items-center gap-3 py-3 px-3 rounded-xl font-label text-sm font-bold transition-all cursor-pointer relative overflow-hidden ${
                    isActive
                      ? 'bg-secondary-container text-on-secondary-container border-l-4 border-secondary shadow-sm scale-102'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-xl transition-transform hover:scale-125"
                    style={tab.fill ? { fontVariationSettings: "'FILL' 1" } : {}}
                  >
                    {tab.icon}
                  </span>
                  {!isSidebarCollapsed && (
                    <span className="whitespace-nowrap transition-opacity duration-200">{tab.name}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="px-3 pt-2 space-y-2">
          <button
            onClick={() => setIsCommandPaletteOpen(true)}
            className="w-full bg-surface-container-high text-on-surface-variant hover:text-primary p-2.5 rounded-xl border border-outline-variant/60 flex items-center justify-between text-xs font-label font-semibold cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-base">search</span>
              {!isSidebarCollapsed && <span>Quick Search</span>}
            </div>
            {!isSidebarCollapsed && (
              <kbd className="bg-surface-container text-on-surface-variant px-1.5 py-0.5 rounded border border-outline-variant text-[10px]">
                ⌘K
              </kbd>
            )}
          </button>

          <button
            onClick={logout}
            className="w-full bg-error-container/40 text-on-error-container hover:bg-error-container hover:text-on-error-container p-2.5 rounded-xl border border-error/20 flex items-center justify-center gap-2 text-xs font-label font-bold cursor-pointer transition-colors"
            title="Log Out"
          >
            <span className="material-symbols-outlined text-base">logout</span>
            {!isSidebarCollapsed && <span>Log Out</span>}
          </button>
        </div>
      </nav>

      <main ref={mainContentRef} className="pt-8 pb-16 pl-[288px] pr-8 w-full min-h-[calc(100vh-64px)] relative z-10">
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
            <div>
              <h1 className="font-headline text-3xl font-bold text-on-surface flex items-center gap-3">
                <span className="material-symbols-outlined text-4xl text-secondary rotate-12" style={{ fontVariationSettings: "'FILL' 1" }}>
                  draw
                </span>
                {activeTab}
              </h1>
              <p className="font-body text-base text-on-surface-variant mt-1">
                Pick up right where you left off. Welcome back, <strong className="text-primary">{user?.name || 'Creator'}</strong>.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Search boards..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-surface-container-low border-2 border-outline-variant rounded-full px-4 py-2 text-xs text-on-surface font-body outline-none focus:border-primary transition-colors w-48 md:w-64"
              />
              <button
                onClick={handleCreateBoard}
                disabled={isCreatingBoard}
                className="bg-primary text-on-primary border-2 border-on-primary-fixed rounded-full px-4 py-2 font-label text-sm font-bold shadow-sm hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">add</span>
                <span>New Board</span>
              </button>
            </div>
          </div>

          {loadingBoards && (
            <div className="py-20 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <span className="text-sm font-bold text-on-surface-variant">Loading your whiteboards...</span>
            </div>
          )}

          {boardError && (
            <div className="p-4 bg-error-container text-on-error-container rounded-xl border border-error/30 mb-8 font-bold text-xs flex items-center justify-between">
              <span>{boardError}</span>
              <button onClick={fetchBoards} className="px-3 py-1 bg-error text-on-error rounded-lg hover:brightness-110 cursor-pointer">
                Retry
              </button>
            </div>
          )}

          {!loadingBoards && filteredBoards.length === 0 && (
            <div className="py-20 px-4 text-center border-2 border-dashed border-outline-variant/60 rounded-3xl bg-surface-container-lowest/50 flex flex-col items-center justify-center">
              <span className="material-symbols-outlined text-6xl text-primary mb-3">dashboard_customize</span>
              <h3 className="font-headline text-xl font-bold text-on-surface">No whiteboards found</h3>
              <p className="font-body text-sm text-on-surface-variant mt-1 max-w-sm">
                Create your first whiteboard to start brainstorming, sketching, and making a mess.
              </p>
              <button
                onClick={handleCreateBoard}
                className="mt-6 bg-primary text-on-primary font-label text-sm font-bold py-3 px-6 rounded-full border-2 border-on-primary-fixed shadow-md hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined">add</span>
                <span>Create First Board</span>
              </button>
            </div>
          )}

          {!loadingBoards && filteredBoards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredBoards.map((board) => (
                <div
                  key={board.id}
                  onClick={() => {
                    if (renamingBoardId !== board.id) {
                      navigate(`/board/${board.id}`);
                    }
                  }}
                  className="bg-surface-container-lowest border-2 border-outline rounded-xl overflow-hidden cursor-pointer group flex flex-col h-[280px] hover:-translate-y-1.5 hover:shadow-[6px_6px_0px_0px_#ae2f34] transition-all duration-200 relative"
                >
                  <div className="relative flex-1 bg-surface p-4 overflow-hidden border-b-2 border-outline/30 flex items-center justify-center">
                    <div className="relative z-10 w-24 h-24 bg-surface-container-lowest rounded-2xl border-4 border-primary/40 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-5xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                        auto_awesome
                      </span>
                    </div>

                    <div className="absolute bottom-3 right-3 bg-surface-container-high/80 backdrop-blur-sm text-on-surface-variant px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border border-outline-variant">
                      {(() => {
                        let data = board.canvasData;
                        if (typeof data === 'string') {
                          try { data = JSON.parse(data); } catch (e) {}
                        }
                        const count = Array.isArray(data?.objects) ? data.objects.length : 0;
                        return `${count} ${count === 1 ? 'item' : 'items'}`;
                      })()}
                    </div>
                  </div>

                  <div className="p-4 bg-surface-container-lowest flex justify-between items-start">
                    <div className="flex-1 mr-2 overflow-hidden">
                      {renamingBoardId === board.id ? (
                        <BoardCardTitleInput
                          initialTitle={board.title || 'Untitled Board'}
                          onSave={(newTitle) => handleSaveRename(board.id, newTitle)}
                          onCancel={handleCancelRename}
                        />
                      ) : (
                        <>
                          <h3 className="font-headline font-bold text-base text-on-surface group-hover:text-primary transition-colors line-clamp-1">
                            {board.title}
                          </h3>
                          <p className="font-body text-xs text-on-surface-variant mt-1">
                            Updated {new Date(board.updatedAt).toLocaleDateString()}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setActiveMenuBoardId((prev) => (prev === board.id ? null : board.id))}
                        className="text-on-surface-variant hover:text-primary p-1 rounded-lg hover:bg-surface-container-high cursor-pointer transition-colors"
                        title="Board Actions"
                      >
                        <span className="material-symbols-outlined text-lg">more_vert</span>
                      </button>

                      {activeMenuBoardId === board.id && (
                        <div className="absolute right-0 bottom-8 w-44 bg-surface-container-lowest border-2 border-outline-variant rounded-xl shadow-xl z-50 py-1 font-label text-xs">
                          <button
                            onClick={(e) => handleStartRename(e, board)}
                            className="w-full px-3 py-2 text-left hover:bg-surface-container-high text-on-surface font-bold flex items-center gap-2 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-base text-primary">edit</span>
                            <span>Rename Board</span>
                          </button>

                          <button
                            disabled
                            className="w-full px-3 py-2 text-left text-on-surface-variant/50 font-medium flex items-center justify-between cursor-not-allowed opacity-60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-base">star</span>
                              <span>Favorite</span>
                            </div>
                            <span className="text-[9px] bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant font-mono">Soon</span>
                          </button>

                          <button
                            disabled
                            className="w-full px-3 py-2 text-left text-on-surface-variant/50 font-medium flex items-center justify-between cursor-not-allowed opacity-60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-base">content_copy</span>
                              <span>Duplicate</span>
                            </div>
                            <span className="text-[9px] bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant font-mono">Soon</span>
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuBoardId(null);
                              setSharingBoard(board);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-surface-container-high text-on-surface font-bold flex items-center gap-2 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-base text-primary">share</span>
                            <span>Share</span>
                          </button>

                          <div className="my-1 border-t border-outline-variant/40" />

                          <button
                            onClick={(e) => handleDeleteBoard(e, board.id)}
                            className="w-full px-3 py-2 text-left hover:bg-error-container text-error font-bold flex items-center gap-2 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                            <span>Delete Board</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default BoardsPage;
