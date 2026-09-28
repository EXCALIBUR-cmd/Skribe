import React from 'react';

const UndoRedoFloating = ({ canUndo, canRedo, onUndo, onRedo, isSidebarExpanded }) => {
  return (
    <div 
      className={`fixed bottom-6 z-40 transition-all duration-220 ease-out pointer-events-auto select-none ${
        isSidebarExpanded
          ? 'left-[344px]'
          : 'left-6 lg:left-[80px]'
      }`}
    >
      <div className="flex items-center gap-1.5 p-1.5 bg-surface/95 backdrop-blur-md rounded-full shadow-lg border border-outline-variant/60 sticker-shadow">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUndo();
          }}
          disabled={!canUndo}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:pointer-events-none hover:bg-surface-container-high hover:text-primary active:scale-95 cursor-pointer text-on-surface"
          title="Undo (Ctrl Z)"
          aria-label="Undo"
        >
          <span className="material-symbols-outlined text-[22px]">undo</span>
        </button>
        
        <div className="w-[1px] h-6 bg-outline-variant/50"></div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRedo();
          }}
          disabled={!canRedo}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-all disabled:opacity-30 disabled:pointer-events-none hover:bg-surface-container-high hover:text-primary active:scale-95 cursor-pointer text-on-surface"
          title="Redo (Ctrl Y)"
          aria-label="Redo"
        >
          <span className="material-symbols-outlined text-[22px]">redo</span>
        </button>
      </div>
    </div>
  );
};

export default UndoRedoFloating;
