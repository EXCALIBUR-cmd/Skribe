import anime from 'animejs';

export const playStickyEntrance = (parts, canvas) => {
  const state = { scale: 0.9, opacity: 0 };
  const show = (scale, opacity) => {
    parts.forEach((part) => part.set({ scaleX: scale, scaleY: scale, opacity }));
    canvas.requestRenderAll();
  };
  parts.forEach((part) => {
    const serialize = part.toObject;
    part.toObject = (properties) => ({ ...serialize.call(part, properties), opacity: 1, scaleX: 1, scaleY: 1 });
  });
  show(state.scale, state.opacity);

  return anime({
    targets: state,
    scale: 1,
    opacity: 1,
    duration: 350,
    easing: 'easeOutBack',
    update: () => show(state.scale, state.opacity),
    complete: () => {
      show(1, 1);
      parts.forEach((part) => { delete part.toObject; });
    }
  });
};

export default playStickyEntrance;
