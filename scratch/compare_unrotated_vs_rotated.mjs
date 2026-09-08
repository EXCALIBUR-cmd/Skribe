import fs from 'fs';
import { normalizeObject } from '../client/src/features/messCleanup/normalizeObjects.js';
import {
  getShapeBoundaryGeometry,
  getDistanceToShapeBoundary,
  checkDirectionCompatibility,
  MAX_ATTACH_DISTANCE
} from '../client/src/features/messCleanup/connectorTopology.js';
import { getSemanticType } from '../client/src/features/messCleanup/cleanupTypes.js';

const rawBoard = JSON.parse(
  fs.readFileSync(
    'C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/scratch/canonical_board.json',
    'utf8'
  )
);

function transformPoint(p, center, angleDeg, scaleX = 1, scaleY = 1) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (p.x - center.x) * scaleX;
  const dy = (p.y - center.y) * scaleY;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos)
  };
}

const rawObjects = rawBoard.objects;
const normalizedObjects = rawObjects.map(normalizeObject);
const shapes = normalizedObjects.filter((o) => ['shape', 'note'].includes(getSemanticType(o)));
const connectors = rawObjects.filter((o) => o.isConnector || o.type === 'Path');

console.log('================================================================================');
console.log('DISTANCE COMPARISON: UNROTATED PATH COORDS VS ROTATED WORLD COORDS');
console.log('================================================================================\n');

connectors.forEach((conn, idx) => {
  const center = { x: conn.left, y: conn.top };
  const rawStart = { x: conn.path[0][1], y: conn.path[0][2] };
  const rawEnd = { x: conn.path[1][1], y: conn.path[1][2] };

  const rotStart = transformPoint(rawStart, center, conn.angle || 0, conn.scaleX || 1, conn.scaleY || 1);
  const rotEnd = transformPoint(rawEnd, center, conn.angle || 0, conn.scaleX || 1, conn.scaleY || 1);

  const angleRad = ((conn.angle || 0) * Math.PI) / 180;
  const rotStartTan = {
    x: 140 * Math.cos(angleRad),
    y: 140 * Math.sin(angleRad)
  };
  const rotEndTan = { ...rotStartTan };

  console.log(`\nConnector ${idx + 1} (${conn.id}) [angle=${(conn.angle || 0).toFixed(1)}°]:`);

  console.log('\n  1. UNROTATED (Current pipeline):');
  ['source', 'target'].forEach((role) => {
    const pt = role === 'source' ? rawStart : rawEnd;
    const tan = { x: 140, y: 0 };
    shapes.forEach((s) => {
      const dist = getDistanceToShapeBoundary(pt, s);
      const dirOk = checkDirectionCompatibility(pt, tan, s, role);
      console.log(`    ${role.toUpperCase()} -> Shape ${s.id.slice(-5)}: dist=${dist.toFixed(1)}px, dirOk=${dirOk}`);
    });
  });

  console.log('\n  2. ROTATED WORLD (If angle/transform matrix is applied):');
  ['source', 'target'].forEach((role) => {
    const pt = role === 'source' ? rotStart : rotEnd;
    const tan = role === 'source' ? rotStartTan : rotEndTan;
    shapes.forEach((s) => {
      const dist = getDistanceToShapeBoundary(pt, s);
      const dirOk = checkDirectionCompatibility(pt, tan, s, role);
      console.log(`    ${role.toUpperCase()} -> Shape ${s.id.slice(-5)}: dist=${dist.toFixed(1)}px, dirOk=${dirOk}`);
    });
  });
});
