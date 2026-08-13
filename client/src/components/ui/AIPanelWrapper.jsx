import React, { useEffect, useRef } from 'react';
import anime from 'animejs';
import { ANIMATION_CONFIG, isReducedMotion } from '../../animations/config';

export const AIPanelWrapper = ({ isOpen = true, title = 'AI Panel', icon = 'auto_awesome', children, className = '' }) => {
  const panelRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const panel = panelRef.current;
    const content = contentRef.current;

    if (!isReducedMotion() && panel && content) {
      const childrenElements = content.querySelectorAll('.stagger-item');

      anime.timeline()
        .add({
          targets: panel,
          translateX: [40, 0],
          opacity: [0, 1],
          duration: ANIMATION_CONFIG.durations.normal,
          easing: ANIMATION_CONFIG.easings.smoothOut
        })
        .add({
          targets: childrenElements,
          translateY: [15, 0],
          opacity: [0, 1],
          delay: anime.stagger(60),
          duration: ANIMATION_CONFIG.durations.fast,
          easing: ANIMATION_CONFIG.easings.smoothOut
        }, '-=100');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={`bg-surface rounded-xl border-2 border-secondary sticker-shadow flex flex-col overflow-hidden ${className}`}
    >
      <div className="p-4 border-b-2 border-surface-container flex items-center justify-between bg-surface-container-low">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
            {icon}
          </span>
          <h3 className="font-headline font-bold text-base text-on-surface">{title}</h3>
        </div>
      </div>

      <div ref={contentRef} className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
};

export default AIPanelWrapper;
