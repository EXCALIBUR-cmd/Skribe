import fs from 'fs';

const rawBoard = JSON.parse(
  fs.readFileSync(
    'C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/scratch/canonical_board.json',
    'utf8'
  )
);

const connectors = rawBoard.objects.filter(
  (o) => o.type === 'Path' || o.isConnector || (o.id && o.id.startsWith('conn_'))
);

connectors.forEach((conn, idx) => {
  console.log(`\n======================================================`);
  console.log(`CONNECTOR ${idx + 1}: ${conn.id}`);
  console.log(`======================================================`);
  console.log(JSON.stringify(conn, null, 2));
});
