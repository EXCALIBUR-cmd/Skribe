import { useEffect, useRef } from 'react';
import anime from 'animejs';
import { ANIMATION_CONFIG, isReducedMotion } from './config';

export const useAnime = (animeParams, deps = []) => {
  const elementRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    if (!elementRef.current || isReducedMotion()) return;

    if (animationRef.current) {
      animationRef.current.pause();
    }

    const params = typeof animeParams === 'function' ? animeParams(elementRef.current) : animeParams;

    animationRef.current = anime({
      targets: elementRef.current,
      ...params
    });

    return () => {
      if (animationRef.current) {
        animationRef.current.pause();
      }
    };
  }, deps);

  return elementRef;
};

export const useHoverAnimation = (options = {}) => {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || isReducedMotion()) return;

    const liftY = options.liftY ?? ANIMATION_CONFIG.hover.liftY;
    const scale = options.scale ?? ANIMATION_CONFIG.hover.scale;

    const handleMouseEnter = () => {
      anime.remove(el);
      anime({
        targets: el,
        translateY: liftY,
        scale: scale,
        duration: ANIMATION_CONFIG.hover.duration,
        easing: ANIMATION_CONFIG.easings.smoothOut
      });
    };

    const handleMouseLeave = () => {
      anime.remove(el);
      anime({
        targets: el,
        translateY: 0,
        scale: 1,
        duration: ANIMATION_CONFIG.hover.duration,
        easing: ANIMATION_CONFIG.easings.smoothOut
      });
    };

    const handleMouseDown = () => {
      anime({
        targets: el,
        scale: ANIMATION_CONFIG.press.scale,
        translateY: ANIMATION_CONFIG.press.pressY,
        duration: ANIMATION_CONFIG.press.duration,
        easing: 'easeOutQuad'
      });
    };

    const handleMouseUp = () => {
      anime({
        targets: el,
        scale: scale,
        translateY: liftY,
        duration: 150,
        easing: 'easeOutQuad'
      });
    };

    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('mousedown', handleMouseDown);
    el.addEventListener('mouseup', handleMouseUp);

    return () => {
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('mousedown', handleMouseDown);
      el.removeEventListener('mouseup', handleMouseUp);
      anime.remove(el);
    };
  }, []);

  return ref;
};

export const createRippleEffect = (event, container) => {
  if (!container || isReducedMotion()) return;

  const rect = container.getBoundingClientRect();
  const circle = document.createElement('span');
  const diameter = Math.max(rect.width, rect.height);
  const radius = diameter / 2;

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${event.clientX - rect.left - radius}px`;
  circle.style.top = `${event.clientY - rect.top - radius}px`;
  circle.style.position = 'absolute';
  circle.style.borderRadius = '50%';
  circle.style.backgroundColor = 'rgba(174, 47, 52, 0.25)';
  circle.style.pointerEvents = 'none';
  circle.style.transform = 'scale(0)';

  container.appendChild(circle);

  anime({
    targets: circle,
    scale: 2.5,
    opacity: [0.6, 0],
    duration: 500,
    easing: 'easeOutQuart',
    complete: () => {
      circle.remove();
    }
  });
};

export default useAnime;
