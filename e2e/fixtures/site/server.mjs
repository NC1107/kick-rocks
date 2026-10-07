import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

// A stand-in for a people-search site and for the opt-out pages of a few brokers, used by the
// end-to-end stack. It answers every host name the same way, so one process can play every
// fixture domain. Nothing here is a real site, and the people in it are made up.

const PORT = Number(process.env.FIXTURE_PORT ?? 8530);

const PEOPLE = [
  {
    slug: "jordan-example-austin",
    name: "Jordan Example",
    age: 34,
    locations: ["Austin, TX", "Dallas, TX"],
    relatives: ["Alex Example", "Sam Example"],
  },
  {
    slug: "jordan-example-portland",
    name: "Jordan Example",
    age: 61,
    locations: ["Portland, OR"],
    relatives: [],
  },
];

const state = freshState();

function freshState() {
  return {
    /** Every form post, so a test can see what the worker typed. */
    submissions: [],
    /** Confirmation tokens the people-search removal form handed out. */
    tokens: [],
    /** Records whose removal was confirmed through the emailed link. */
    removed: [],
    /** Tokens opened through either confirmation page. */
    confirmed: [],
    captchaSolved: false,
  };
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title, body, { script = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
${body}
${script}
</body>
</html>
`;
}

async function readForm(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function html(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

const SEARCH_FORM = `<h1>Find a person</h1>
<form method="get" action="/search">
  <label for="first">First name</label><input id="first" name="first" type="text">
  <label for="last">Last name</label><input id="last" name="last" type="text">
  <button type="submit">Search</button>
</form>`;

function searchResults(first, last) {
  const matches = PEOPLE.filter(
    (person) =>
      !state.removed.includes(person.slug) &&
      person.name.toLowerCase() === `${first} ${last}`.trim().toLowerCase(),
  );
  const items = matches
    .map(
      (person) => `<li class="result">
  <h3 class="name">${escapeHtml(person.name)}</h3>
  <a class="view" href="/people/${person.slug}">View record</a>
  <span class="age">Age ${person.age}</span>
  ${person.locations.map((place) => `<span class="loc">${escapeHtml(place)}</span>`).join("\n  ")}
  ${person.relatives.map((name) => `<span class="rel">${escapeHtml(name)}</span>`).join("\n  ")}
</li>`,
    )
    .join("\n");
  const list = matches.length > 0 ? `<ul id="results">${items}</ul>` : "<p>No records found.</p>";
  return page("Search results", `<h1>Results</h1>${list}`);
}

const SIMPLE_FORM = `<h1>Opt out</h1>
<form method="post" action="/optout/simple">
  <label for="name">Full name</label><input id="name" name="name" type="text">
  <label for="email">Email address</label><input id="email" name="email" type="email">
  <button type="submit">Opt out</button>
</form>`;

function captchaForm() {
  const widget = state.captchaSolved
    ? ""
    : `<div class="g-recaptcha" data-sitekey="fixture-key"><iframe title="reCAPTCHA" src="/captcha/widget/recaptcha/api2/anchor?k=fixture&amp;size=normal" width="304" height="78"></iframe></div>`;
  return `<h1>Opt out</h1>
<form method="post" action="/optout/captcha">
  <label for="name">Full name</label><input id="name" name="name" type="text">
  <label for="email">Email address</label><input id="email" name="email" type="email">
  ${widget}
  <button type="submit">Opt out</button>
</form>`;
}

const RECEIVED = page("Received", "<h1>Your opt-out request was received</h1>");

const CONFIRMED = page("Confirmed", "<h1>Your opt-out is confirmed</h1>");

/** Looks like a bare shell until its script runs, which is how a link that needs a browser looks. */
const CONFIRM_WITH_SCRIPT = (token) =>
  page("Confirm", `<div id="out"></div>`, {
    script: `<script>
fetch("/confirm-api?token=${encodeURIComponent(token)}", { method: "POST" }).then(function () {
  document.getElementById("out").innerHTML = "<h1>Your opt-out is confirmed</h1>";
});
</script>`,
  });

/** Tokens from the removal form are tracked to their record; a broker's emailed link may carry any token, and one that starts with "expired" is refused. */
function confirmToken(token) {
  if (!/^[a-z0-9-]{6,}$/.test(token) || token.startsWith("expired")) return false;
  if (!state.confirmed.includes(token)) state.confirmed.push(token);
  const entry = state.tokens.find((candidate) => candidate.token === token);
  if (entry && !state.removed.includes(entry.record)) state.removed.push(entry.record);
  return true;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.local");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/__admin/state") return json(response, 200, state);
  if (path === "/__admin/reset" && request.method === "POST") {
    Object.assign(state, freshState());
    return json(response, 200, { ok: true });
  }
  if (path === "/__admin/captcha/solve" && request.method === "POST") {
    state.captchaSolved = true;
    return json(response, 200, { ok: true });
  }

  if (request.method === "POST") {
    const fields = await readForm(request);
    if (path === "/confirm-api") {
      return json(response, confirmToken(url.searchParams.get("token") ?? "") ? 200 : 404, {});
    }
    state.submissions.push({ path, fields, host: request.headers.host ?? "" });
    if (path === "/optout/simple") return html(response, 200, RECEIVED);
    if (path === "/optout/captcha") {
      if (!state.captchaSolved)
        return html(response, 403, page("Blocked", "<h1>Access denied</h1>"));
      return html(response, 200, RECEIVED);
    }
    if (path === "/remove") {
      const record = fields.record ?? "";
      if (!PEOPLE.some((person) => person.slug === record))
        return html(response, 404, page("Not found", "<h1>Not found</h1>"));
      const token = randomBytes(8).toString("hex");
      state.tokens.push({
        token,
        record,
        email: fields.email ?? "",
        host: request.headers.host ?? "",
      });
      return html(
        response,
        200,
        page(
          "Check your email",
          `<h1>Check your email</h1><p>We sent a confirmation link to ${escapeHtml(fields.email ?? "")}.</p>`,
        ),
      );
    }
    return html(response, 404, page("Not found", "<h1>Not found</h1>"));
  }

  if (path === "/") return html(response, 200, page("People search", SEARCH_FORM));
  if (path === "/search") {
    return html(
      response,
      200,
      searchResults(url.searchParams.get("first") ?? "", url.searchParams.get("last") ?? ""),
    );
  }
  const record = path.match(/^\/people\/([a-z0-9-]+)$/);
  if (record) {
    const person = PEOPLE.find((candidate) => candidate.slug === record[1]);
    if (!person || state.removed.includes(person.slug)) {
      return html(response, 404, page("Not found", "<h1>Not found</h1>"));
    }
    return html(
      response,
      200,
      page(
        `${person.name}, ${person.locations[0]}`,
        `<h1>${escapeHtml(person.name)}</h1><p>Age ${person.age}</p><a href="/remove?record=${person.slug}">Remove this record</a>`,
      ),
    );
  }
  if (path === "/remove") {
    const slug = url.searchParams.get("record") ?? "";
    return html(
      response,
      200,
      page(
        "Remove a record",
        `<h1>Remove this record</h1>
<form method="post" action="/remove">
  <input type="hidden" name="record" value="${escapeHtml(slug)}">
  <label for="email">Email address</label><input id="email" name="email" type="email">
  <button type="submit">Send confirmation email</button>
</form>`,
      ),
    );
  }
  if (path === "/optout/simple") return html(response, 200, page("Opt out", SIMPLE_FORM));
  if (path === "/optout/captcha") return html(response, 200, page("Opt out", captchaForm()));
  if (path.startsWith("/captcha/widget/")) {
    return html(
      response,
      200,
      page("Widget", `<label><input type="checkbox"> I am not a robot</label>`),
    );
  }
  if (path === "/confirm") {
    return confirmToken(url.searchParams.get("token") ?? "")
      ? html(response, 200, CONFIRMED)
      : html(response, 410, page("Expired", "<h1>This link is no longer valid</h1>"));
  }
  if (path === "/confirm-js") {
    return html(response, 200, CONFIRM_WITH_SCRIPT(url.searchParams.get("token") ?? ""));
  }
  return html(response, 404, page("Not found", "<h1>Not found</h1>"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`fixture broker site listening on ${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}
