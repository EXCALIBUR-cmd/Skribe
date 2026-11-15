import { spawn } from 'node:child_process';

const files = process.argv.slice(2);
const requireDatabase = process.env.REQUIRE_TEST_DB === '1';

const child = spawn(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: ['inherit', 'pipe', 'pipe'] });

let output = '';
child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => { process.stderr.write(chunk); });

child.on('close', (code) => {
  const match = output.match(/^\S*\s*skipped (\d+)\s*$/m);
  const skipped = match ? Number(match[1]) : null;
  if (skipped === null) {
    console.error('\n[test] Could not read the skipped-test count from the test output.');
    process.exit(code || 1);
  }
  if (skipped > 0) {
    const target = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
    const banner = '='.repeat(72);
    console.error(`\n${banner}\nWARNING: ${skipped} server test(s) were SKIPPED, usually because MongoDB was not reachable at ${target}.\nThose tests did not run. Start MongoDB or set TEST_MONGODB_URI, then run npm test again.\n${banner}`);
    if (requireDatabase) {
      console.error('[test] REQUIRE_TEST_DB=1 is set, so skipped tests fail this run.');
      process.exit(code || 1);
    }
  }
  process.exit(code ?? 1);
});
