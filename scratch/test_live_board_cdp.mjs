import fs from 'fs';

const WS_URL = 'ws://127.0.0.1:9222/devtools/page/2177AB091CA3967F8DF3E9DD51090BBD';

async function run() {
  const ws = new WebSocket(WS_URL);

  let idCounter = 1;
  const pending = new Map();
  const consoleMessages = [];

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.method === 'Runtime.consoleAPICalled') {
      const args = data.params.args.map(a => a.value ?? a.description ?? '');
      const text = args.join(' ');
      consoleMessages.push(text);
      if (text.includes('[MessCleanup')) {
        console.log('BROWSER CONSOLE:', text.substring(0, 150));
      }
    }
    if (data.id && pending.has(data.id)) {
      const { resolve } = pending.get(data.id);
      pending.delete(data.id);
      resolve(data.result);
    }
  };

  await new Promise(r => ws.onopen = r);
  console.log('1. Connected to Chrome via CDP');

  // Enable Console and Runtime
  await send('Console.enable');
  await send('Runtime.enable');
  await send('Page.enable');

  // 2. Reload page
  console.log('2. Reloading page...');
  await send('Page.reload');

  // Wait 4.5 seconds for page and canvas to load
  await new Promise(r => setTimeout(r, 4500));
  console.log('3. Waited 4.5s for board and canvas objects to load');

  // Check object count on canvas
  const canvasCheck = await send('Runtime.evaluate', {
    expression: 'window.canvas?.getObjects()?.length || (window.__messCleanupAudit?.workspaceModel?.board?.objects?.length) || document.querySelectorAll("canvas").length',
    returnByValue: true
  });
  console.log('Canvas/DOM check:', canvasCheck?.result?.value);

  // 4. Click Mess Cleanup button
  console.log('4. Clicking Mess Cleanup button...');
  const clickRes = await send('Runtime.evaluate', {
    expression: `(() => {
      // Find button by icon or aria-label or testid
      const btn = Array.from(document.querySelectorAll('button')).find(b => 
        b.querySelector('.lucide-sparkles') || 
        b.innerHTML.includes('auto_awesome') || 
        b.getAttribute('title')?.toLowerCase().includes('cleanup') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('cleanup') ||
        b.className.includes('cleanup')
      );
      if (btn) {
        btn.click();
        return 'Clicked button via querySelector: ' + (btn.getAttribute('title') || btn.innerText || btn.className);
      }
      return 'Button not found via querySelector';
    })()`,
    returnByValue: true
  });
  const clickMsgIndex = consoleMessages.length;
  console.log('Click result:', clickRes?.result?.value);

  // Wait up to 15 seconds for client request to complete and modal to open
  console.log('5. Waiting up to 15s for Mess Cleanup client request to complete...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const recent = consoleMessages.slice(clickMsgIndex);
    if (recent.some(m => m.includes('[MessCleanup Diagnostic] Client request completed') || m.includes('[MessCleanup FULL PRODUCTION AUDIT]'))) {
      console.log('Detected Client request completed in console!');
      break;
    }
  }
  await new Promise(r => setTimeout(r, 1500));

  // 6. Capture screenshot of open modal
  const ss = await send('Page.captureScreenshot', { format: 'png' });
  if (ss?.data) {
    const ssPath = 'C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/mess_cleanup_canonical_modal.png';
    fs.writeFileSync(ssPath, Buffer.from(ss.data, 'base64'));
    console.log('6. Saved screenshot to:', ssPath);
  }

  // 7. Evaluate window.__messCleanupDiagnostics
  let diagsJson = null;
  for (let i = 0; i < 10; i++) {
    const diagsEval = await send('Runtime.evaluate', {
      expression: 'window.__messCleanupDiagnostics ? JSON.stringify(window.__messCleanupDiagnostics, null, 2) : null',
      returnByValue: true
    });
    diagsJson = diagsEval?.result?.value;
    if (diagsJson) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('\n======================================================');
  console.log('7. LIVE window.__messCleanupDiagnostics:');
  console.log('======================================================');
  console.log(diagsJson);

  // Also write to scratch file for record
  fs.writeFileSync('C:/Users/singh/.gemini/antigravity-ide/brain/50fd7c5f-98be-4727-87e0-21e02f97850b/scratch/live_canonical_diagnostics.json', diagsJson || 'null');

  // Print forensic log matches
  console.log('\n======================================================');
  console.log('8. CAPTURED FORENSIC CONSOLE LOGS:');
  console.log('======================================================');
  const relevantLogs = consoleMessages.filter(m => m.includes('[MessCleanup'));
  relevantLogs.forEach(l => console.log('  >', l.substring(0, 200)));

  ws.close();
}

run().catch(console.error);
