import anime from 'animejs';

export const isReducedMotion = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export const ANIMATION_CONFIG = {
  durations: {
    fast: 150,
    normal: 250,
    elastic: 350,
    slow: 500,
    toast: 4000
  },
  easings: {
    spring: 'spring(1, 80, 10, 0)',
    elasticOut: 'easeOutElastic(1, .6)',
    smoothOut: 'easeOutQuart',
    smoothInOut: 'easeInOutCubic',
    backOut: 'easeOutBack(1.5)',
    sharp: 'cubicBezier(0.4, 0, 0.2, 1)'
  },
  hover: {
    scale: 1.05,
    liftY: -3,
    duration: 200,
    easing: 'easeOutQuad'
  },
  press: {
    scale: 0.95,
    pressY: 2,
    duration: 100,
    easing: 'easeOutQuad'
  },
  magneticStrength: 0.25
};

export default ANIMATION_CONFIG;
