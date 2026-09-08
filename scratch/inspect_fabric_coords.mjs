const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/2177AB091CA3967F8DF3E9DD51090BBD');

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `(() => {
        const c = window.canvas;
        if (!c) return 'No window.canvas found';
        const objs = c.getObjects();
        return objs.map(o => {
          const br = o.getBoundingRect ? o.getBoundingRect() : null;
          const coords = o.getCoords ? o.getCoords() : null;
          return {
            id: o.id || o.elementId,
            type: o.type,
            angle: o.angle,
            left: o.left,
            top: o.top,
            width: o.width,
            height: o.height,
            scaleX: o.scaleX,
            scaleY: o.scaleY,
            boundingRect: br,
            coords: coords,
            isConnector: o.isConnector,
            sourceShapeId: o.sourceShapeId,
            targetShapeId: o.targetShapeId
          };
        });
      })()`,
      returnByValue: true
    }
  }));
};

ws.onmessage = (msg) => {
  const data = JSON.parse(msg.data);
  if (data.id === 1) {
    console.log(JSON.stringify(data.result?.result?.value, null, 2));
    ws.close();
  }
};
