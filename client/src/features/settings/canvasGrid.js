export const GRID_SIZE = 24;
const MIN_DOT_SPACING = 12;

const snapValue = (value) => Math.round(value / GRID_SIZE) * GRID_SIZE || 0;

export const snapPoint = ({ x, y }) => ({ x: snapValue(x), y: snapValue(y) });

export const getGridBackground = (viewportTransform) => {
  const [zoom, , , , x, y] = viewportTransform;
  let size = GRID_SIZE * zoom;
  while (size < MIN_DOT_SPACING) size *= 2;
  return {
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${x - size / 2}px ${y - size / 2}px`
  };
};
