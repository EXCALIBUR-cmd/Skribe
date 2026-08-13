import React, { useEffect, useRef } from 'react';

export const ContextMenu = ({
  position,
  selectedProps,
  onEditText,
  onDuplicate,
  onDeleteText,
  onDeleteShape,
  onDeleteEntire,
  onBringToFront,
  onSendToBack,
  onClose
}) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!position) return null;

  const { hasText, isLinkedElement, hasSelection } = selectedProps || {};

  return (
    <div
      ref={menuRef}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 bg-surface/95 backdrop-blur-md border-2 border-primary rounded-2xl p-1.5 shadow-2xl sticker-shadow w-52 flex flex-col gap-0.5 text-xs font-label"
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasText && (
        <button
          onClick={() => {
            onEditText();
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-on-surface hover:bg-surface-container-high hover:text-primary transition-colors cursor-pointer text-left font-bold"
        >
          <span className="material-symbols-outlined text-base">edit</span>
          <span>Edit Text</span>
        </button>
      )}

      {hasSelection && (
        <button
          onClick={() => {
            onDuplicate();
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-on-surface hover:bg-surface-container-high hover:text-primary transition-colors cursor-pointer text-left font-bold"
        >
          <span className="material-symbols-outlined text-base">content_copy</span>
          <span>Duplicate</span>
        </button>
      )}

      {hasSelection && (
        <>
          <div className="h-px bg-outline-variant/60 my-1" />

          <button
            onClick={() => {
              onBringToFront();
              onClose();
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-on-surface hover:bg-surface-container-high hover:text-primary transition-colors cursor-pointer text-left"
          >
            <span className="material-symbols-outlined text-base">vertical_align_top</span>
            <span>Bring to Front</span>
          </button>

          <button
            onClick={() => {
              onSendToBack();
              onClose();
            }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-on-surface hover:bg-surface-container-high hover:text-primary transition-colors cursor-pointer text-left"
          >
            <span className="material-symbols-outlined text-base">vertical_align_bottom</span>
            <span>Send to Back</span>
          </button>
        </>
      )}

      {hasSelection && <div className="h-px bg-outline-variant/60 my-1" />}

      {hasText && (
        <button
          onClick={() => {
            onDeleteText();
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-error hover:bg-error-container transition-colors cursor-pointer text-left"
        >
          <span className="material-symbols-outlined text-base">phonelink_erase</span>
          <span>Delete Text Only</span>
        </button>
      )}

      {isLinkedElement && (
        <button
          onClick={() => {
            onDeleteShape();
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-error hover:bg-error-container transition-colors cursor-pointer text-left"
        >
          <span className="material-symbols-outlined text-base">shape_line</span>
          <span>Delete Shape Only</span>
        </button>
      )}

      {hasSelection && (
        <button
          onClick={() => {
            onDeleteEntire();
            onClose();
          }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-error hover:bg-error-container transition-colors cursor-pointer text-left font-bold"
        >
          <span className="material-symbols-outlined text-base">delete</span>
          <span>Delete Entire Element</span>
        </button>
      )}
    </div>
  );
};

export default ContextMenu;
