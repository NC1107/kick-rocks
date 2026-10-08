onmessage = (e) => {
  fetch("/gate-worker-post", { method: "POST", body: e.data });
};
