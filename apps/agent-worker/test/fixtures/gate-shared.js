onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = (message) => fetch("/gate-shared-post", { method: "POST", body: message.data });
};
