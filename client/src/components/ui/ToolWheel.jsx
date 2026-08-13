import React, { useEffect, useRef, useState, useCallback } from 'react';
import anime from 'animejs';
import FloatingToolPanel from './FloatingToolPanel';

export const ToolWheel = React.memo(({
  isOpen,
  onClose,
  title = 'Tools',
  items = [],
  anchorPos = { x: 80, y: 300 },
  activeToolId,
  onSelectTool
}) => {
  const [activeCategory, setActiveCategory] = useState(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const wheelRef = useRef(null);
  const itemsContainerRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setActiveCategory(null);
      setFocusedIndex(-1);
    }
  }, [isOpen]);

  const radius = 125;

  const categoryNodes = [
    { key: 'sticky', label: 'Sticky Notes', icon: 'sticky_note_2' },
    { key: 'shapes', label: 'Shapes', icon: 'square' },
    { key: 'text', label: 'Text', icon: 'title' },
    { key: 'image', label: 'Image / Assets', icon: 'image' },
    { key: 'connectors', label: 'Connectors', icon: 'east' }
  ];

  const getItemPosition = useCallback((index, total = categoryNodes.length, r = radius) => {
    const startAngle = -Math.PI / 2;
    const angle = startAngle + (index / total) * 2 * Math.PI;
    return {
      x: Math.round(r * Math.cos(angle)),
      y: Math.round(r * Math.sin(angle)),
      angleDegrees: (angle * 180) / Math.PI
    };
  }, [radius, categoryNodes.length]);

  useEffect(() => {
    if (!isOpen || !wheelRef.current) return;

    if (animationRef.current) animationRef.current.pause();

    const wheelEl = wheelRef.current;
    const itemNodes = wheelEl.querySelectorAll('.wheel-item-node');
    const labelNodes = wheelEl.querySelectorAll('.wheel-label-node');

    anime.set(wheelEl, { scale: 0.75, opacity: 0 });
    anime.set(itemNodes, { scale: 0, opacity: 0 });
    anime.set(labelNodes, { opacity: 0, translateY: 6 });

    animationRef.current = anime.timeline({
      easing: 'easeOutBack'
    });

    animationRef.current
      .add({
        targets: wheelEl,
        scale: [0.75, 1],
        opacity: [0, 1],
        duration: 240,
        easing: 'easeOutBack'
      })
      .add({
        targets: itemNodes,
        scale: [0, 1],
        opacity: [0, 1],
        delay: anime.stagger(40),
        duration: 220,
        easing: 'easeOutBack'
      }, '-=150')
      .add({
        targets: labelNodes,
        opacity: [0, 1],
        translateY: [6, 0],
        delay: anime.stagger(30),
        duration: 180,
        easing: 'easeOutQuad'
      }, '-=120');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (activeCategory) {
          setActiveCategory(null);
        } else {
          onClose();
        }
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          if (prev === -1) return 0;
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            return (prev + 1) % categoryNodes.length;
          } else {
            return (prev - 1 + categoryNodes.length) % categoryNodes.length;
          }
        });
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < categoryNodes.length) {
          const selected = categoryNodes[focusedIndex];
          handleCategoryClick(selected.key);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeCategory, focusedIndex, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      const isInsideWheel = wheelRef.current && wheelRef.current.contains(e.target);
      const isInsidePanel = e.target.closest('[role="menu"]') !== null;

      if (!isInsideWheel && !isInsidePanel) {
        onClose();
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener('pointerdown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleCategoryClick = (categoryKey) => {
    const prevCategory = activeCategory;
    const newCategory = prevCategory === categoryKey ? null : categoryKey;

    console.log(`[ToolWheel] Creation Category clicked: ${categoryKey} | Previous activeCategory: ${prevCategory} | New activeCategory: ${newCategory}`);
    setActiveCategory(newCategory);
  };

  const handleSubItemSelect = (subItem) => {
    console.log('[ToolWheel] Executing Tool Action:', subItem);

    if (subItem.action) {
      subItem.action();
    } else if (subItem.actionType === 'upload') {
      onSelectTool && onSelectTool('upload');
    } else if (onSelectTool) {
      onSelectTool(subItem.toolType || subItem.id, subItem);
    }

    if (wheelRef.current) {
      anime({
        targets: wheelRef.current,
        scale: 0.85,
        opacity: 0,
        duration: 160,
        easing: 'easeInQuad',
        complete: () => {
          onClose();
        }
      });
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        ref={wheelRef}
        role="menu"
        aria-label={title}
        tabIndex={-1}
        style={{
          left: `${anchorPos.x}px`,
          top: `${anchorPos.y}px`
        }}
        className="fixed z-50 -translate-x-1/2 -translate-y-1/2 pointer-events-auto select-none"
      >
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-[-24px] rounded-full bg-primary/10 blur-2xl pointer-events-none" />

          <button
            onClick={onClose}
            className="relative z-30 w-16 h-16 rounded-full bg-surface/95 text-on-surface border-2 border-primary shadow-2xl flex flex-col items-center justify-center hover:bg-primary hover:text-on-primary transition-all duration-200 cursor-pointer active:scale-95 group focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label="Close wheel menu"
            title="Close Menu (ESC)"
          >
            <span className="material-symbols-outlined text-2xl transition-transform group-hover:rotate-90">
              close
            </span>
            <span className="text-[9px] font-black tracking-wider uppercase opacity-80 group-hover:opacity-100">
              Close
            </span>
          </button>

          <div ref={itemsContainerRef} className="absolute inset-0 flex items-center justify-center">
            {categoryNodes.map((cat, idx) => {
              const pos = getItemPosition(idx, categoryNodes.length);
              const isFocused = focusedIndex === idx;
              const isCategoryActive = activeCategory === cat.key;

              return (
                <div
                  key={cat.key}
                  style={{
                    transform: `translate(${pos.x}px, ${pos.y}px)`
                  }}
                  className="wheel-item-node absolute flex flex-col items-center justify-center transition-transform duration-200"
                >
                  <div className="relative group/node flex flex-col items-center">
                    <button
                      onClick={() => handleCategoryClick(cat.key)}
                      onMouseEnter={() => setFocusedIndex(idx)}
                      className={`group w-14 h-14 rounded-full border-2 sticker-shadow flex items-center justify-center transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary ${
                        isCategoryActive
                          ? 'bg-primary text-on-primary border-primary shadow-2xl scale-115 ring-2 ring-primary ring-offset-2 font-bold'
                          : isFocused
                          ? 'bg-surface-container-high text-primary border-primary scale-112 shadow-lg'
                          : 'bg-surface/95 text-on-surface border-primary/80 hover:bg-primary/10 hover:border-primary hover:scale-110 hover:shadow-xl'
                      }`}
                      aria-label={cat.label}
                      aria-expanded={isCategoryActive}
                      role="menuitem"
                    >
                      <span className="material-symbols-outlined text-2xl transition-transform group-hover:scale-110">
                        {cat.icon}
                      </span>
                    </button>

                    <span className="wheel-label-node mt-1.5 text-[11px] font-label font-bold text-on-surface tracking-tight text-center opacity-85 group-hover/node:opacity-100 group-hover/node:text-primary transition-all whitespace-nowrap drop-shadow-sm">
                      {cat.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <FloatingToolPanel
        isOpen={isOpen && !!activeCategory}
        activeCategory={activeCategory}
        anchorPos={anchorPos}
        onSelectTool={handleSubItemSelect}
        onClose={() => setActiveCategory(null)}
      />
    </>
  );
});

export default ToolWheel;
