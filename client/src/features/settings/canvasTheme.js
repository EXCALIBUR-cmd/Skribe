const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB = /^rgba?\(([^)]+)\)$/i;
const NAMED = { black: '#000000', white: '#ffffff' };
const NEUTRAL_CHROMA = 0.18;
const MIN_CONTRAST = 3;
const TEXT_TYPES = new Set(['text', 'i-text', 'textbox']);
const SKIPPED_TYPES = new Set(['image']);
const ADAPTED_PROPERTIES = ['fill', 'stroke', 'backgroundColor'];
const adaptCache = new Map();

export const parseColor = (value) => {
  if (typeof value !== 'string') return null;
  const text = (NAMED[value.trim().toLowerCase()] || value).trim().toLowerCase();
  const hex = HEX.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join('');
    if (digits.length !== 6 && digits.length !== 8) return null;
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1
    };
  }
  const rgb = RGB.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map((part) => (part.endsWith('%') ? (parseFloat(part) / 100) : parseFloat(part)));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
  }
  return null;
};

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export const contrastRatio = (first, second) => {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

const toHsl = ({ r, g, b }) => {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h / 6, s, l };
};

const fromHsl = ({ h, s, l }) => {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue = (p, q, t) => {
    const k = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (k < 1 / 6) return p + (q - p) * 6 * k;
    if (k < 1 / 2) return q;
    if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: Math.round(hue(p, q, h + 1 / 3) * 255), g: Math.round(hue(p, q, h) * 255), b: Math.round(hue(p, q, h - 1 / 3) * 255) };
};

const format = ({ r, g, b }, a) => (a >= 1 ? `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : `rgba(${r}, ${g}, ${b}, ${a})`);

export const isNeutral = ({ r, g, b }) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255 < NEUTRAL_CHROMA;

export const isDarkSurface = (background) => {
  const parsed = parseColor(background);
  return Boolean(parsed) && relativeLuminance(parsed) < 0.2;
};

export const adaptColor = (value, backdrop) => {
  const key = `${value}|${backdrop}`;
  if (adaptCache.has(key)) return adaptCache.get(key);
  const color = parseColor(value);
  const surface = parseColor(backdrop);
  let result = value;
  if (color && surface && color.a > 0 && isNeutral(color) && contrastRatio(color, surface) < MIN_CONTRAST) {
    const hsl = toHsl(color);
    const flipped = fromHsl({ ...hsl, l: 1 - hsl.l });
    if (contrastRatio(flipped, surface) > contrastRatio(color, surface)) result = format(flipped, color.a);
  }
  if (adaptCache.size > 4000) adaptCache.clear();
  adaptCache.set(key, result);
  return result;
};

const isOpaque = (value) => {
  const parsed = parseColor(value);
  return Boolean(parsed) && parsed.a >= 0.6;
};

const findObject = (canvas, id) => {
  if (!id || !canvas) return null;
  if (!canvas.__skribeThemeIndex) canvas.__skribeThemeIndex = new Map(canvas.getObjects().map((object) => [object.id, object]));
  return canvas.__skribeThemeIndex.get(id) || null;
};

export const getRenderBackdrop = (object, canvas, background) => {
  if (!TEXT_TYPES.has(object.type)) return background;
  if (isOpaque(object.backgroundColor)) return adaptColor(object.backgroundColor, background);
  const container = findObject(canvas, object.parentShapeId);
  if (!container) return background;
  if (typeof container.fill === 'string') return isOpaque(container.fill) ? adaptColor(container.fill, background) : background;
  return parseColor(container.noteColor) ? container.noteColor : null;
};

const swapColors = (object, canvas, theme) => {
  const saved = [];
  const backdrop = getRenderBackdrop(object, canvas, theme.background);
  for (const property of ADAPTED_PROPERTIES) {
    const original = object[property];
    if (typeof original !== 'string') continue;
    if (backdrop === null && property !== 'backgroundColor') continue;
    const surface = property === 'backgroundColor' ? theme.background : backdrop;
    const adapted = property === 'fill' && !TEXT_TYPES.has(object.type) ? adaptColor(original, theme.background) : adaptColor(original, surface);
    if (adapted !== original) {
      saved.push([property, original]);
      object[property] = adapted;
    }
  }
  return saved;
};

export const installThemeRendering = (FabricObject) => {
  const proto = FabricObject.prototype;
  if (proto.__skribeThemeInstalled) return;
  const render = proto.render;
  proto.render = function renderWithTheme(ctx) {
    const canvas = this.canvas || this.group?.canvas;
    const theme = canvas?.skribeTheme;
    if (!theme || SKIPPED_TYPES.has(this.type)) return render.call(this, ctx);
    const saved = swapColors(this, canvas, theme);
    try {
      return render.call(this, ctx);
    } finally {
      for (const [property, original] of saved) this[property] = original;
    }
  };
  proto.__skribeThemeInstalled = true;
};

const markDirty = (objects) => {
  for (const object of objects) {
    object.dirty = true;
    if (typeof object.getObjects === 'function') markDirty(object.getObjects());
  }
};

export const applyCanvasTheme = (canvas, background) => {
  if (!canvas) return;
  const next = isDarkSurface(background) ? { background } : null;
  if ((canvas.skribeTheme?.background || null) === (next?.background || null)) return;
  canvas.skribeTheme = next;
  if (!canvas.__skribeThemeIndexReset) {
    canvas.on('before:render', () => {
      canvas.__skribeThemeIndex = null;
    });
    canvas.__skribeThemeIndexReset = true;
  }
  canvas.__skribeThemeIndex = null;
  markDirty(canvas.getObjects());
  canvas.requestRenderAll();
};
