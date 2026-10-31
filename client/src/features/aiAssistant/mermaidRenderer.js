export const MERMAID_CONFIG = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  theme: 'default',
  suppressErrorRendering: true,
  fontFamily: 'Inter, Arial, sans-serif'
});

let mermaidPromise = null;
let renderCounter = 0;

const loadMermaid = () => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize(MERMAID_CONFIG);
      return mermaid;
    }).catch((err) => {
      mermaidPromise = null;
      throw err;
    });
  }
  return mermaidPromise;
};

export const nextRenderId = () => {
  renderCounter += 1;
  return `skribe-mermaid-${Date.now().toString(36)}-${renderCounter}`;
};

export const prepareSvgForImage = (svgText, DOMParserImpl = globalThis.DOMParser, XMLSerializerImpl = globalThis.XMLSerializer) => {
  const doc = new DOMParserImpl().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Mermaid produced an invalid SVG');
  }
  if (doc.getElementsByTagName('foreignObject').length || doc.getElementsByTagName('script').length) {
    throw new Error('This diagram uses content that cannot be placed on the canvas');
  }
  const [, , rawWidth, rawHeight] = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const width = Math.ceil(rawWidth);
  const height = Math.ceil(rawHeight);
  if (!(width > 0) || !(height > 0)) throw new Error('Mermaid produced a diagram without a size');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.removeAttribute('style');
  svg.setAttribute('style', 'background-color:#ffffff');
  const markup = new XMLSerializerImpl().serializeToString(svg);
  return { width, height, dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` };
};

export const renderMermaid = async (source) => {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(source);
  } catch (err) {
    throw new Error(`The diagram syntax is invalid: ${String(err?.message || err).split('\n')[0]}`);
  }
  const { svg } = await mermaid.render(nextRenderId(), source);
  return prepareSvgForImage(svg);
};
