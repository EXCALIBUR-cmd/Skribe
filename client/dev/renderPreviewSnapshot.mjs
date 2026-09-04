import { writeFileSync } from 'node:fs';

const W = 798, H = 498;
const SHAPE_FILL = '#bae6fd', SHAPE_STROKE = '#334155';
const NOTE_FILL = '#fef08a', NOTE_STROKE = '#eab308';
const TEXT_FILL = '#1e293b';

const rects = [
  { id: 'shape_b1', x: 24.8, y: 254.8, w: 150, h: 80, rx: 8, fill: SHAPE_FILL, stroke: SHAPE_STROKE },
  { id: 'shape_b2', x: 254.8, y: 254.8, w: 150, h: 80, rx: 8, fill: SHAPE_FILL, stroke: SHAPE_STROKE },
  { id: 'shape_plain', x: 177.8, y: 384.8, w: 160, h: 90, rx: 8, fill: SHAPE_FILL, stroke: SHAPE_STROKE },
  { id: 'shape_note', x: 594.8, y: 24.8, w: 180, h: 180, rx: 2, fill: NOTE_FILL, stroke: NOTE_STROKE },
];
const circle = { cx: 224.8 + 60, cy: 24.8 + 60, r: 60 };
const hexBox = { x: 24.8, y: 24.8, w: 140, h: 100 };
const hex = [[.25,0],[.75,0],[1,.5],[.75,1],[.25,1],[0,.5]]
  .map(([px,py]) => `${(hexBox.x+px*hexBox.w).toFixed(1)},${(hexBox.y+py*hexBox.h).toFixed(1)}`).join(' ');
const triBox = { x: 404.8, y: 24.8, w: 130, h: 110 };
const tri = [[.5,0],[1,1],[0,1]]
  .map(([px,py]) => `${(triBox.x+px*triBox.w).toFixed(1)},${(triBox.y+py*triBox.h).toFixed(1)}`).join(' ');

const texts = [
  { t: 'Process', x: 54.8, y: 60.8, w: 80, h: 28 },
  { t: 'Circle', x: 249.8, y: 70.8, w: 70, h: 28 },
  { t: 'Triangle', x: 429.8, y: 65.8, w: 80, h: 28 },
  { t: 'New Sticky Note', x: 614.8, y: 42.8, w: 140, h: 40 },
  { t: 'This is a testing phase', x: 39.8, y: 280.8, w: 120, h: 28 },
  { t: 'Test will be over', x: 269.8, y: 280.8, w: 120, h: 28 },
  { t: 'Contained note', x: 202.8, y: 415.8, w: 110, h: 28 },
  { t: 'Random floating note', x: 397.8, y: 384.8, w: 180, h: 28, standalone: true },
];

const svgLayer = `
  <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="#334155"/></marker></defs>
  <line x1="99" y1="294" x2="329" y2="294" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>
  <line x1="24" y1="404" x2="54" y2="404" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4"/>
  <line x1="62" y1="409" x2="86" y2="409" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4"/>
  <line x1="89" y1="406" x2="117" y2="406" stroke="#64748b" stroke-width="2" stroke-dasharray="5 4"/>`;

const label = (o) => {
  const cx = (o.x + o.w / 2).toFixed(1), cy = (o.y + o.h / 2 + 4).toFixed(1);
  const bg = o.standalone ? '' :
    `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="4" fill="#ffffff" opacity="0.35"/>`;
  return `${bg}<text x="${cx}" y="${cy}" font-family="Nunito Sans, sans-serif" font-size="13" font-weight="600" fill="${TEXT_FILL}" text-anchor="middle">${o.t}</text>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W+40}" height="${H+70}" viewBox="0 0 ${W+40} ${H+70}">
  <rect width="100%" height="100%" fill="#e2e8f0"/>
  <text x="20" y="30" font-family="Nunito Sans, sans-serif" font-size="16" font-weight="700" fill="#0f172a">Mess Cleanup — rendered preview (measured from real browser, after fix)</text>
  <g transform="translate(20,50)">
    <rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="#ffffff" stroke="#cbd5e1"/>
    ${rects.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.rx}" fill="${r.fill}" stroke="${r.stroke}" stroke-width="2"/>`).join('\n    ')}
    <ellipse cx="${circle.cx}" cy="${circle.cy}" rx="${circle.r}" ry="${circle.r}" fill="${SHAPE_FILL}" stroke="${SHAPE_STROKE}" stroke-width="2"/>
    <polygon points="${hex}" fill="${SHAPE_FILL}" stroke="${SHAPE_STROKE}" stroke-width="2"/>
    <polygon points="${tri}" fill="${SHAPE_FILL}" stroke="${SHAPE_STROKE}" stroke-width="2"/>
    ${svgLayer}
    ${texts.map(label).join('\n    ')}
  </g>
</svg>`;

writeFileSync(new URL('./messCleanupPreview.after.svg', import.meta.url), svg);
console.log('wrote dev/messCleanupPreview.after.svg');
