import React, { useEffect, useRef, useMemo } from 'react';
import { getMenuItemsForCategory, getCategoryLabel } from '../../config/ToolRegistry';

export const FloatingToolPanel = React.memo(({
  isOpen,
  activeCategory,
  anchorPos = { x: 400, y: 300 },
  onSelectTool,
  onClose
}) => {
  const panelRef = useRef(null);

  console.log('[FloatingToolPanel] Received props:', {
    isOpen,
    activeCategory,
    anchorPos
  });

  const menuItems = useMemo(() => {
    return getMenuItemsForCategory(activeCategory);
  }, [activeCategory]);

  const categoryLabel = useMemo(() => {
    return getCategoryLabel(activeCategory);
  }, [activeCategory]);

  const shouldRender = isOpen && !!activeCategory && menuItems.length > 0;
  console.log('[FloatingToolPanel] Render Decision:', {
    shouldRender,
    isOpen,
    activeCategory,
    menuItemCount: menuItems.length
  });

  useEffect(() => {
    if (!shouldRender) return;

    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {

      }
    };

    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [shouldRender]);

  const popoverPosition = useMemo(() => {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
    const radius = 125;
    const panelWidth = 195;
    const panelMaxHeight = 320;

    const hasSpaceRight = anchorPos.x + radius + panelWidth + 30 < screenWidth;
    const left = hasSpaceRight
      ? Math.round(anchorPos.x + radius + 35)
      : Math.max(16, Math.round(anchorPos.x - radius - panelWidth - 35));

    const rawTop = Math.round(anchorPos.y - panelMaxHeight / 2);
    const top = Math.min(Math.max(20, rawTop), screenHeight - panelMaxHeight - 20);

    return { left: `${left}px`, top: `${top}px` };
  }, [anchorPos]);

  if (!shouldRender) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: popoverPosition.left,
        top: popoverPosition.top
      }}
      role="menu"
      aria-label={`${categoryLabel} Submenu`}
      className="z-50 bg-surface/95 backdrop-blur-md rounded-2xl p-2 border-2 border-primary shadow-2xl flex flex-col gap-1 min-w-[195px] max-h-[320px] overflow-y-auto animate-in fade-in slide-in-from-left-3 zoom-in-95 duration-200 pointer-events-auto select-none"
    >
      <div className="px-3 py-1.5 border-b border-outline-variant/50 text-[10px] font-black uppercase text-on-surface-variant/70 tracking-wider flex items-center justify-between">
        <span>{categoryLabel} Options</span>
        <button
          onClick={onClose}
          className="text-on-surface-variant/60 hover:text-primary transition-colors cursor-pointer"
          title="Close Submenu"
        >
          <span className="material-symbols-outlined text-sm">close</span>
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {menuItems.map((subItem) => (
          <button
            key={subItem.id}
            onClick={() => {
              if (onSelectTool) onSelectTool(subItem);
            }}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-primary hover:text-on-primary transition-all text-xs font-bold text-left cursor-pointer group/flyout"
            role="menuitem"
          >
            <div className="flex items-center gap-2.5">
              {subItem.icon && (
                <span className="material-symbols-outlined text-base group-hover/flyout:scale-110 transition-transform">
                  {subItem.icon}
                </span>
              )}
              {subItem.colorDot && (
                <span
                  className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-xs"
                  style={{ backgroundColor: subItem.colorDot }}
                />
              )}
              <span>{subItem.label}</span>
            </div>
            {subItem.badge && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent text-on-accent font-black">
                {subItem.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});

export default FloatingToolPanel;
