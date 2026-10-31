import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import AIPanelWrapper from '../ui/AIPanelWrapper';

const PANEL_WIDTH = 300;
const GUTTER = 8;

const IGNORED_OUTSIDE = '[data-ai-assistant-toggle], [data-tool-wheel-trigger], [role="menu"]';

export const AIAssistantMenu = ({ open, onClose, items, anchorRef, title }) => {
  const panelRef = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(PANEL_WIDTH, window.innerWidth - GUTTER * 2);
      const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, GUTTER), window.innerWidth - width - GUTTER);
      setPosition({ top: rect.bottom + 10, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      onClose();
      anchorRef.current?.focus();
    };
    const handlePointerDown = (event) => {
      if (panelRef.current?.contains(event.target) || event.target.closest?.(IGNORED_OUTSIDE)) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !position) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      className="fixed z-50 pointer-events-auto"
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      <AIPanelWrapper title={title} icon="psychology">
        <ul className="flex flex-col gap-1 -m-1">
          {items.map((item) => (
            <li key={item.id} className="stagger-item">
              <button
                type="button"
                onClick={() => {
                  item.action();
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-left text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined text-[20px] text-secondary" aria-hidden="true">{item.icon}</span>
                <span className="font-label text-sm font-bold">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </AIPanelWrapper>
    </div>
  );
};

export default AIAssistantMenu;
