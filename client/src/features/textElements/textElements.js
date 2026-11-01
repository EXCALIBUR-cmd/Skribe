export const CODE_FONT_FAMILY = 'Consolas, "Cascadia Mono", Menlo, "Courier New", monospace';
export const CODE_INDENT = '  ';

export const TEXT_ELEMENT_KINDS = Object.freeze({
  heading: Object.freeze({
    label: 'Heading',
    className: 'Textbox',
    text: 'Section heading',
    style: { width: 420, fontSize: 40, fontWeight: '700', lineHeight: 1.12, fontFamily: 'Nunito Sans', fill: '#0f172a', textAlign: 'left' }
  }),
  body: Object.freeze({
    label: 'Body Text',
    className: 'Textbox',
    text: 'Write a paragraph here. Text wraps to the box width and keeps your line breaks.',
    style: { width: 360, fontSize: 18, fontWeight: '400', lineHeight: 1.5, fontFamily: 'Nunito Sans', fill: '#334155', textAlign: 'left' }
  }),
  code: Object.freeze({
    label: 'Code Block',
    className: 'IText',
    text: 'function greet(name) {\n  return "Hello, " + name;\n}',
    radius: 10,
    style: { fontSize: 14, fontWeight: '400', lineHeight: 1.4, fontFamily: CODE_FONT_FAMILY, fill: '#1e293b', textAlign: 'left', backgroundColor: '#f1f5f9', padding: 14 }
  }),
  label: Object.freeze({
    label: 'Small Label',
    className: 'IText',
    text: 'LABEL',
    radius: 6,
    style: { fontSize: 12, fontWeight: '700', lineHeight: 1.1, charSpacing: 120, fontFamily: 'Nunito Sans', fill: '#334155', textAlign: 'center', backgroundColor: '#e2e8f0', padding: 6 }
  })
});

export const getTextKind = (object) => {
  const kind = object?.metadata?.textKind;
  return typeof kind === 'string' && Object.hasOwn(TEXT_ELEMENT_KINDS, kind) ? kind : null;
};

const containerRadius = (object) => TEXT_ELEMENT_KINDS[getTextKind(object)]?.radius;

export const createTextElement = (fabric, kind, { left = 0, top = 0, fill = null } = {}) => {
  const preset = TEXT_ELEMENT_KINDS[kind];
  if (!preset) return null;
  const TextClass = fabric[preset.className];
  const useFill = fill && preset.radius === undefined ? { fill } : {};
  return new TextClass(preset.text, {
    ...preset.style,
    ...useFill,
    left,
    top,
    contrastResolved: false,
    metadata: { textKind: kind }
  });
};

export const installTextElementRendering = ({ FabricText, IText }) => {
  const proto = FabricText.prototype;
  if (proto.__skribeTextElementsInstalled) return;
  const renderBackground = proto._renderBackground;
  const shouldCache = proto.shouldCache;
  const onKeyDown = IText.prototype.onKeyDown;

  proto._renderBackground = function renderTextElementBackground(ctx) {
    const radius = containerRadius(this);
    if (radius === undefined || !this.backgroundColor) return renderBackground.call(this, ctx);
    const pad = this.padding || 0;
    const width = this.width + pad * 2;
    const height = this.height + pad * 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-width / 2, -height / 2, width, height, radius);
    ctx.fillStyle = this.backgroundColor;
    ctx.fill();
    if (typeof this.fill === 'string') {
      ctx.globalAlpha *= 0.22;
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.fill;
      ctx.stroke();
    }
    ctx.restore();
    this._removeShadow(ctx);
  };

  proto.shouldCache = function shouldCacheTextElement() {
    if (containerRadius(this) !== undefined) {
      this.ownCaching = false;
      return false;
    }
    return shouldCache.call(this);
  };

  IText.prototype.onKeyDown = function onTextElementKeyDown(event) {
    const area = this.hiddenTextarea;
    if (this.isEditing && area && event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && getTextKind(this) === 'code') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) return;
      area.setRangeText(CODE_INDENT, area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    return onKeyDown.call(this, event);
  };

  proto.__skribeTextElementsInstalled = true;
};
