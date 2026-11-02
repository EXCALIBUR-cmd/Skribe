export const LUCIDE_ICON_TYPE = 'lucide-icon';
export const ICON_DESIGN_SIZE = 24;
export const ICON_SIZE_LIMITS = Object.freeze({ min: 8, max: 1024 });

export const ICON_SIZES = Object.freeze([
  { id: 'small', size: 32 },
  { id: 'medium', size: 48 },
  { id: 'large', size: 72 },
  { id: 'extraLarge', size: 96 }
]);

export const ICON_STROKES = Object.freeze([
  { id: 'light', value: 1.5 },
  { id: 'regular', value: 2 },
  { id: 'bold', value: 3 }
]);

export const ICON_COLORS = Object.freeze([
  { id: 'default', value: '#1e293b' },
  { id: 'blue', value: '#2563eb' },
  { id: 'green', value: '#16a34a' },
  { id: 'red', value: '#dc2626' },
  { id: 'amber', value: '#d97706' },
  { id: 'purple', value: '#7c3aed' },
  { id: 'pink', value: '#db2777' }
]);

export const DEFAULT_ICON_STYLE = Object.freeze({ color: ICON_COLORS[0].value, size: 48, strokeWidth: 2 });

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ALLOWED_TAGS = new Set(['svg', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
const MAX_MARKUP_LENGTH = 20000;

export const isLucideIcon = (object) => object?.metadata?.assetType === LUCIDE_ICON_TYPE && typeof object.getObjects === 'function';

export const toIconSvgMarkup = (svg, color) => {
  const copy = svg.cloneNode(true);
  copy.setAttribute('width', String(ICON_DESIGN_SIZE));
  copy.setAttribute('height', String(ICON_DESIGN_SIZE));
  copy.setAttribute('stroke', color);
  copy.setAttribute('color', color);
  ['class', 'aria-hidden', 'style'].forEach((name) => copy.removeAttribute(name));
  return copy.outerHTML;
};

export const validateIconSvg = (markup) => {
  if (typeof markup !== 'string' || markup.length > MAX_MARKUP_LENGTH) return false;
  if (!/^<svg[\s>]/.test(markup) || !/<\/svg>\s*$/.test(markup)) return false;
  if (!/\sviewBox="0 0 24 24"/.test(markup)) return false;
  if (/\son[a-z]+\s*=|javascript:|href\s*=|<!|<\?/i.test(markup)) return false;
  const tags = [...markup.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)/g)].map((match) => match[1].toLowerCase());
  return tags.filter((tag) => tag !== 'svg').length > 0 && tags.every((tag) => ALLOWED_TAGS.has(tag));
};

const keepCenter = (group, change) => {
  const center = group.getCenterPoint();
  change();
  group.setPositionByOrigin(center, 'center', 'center');
  group.setCoords();
};

export const prepareIconObject = (object) => {
  if (!isLucideIcon(object)) return object;
  object.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
  return object;
};

export const createIconObject = async (fabric, markup, { icon, color, strokeWidth, size, left, top }) => {
  if (!validateIconSvg(markup)) throw new Error('The icon artwork is not valid.');
  const { objects = [] } = (await fabric.loadSVGFromString(markup)) || {};
  const parts = objects.filter(Boolean);
  if (parts.length === 0 || parts.length !== objects.length) throw new Error('The icon artwork could not be read.');
  const scale = size / ICON_DESIGN_SIZE;
  const group = new fabric.Group(parts);
  group.metadata = {
    assetType: LUCIDE_ICON_TYPE,
    iconId: icon.id,
    iconName: icon.name,
    category: icon.category,
    color,
    strokeWidth,
    designWidth: ICON_DESIGN_SIZE,
    designHeight: ICON_DESIGN_SIZE
  };
  group.set({ scaleX: scale, scaleY: scale });
  group.setPositionByOrigin(new fabric.Point(left, top), 'center', 'center');
  group.setCoords();
  return prepareIconObject(group);
};

const isPainted = (value) => typeof value === 'string' && value !== '' && value !== 'none' && value !== 'transparent';

export const applyIconStyle = (group, { color, strokeWidth }) => {
  if (!isLucideIcon(group)) return false;
  const nextColor = typeof color === 'string' && HEX_COLOR.test(color) ? color.toLowerCase() : null;
  const nextWidth = Number.isFinite(strokeWidth) && strokeWidth > 0 && strokeWidth <= 6 ? strokeWidth : null;
  if (!nextColor && !nextWidth) return false;
  keepCenter(group, () => {
    group.getObjects().forEach((part) => {
      if (nextColor && isPainted(part.stroke)) part.set('stroke', nextColor);
      if (nextColor && isPainted(part.fill)) part.set('fill', nextColor);
      if (nextWidth) part.set('strokeWidth', nextWidth);
    });
    group.metadata = { ...group.metadata, ...(nextColor ? { color: nextColor } : {}), ...(nextWidth ? { strokeWidth: nextWidth } : {}) };
    group.triggerLayout();
    group.set('dirty', true);
  });
  return true;
};

export const getIconSize = (group) => Math.round(ICON_DESIGN_SIZE * Math.abs(group.scaleX || 1));

export const setIconSize = (group, size) => {
  if (!isLucideIcon(group) || !Number.isFinite(size)) return false;
  const clamped = Math.min(ICON_SIZE_LIMITS.max, Math.max(ICON_SIZE_LIMITS.min, size));
  const scale = clamped / ICON_DESIGN_SIZE;
  keepCenter(group, () => group.set({ scaleX: Math.sign(group.scaleX || 1) * scale, scaleY: Math.sign(group.scaleY || 1) * scale }));
  return true;
};

export const getIconSelectionProps = (group) => ({
  isLucideIcon: true,
  iconName: group.metadata.iconName,
  iconColor: group.metadata.color,
  iconStrokeWidth: group.metadata.strokeWidth,
  iconSize: getIconSize(group)
});
