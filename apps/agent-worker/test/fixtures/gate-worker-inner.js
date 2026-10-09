onmessage = (e) => {
  fetch("/gate-inner-post", { method: "POST", body: e.data });
};
