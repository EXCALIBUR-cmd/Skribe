import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

export const ScrollablePopover = ({
  isOpen,
  onClose,
  anchorRef,
  width = 280,
  maxHeight = 'calc(100vh - 100px)',
  className = '',
  children
}) => {
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);

  const updatePos = () => {
    if (!anchorRef || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    let left = rect.left;

    if (left + width > window.innerWidth - 16) {
      left = window.innerWidth - width - 16;
    }
    if (left < 16) left = 16;

    let top = rect.bottom + 8;
    const expectedHeight = 400;

    if (top + expectedHeight > window.innerHeight && rect.top > expectedHeight) {
      top = Math.max(16, rect.top - expectedHeight - 8);
    }

    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (isOpen) {
      updatePos();
      window.addEventListener('resize', updatePos);
      window.addEventListener('scroll', updatePos, true);
      return () => {
        window.removeEventListener('resize', updatePos);
        window.removeEventListener('scroll', updatePos, true);
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const el = containerRef.current;

    const handleWheel = (e) => {
      console.log('[ColorPicker/ScrollablePopover] Wheel event received');

      e.stopPropagation();
      console.log('[ColorPicker/ScrollablePopover] stopPropagation()');

      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      const { scrollTop, scrollHeight, clientHeight } = el;
      const deltaY = e.deltaY;
      const isScrollable = scrollHeight > clientHeight;

      const prevScrollTop = el.scrollTop;

      if (isScrollable) {

        el.scrollTop += deltaY;
        if (el.scrollTop !== prevScrollTop) {
          console.log(`[ColorPicker/ScrollablePopover] scrollTop changed: ${prevScrollTop.toFixed(0)} -> ${el.scrollTop.toFixed(0)}`);
        }
      }

      e.preventDefault();
      console.log('[ColorPicker/ScrollablePopover] preventDefault()');
    };

    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [isOpen]);

  const handleMouseEnter = () => {
    window.__skribePopoverHovered = true;
  };

  const handleMouseLeave = () => {
    window.__skribePopoverHovered = false;
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (anchorRef && anchorRef.current && anchorRef.current.contains(e.target)) return;
      if (containerRef.current && containerRef.current.contains(e.target)) return;
      window.__skribePopoverHovered = false;
      if (onClose) onClose();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        window.__skribePopoverHovered = false;
        if (onClose) onClose();
      }
    };

    window.addEventListener('mousedown', handleOutsideClick, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, anchorRef]);

  useEffect(() => {
    return () => {
      window.__skribePopoverHovered = false;
    };
  }, []);

  if (!isOpen) return null;

  return ReactDOM.createPortal(
    <div
      ref={containerRef}
      data-scrollable-popover="true"
      tabIndex={-1}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: `${popoverPos.top}px`,
        left: `${popoverPos.left}px`,
        width: typeof width === 'number' ? `${width}px` : width,
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        zIndex: 9999,
        overscrollBehavior: 'contain',
        WebkitOverscrollBehavior: 'contain'
      }}
      className={`bg-surface border-2 border-primary rounded-2xl p-3.5 shadow-2xl sticker-shadow overflow-y-auto overflow-x-hidden custom-scrollbar focus:outline-none ${className}`}
    >
      {children}
    </div>,
    document.body
  );
};

export default ScrollablePopover;
