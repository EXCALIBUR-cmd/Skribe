import fs from 'fs';

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

  // vector from center
  const dx = (p.x - center.x) * scaleX;
  const dy = (p.y - center.y) * scaleY;

  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos)
  };
}

const connectors = rawBoard.objects.filter((o) => o.isConnector || o.type === 'Path');

connectors.forEach((conn) => {
  const center = { x: conn.left, y: conn.top };
  const rawStart = { x: conn.path[0][1], y: conn.path[0][2] };
  const rawEnd = { x: conn.path[1][1], y: conn.path[1][2] };

  const rotatedStart = transformPoint(rawStart, center, conn.angle || 0, conn.scaleX || 1, conn.scaleY || 1);
  const rotatedEnd = transformPoint(rawEnd, center, conn.angle || 0, conn.scaleX || 1, conn.scaleY || 1);

  console.log(`\nConnector ${conn.id}:`);
  console.log(`  center: (${center.x.toFixed(1)}, ${center.y.toFixed(1)}) angle: ${(conn.angle || 0).toFixed(2)} deg, scale: ${conn.scaleX || 1}`);
  console.log(`  UNROTATED path start: (${rawStart.x.toFixed(1)}, ${rawStart.y.toFixed(1)}) -> end: (${rawEnd.x.toFixed(1)}, ${rawEnd.y.toFixed(1)})`);
  console.log(`  ROTATED world start:  (${rotatedStart.x.toFixed(1)}, ${rotatedStart.y.toFixed(1)}) -> end: (${rotatedEnd.x.toFixed(1)}, ${rotatedEnd.y.toFixed(1)})`);
});
