import React, { useEffect, useRef } from 'react';
import anime from 'animejs';
import { ANIMATION_CONFIG, isReducedMotion } from '../../animations/config';

export const AnimatedModal = ({ isOpen, onClose, title, children }) => {
  const overlayRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const overlay = overlayRef.current;
    const modal = modalRef.current;

    if (!isReducedMotion() && overlay && modal) {
      anime.timeline()
        .add({
          targets: overlay,
          opacity: [0, 1],
          duration: ANIMATION_CONFIG.durations.normal,
          easing: ANIMATION_CONFIG.easings.smoothOut
        })
        .add({
          targets: modal,
          scale: [0.85, 1],
          opacity: [0, 1],
          translateY: [20, 0],
          duration: ANIMATION_CONFIG.durations.elastic,
          easing: ANIMATION_CONFIG.easings.backOut
        }, '-=150');
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleClose = () => {
    const overlay = overlayRef.current;
    const modal = modalRef.current;

    if (!isReducedMotion() && overlay && modal) {
      anime.timeline({
        complete: onClose
      })
        .add({
          targets: modal,
          scale: 0.9,
          opacity: 0,
          duration: ANIMATION_CONFIG.durations.fast,
          easing: 'easeInQuad'
        })
        .add({
          targets: overlay,
          opacity: 0,
          duration: ANIMATION_CONFIG.durations.fast,
          easing: 'easeInQuad'
        }, '-=100');
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-inverse-surface/40 backdrop-blur-md flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        className="bg-surface border-2 border-primary rounded-2xl p-6 shadow-2xl max-w-lg w-full sticker-shadow relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 pb-2 border-b border-surface-variant">
          <h3 className="font-headline font-bold text-xl text-on-surface">{title}</h3>
          <button
            onClick={handleClose}
            className="p-1 rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div>{children}</div>
      </div>
    </div>
  );
};

export default AnimatedModal;
