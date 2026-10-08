const inner = new Worker("/gate-worker-inner.js");
onmessage = (e) => inner.postMessage(e.data);
