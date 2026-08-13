
export const parseColorToRgb = (colorStr) => {
  if (!colorStr || colorStr === 'transparent') return { r: 255, g: 255, b: 255 };

  if (typeof colorStr !== 'string') {
    return { r: 255, g: 255, b: 255 };
  }

  const trimmed = colorStr.trim();

  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    if (hex.length === 6) {
      const num = parseInt(hex, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
      };
    }
  }

  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = trimmed;
    const computed = ctx.fillStyle;

    if (computed.startsWith('#')) {
      let cHex = computed.slice(1);
      if (cHex.length === 3) cHex = cHex.split('').map((c) => c + c).join('');
      const num = parseInt(cHex, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
      };
    }

    const match = computed.match(/\d+/g);
    if (match && match.length >= 3) {
      return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
    }
  } catch (e) {

  }

  return { r: 255, g: 255, b: 255 };
};

export const rgbToHsl = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        break;
    }
    h /= 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

export const getRelativeLuminance = (colorStr) => {
  const { r, g, b } = parseColorToRgb(colorStr);
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

export const getContrastRatio = (bgColor, textColor) => {
  const l1 = getRelativeLuminance(bgColor);
  const l2 = getRelativeLuminance(textColor);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

export const isLowContrast = (bgColor, textColor) => {
  if (!bgColor || !textColor) return false;
  const ratio = getContrastRatio(bgColor, textColor);
  return ratio < 4.5;
};

export const READABILITY_PALETTE = [
  { hex: '#222222', category: 'dark', hueGroup: 'neutral' },
  { hex: '#151c25', category: 'dark', hueGroup: 'neutral' },
  { hex: '#3b2f2f', category: 'dark', hueGroup: 'yellow' },
  { hex: '#3a2a1a', category: 'dark', hueGroup: 'peach' },
  { hex: '#40263a', category: 'dark', hueGroup: 'pink' },
  { hex: '#2c2f5c', category: 'dark', hueGroup: 'lavender' },
  { hex: '#003835', category: 'dark', hueGroup: 'cyan' },
  { hex: '#064e3b', category: 'dark', hueGroup: 'green' },
  { hex: '#fafafa', category: 'light', hueGroup: 'neutral' },
  { hex: '#f5f5f5', category: 'light', hueGroup: 'neutral' },
  { hex: '#ffffff', category: 'light', hueGroup: 'neutral' }
];

const getHueGroup = (h, s, l) => {
  if (s < 12 || l > 92 || l < 12) return 'neutral';
  if (h >= 45 && h < 70) return 'yellow';
  if (h >= 15 && h < 45) return 'peach';
  if (h >= 310 || h < 15) return 'pink';
  if (h >= 240 && h < 310) return 'lavender';
  if (h >= 160 && h < 240) return 'cyan';
  if (h >= 70 && h < 160) return 'green';
  return 'neutral';
};

export const getBestReadableTextColor = (backgroundColor) => {
  if (!backgroundColor) return '#222222';

  const bgRgb = parseColorToRgb(backgroundColor);
  const { h, s, l } = rgbToHsl(bgRgb.r, bgRgb.g, bgRgb.b);
  const bgHueGroup = getHueGroup(h, s, l);
  const bgLuminance = getRelativeLuminance(backgroundColor);

  console.log('--------------------------------------------------');
  console.log('[Auto-Fix Pipeline Debug] 3. Candidate Evaluation');
  console.log('--------------------------------------------------');

  let bestColor = READABILITY_PALETTE[0].hex;
  let maxScore = -1;

  READABILITY_PALETTE.forEach((candidate) => {
    const ratio = getContrastRatio(backgroundColor, candidate.hex);

    let score = ratio * 10;
    if (candidate.hueGroup === bgHueGroup && bgHueGroup !== 'neutral') {
      score += 15;
    }
    if (ratio >= 7.0) {
      score += 10;
    }
    if (bgLuminance < 0.4 && candidate.category === 'light') {
      score += 8;
    }
    if (bgLuminance >= 0.4 && candidate.category === 'dark') {
      score += 8;
    }

    const wcagScore = ratio >= 7.0 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'Fail';
    const status = ratio >= 4.5 ? 'Accepted' : 'Rejected';

    console.log(`Candidate: ${candidate.hex}`);
    console.log(`Contrast Ratio: ${ratio.toFixed(2)}:1`);
    console.log(`WCAG Score: ${wcagScore}`);
    console.log(`Status: ${status}`);
    console.log(`Final Score: ${score.toFixed(1)}`);
    console.log('----------------------------------------------');

    if (score > maxScore) {
      maxScore = score;
      bestColor = candidate.hex;
    }
  });

  console.log('[Auto-Fix Pipeline Debug] 4. Chosen Color');
  console.log(`Chosen HEX: ${bestColor}`);
  console.log(`Reason chosen: Highest readability score (${maxScore.toFixed(1)})`);
  console.log('--------------------------------------------------');

  return bestColor;
};

export const getRecommendedTextColor = getBestReadableTextColor;

export default {
  parseColorToRgb,
  rgbToHsl,
  getRelativeLuminance,
  getContrastRatio,
  isLowContrast,
  getBestReadableTextColor,
  getRecommendedTextColor
};
