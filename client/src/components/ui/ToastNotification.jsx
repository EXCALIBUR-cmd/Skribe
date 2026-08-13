import React, { useEffect, useRef } from 'react';
import anime from 'animejs';
import { ANIMATION_CONFIG, isReducedMotion } from '../../animations/config';

export const ToastNotification = ({ id, title, message, icon = 'info', type = 'primary', onClose }) => {
  const toastRef = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    const toast = toastRef.current;
    const progress = progressRef.current;

    if (!toast || isReducedMotion()) return;

    anime({
      targets: toast,
      translateX: [100, 0],
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: ANIMATION_CONFIG.durations.elastic,
      easing: ANIMATION_CONFIG.easings.elasticOut
    });

    if (progress) {
      anime({
        targets: progress,
        width: ['100%', '0%'],
        duration: ANIMATION_CONFIG.durations.toast,
        easing: 'linear',
        complete: handleDismiss
      });
    }
  }, []);

  const handleDismiss = () => {
    const toast = toastRef.current;
    if (!toast || isReducedMotion()) {
      onClose(id);
      return;
    }

    anime({
      targets: toast,
      translateX: 120,
      opacity: 0,
      scale: 0.85,
      duration: ANIMATION_CONFIG.durations.fast,
      easing: 'easeInQuad',
      complete: () => onClose(id)
    });
  };

  const typeStyles = {
    primary: 'border-primary bg-surface text-on-surface',
    secondary: 'border-secondary bg-surface text-on-surface',
    tertiary: 'border-tertiary bg-surface text-on-surface'
  };

  return (
    <div
      ref={toastRef}
      className={`relative w-80 rounded-xl border-2 p-4 shadow-xl sticker-shadow overflow-hidden mb-3 ${typeStyles[type]}`}
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-primary text-2xl">{icon}</span>
        <div className="flex-1">
          <h4 className="font-headline font-bold text-sm text-on-surface">{title}</h4>
          {message && <p className="font-body text-xs text-on-surface-variant mt-0.5">{message}</p>}
        </div>
        <button
          onClick={handleDismiss}
          className="text-on-surface-variant hover:text-primary p-0.5 rounded cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div
        ref={progressRef}
        className="absolute bottom-0 left-0 h-1 bg-primary rounded-full opacity-80"
        style={{ width: '100%' }}
      />
    </div>
  );
};

export default ToastNotification;
