const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/2177AB091CA3967F8DF3E9DD51090BBD');

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: 'JSON.stringify(window.__messCleanupDiagnostics, null, 2)',
      returnByValue: true
    }
  }));
};

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.id === 1) {
    console.log('LIVE WINDOW.__MESSCLEANUPDIAGNOSTICS IN BROWSER:');
    console.log(data.result?.result?.value);
    ws.close();
  }
};

ws.onerror = (err) => {
  console.error('WS Error:', err);
};
