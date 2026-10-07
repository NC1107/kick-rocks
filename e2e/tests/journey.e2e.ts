import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROUTES, type RequestListItem } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { Api } from "../src/api.js";
import { inspectScreens, launchBrowser, statusPillOffsets } from "../src/browser.js";
import { inServerContainer } from "../src/docker.js";
import { fixtureState, resetFixture, solveFixtureCaptcha } from "../src/fixture-site.js";
import { bounceMessage, deliver, readInbox, type SeenMail } from "../src/mail.js";
import { callTool, connectMcp } from "../src/mcp.js";
import { STACK } from "../src/stack.js";
import { eventually } from "../src/wait.js";
import {
  IDENTITIES,
  MAILBOX_ADDRESS,
  PASSWORD,
  pollNow,
  requestFor,
  waitForStatus,
  world,
} from "../src/world.js";

const { api } = world;

const FIXTURE_TARGETS = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "targets.json"),
    "utf8",
  ),
) as {
  brokers: { id: string; privacyEmail: string | null }[];
  companies: { id: string; privacyEmail: string | null }[];
};

const brokerAddress = (targetId: string): string => {
  const email = [...FIXTURE_TARGETS.brokers, ...FIXTURE_TARGETS.companies].find(
    (target) => target.id === targetId,
  )?.privacyEmail;
  if (!email) throw new Error(`${targetId} has no privacy address`);
  return email;
};

/** The mail a fixture broker received, which GreenMail kept for its address. */
async function receivedBy(address: string, count = 1): Promise<SeenMail[]> {
  return eventually(
    async () => {
      const mail = await readInbox(address);
      return mail.length >= count ? mail : undefined;
    },
    { what: `${count} message(s) in the inbox of ${address}`, timeoutMs: 30_000 },
  );
}

/** A reply as the broker's mail server would send it, tied to our request by its headers. */
async function replyFrom(targetId: string, text: string): Promise<void> {
  const address = brokerAddress(targetId);
  const [original] = await receivedBy(address);
  if (!original) throw new Error(`${targetId} never got our mail`);
  await deliver({
    from: address,
    to: MAILBOX_ADDRESS,
    subject: `Re: ${original.subject}`,
    text,
    inReplyTo: original.messageId ?? undefined,
  });
}

const eventTypes = async (request: RequestListItem): Promise<string[]> =>
  (await api.call(API_ROUTES.requestsGet, { params: { id: request.id } })).events.map(
    (event) => event.type,
  );

/** Targets of `e2e/fixtures/targets.json` that send email and are answered by a scripted broker. */
const EMAIL_FIXTURES = [
  "fx-complete",
  "fx-ack",
  "fx-norecord",
  "fx-reject",
  "fx-verify",
  "fx-link",
  "fx-linkjs",
  "fx-bounce",
  "fx-needsform",
  "fx-unrelated",
];

describe("the stack", () => {
  it("serves the web app and the API from one origin with the security headers", async () => {
    await resetFixture();
    const health = await fetch(`${STACK.serverUrl}/api/health`);
    expect(await health.json()).toMatchObject({ ok: true });

    const home = await fetch(`${STACK.serverUrl}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('<div id="root">');
    expect(home.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(home.headers.get("x-frame-options")).toBe("DENY");

    const deepLink = await fetch(`${STACK.serverUrl}/requests/anything`);
    expect(deepLink.headers.get("content-type")).toContain("text/html");
  });

  it("cannot reach the internet or any real mail server", async () => {
    const attempt = (host: string, port: number) =>
      inServerContainer(
        `const s=require("net").connect({host:"${host}",port:${port}});` +
          `s.on("connect",()=>{console.log("connected");process.exit(0)});` +
          `s.on("error",(e)=>{console.log("blocked "+e.code);process.exit(0)});` +
          `setTimeout(()=>{console.log("blocked timeout");process.exit(0)},5000)`,
      );
    expect(await attempt("smtp.gmail.com", 587)).toMatch(/^blocked/);
    expect(await attempt("1.1.1.1", 25)).toMatch(/^blocked/);
  });
});

describe("first run", () => {
  it("asks for a password, and refuses everything else until there is a session", async () => {
    expect(await api.call(API_ROUTES.authState)).toEqual({
      setupRequired: true,
      authenticated: false,
    });
    const anonymous = await api.try(API_ROUTES.profilesList);
    expect(anonymous.ok).toBe(false);
    expect(anonymous.status).toBe(401);

    const withoutHeader = await fetch(`${STACK.serverUrl}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(withoutHeader.status).toBe(403);

    const weak = await api.try(API_ROUTES.authSetup, { body: { password: "short" } });
    expect(weak.status).toBe(400);
  });

  it("sets the password, signs in, and signs in again after signing out", async () => {
    await api.call(API_ROUTES.authSetup, { body: { password: PASSWORD } });
    expect(await api.call(API_ROUTES.authState)).toEqual({
      setupRequired: false,
      authenticated: true,
    });
    expect((await api.try(API_ROUTES.authSetup, { body: { password: PASSWORD } })).ok).toBe(false);

    await api.call(API_ROUTES.authLogout);
    expect((await api.try(API_ROUTES.profilesList)).status).toBe(401);

    const stranger = new Api();
    expect(
      (await stranger.try(API_ROUTES.authLogin, { body: { password: "wrong password!" } })).status,
    ).toBe(401);
    await api.call(API_ROUTES.authLogin, { body: { password: PASSWORD } });
    expect((await api.call(API_ROUTES.profilesList)).profiles).toEqual([]);
  });
});

describe("profile and mailbox", () => {
  it("creates a profile with every kind of identity", async () => {
    const created = await api.call(API_ROUTES.profilesCreate, {
      body: { displayName: "Jordan Example", state: "TX", identities: [...IDENTITIES] },
    });
    world.profileId = created.id;
    expect(created.identities).toHaveLength(IDENTITIES.length);
    expect(created.mailbox).toBeNull();
  });

  it("rejects an identity the schema forbids", async () => {
    const bad = await api.try(API_ROUTES.profilesReplaceIdentities, {
      params: { id: world.profileId },
      body: {
        identities: [...IDENTITIES.filter((identity) => identity.kind !== "email")],
      },
    });
    expect(bad.status).toBe(400);
  });

  const connection = {
    provider: "other",
    address: MAILBOX_ADDRESS,
    username: MAILBOX_ADDRESS,
    password: "an-app-password",
    smtpHost: STACK.insideStack.mailHost,
    smtpPort: STACK.insideStack.smtpPort,
    smtpSecure: false,
    imapHost: STACK.insideStack.mailHost,
    imapPort: STACK.insideStack.imapPort,
  };

  it("lists the provider presets, including the unsupported one with its reason", async () => {
    const { providers } = await api.call(API_ROUTES.mailProviders);
    expect(providers.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(["gmail", "fastmail", "icloud", "other"]),
    );
    expect(providers.filter((preset) => !preset.supported).every((p) => p.unsupportedReason)).toBe(
      true,
    );
  });

  it("explains a mailbox that cannot be reached without echoing the password", async () => {
    const result = await api.call(API_ROUTES.mailboxTest, {
      params: { id: world.profileId },
      body: { ...connection, smtpHost: "smtp.example.invalid", imapHost: "imap.example.invalid" },
    });
    expect(result.smtp.ok).toBe(false);
    expect(result.imap.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(connection.password);
  });

  it("tests and saves the GreenMail mailbox", async () => {
    const result = await api.call(API_ROUTES.mailboxTest, {
      params: { id: world.profileId },
      body: connection,
    });
    expect(result.smtp).toEqual({ ok: true, error: null });
    expect(result.imap.ok).toBe(true);

    const saved = await api.call(API_ROUTES.mailboxSave, {
      params: { id: world.profileId },
      body: { ...connection, replyFolder: "INBOX", dailyCap: 200 },
    });
    expect(saved).toMatchObject({ address: MAILBOX_ADDRESS, dailyCap: 200 });
    expect(JSON.stringify(saved)).not.toContain(connection.password);

    const folders = await api.call(API_ROUTES.mailboxFolders, { params: { id: world.profileId } });
    expect(folders.folders.map((folder) => folder.path)).toContain("INBOX");
  });
});

describe("targets", () => {
  it("lists the fixture targets beside the bundled datasets, with the recipes they have", async () => {
    const fixtures = await api.call(API_ROUTES.targetsList, {
      query: { q: "Fixture", pageSize: 100 },
    });
    expect(fixtures.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        ...EMAIL_FIXTURES,
        "fx-captcha",
        "fx-agent",
        "fx-people",
        "fx-company",
      ]),
    );
    const all = await api.call(API_ROUTES.targetsList, { query: { pageSize: 1 } });
    expect(all.total).toBeGreaterThan(800);

    const people = await api.call(API_ROUTES.targetsGet, { params: { id: "fx-people" } });
    expect(people.needsRecord).toBe(true);
    expect(people.recipes.map((recipe) => `${recipe.purpose}:${recipe.status}`).sort()).toEqual([
      "remove:active",
      "scan:active",
    ]);
    const agent = await api.call(API_ROUTES.targetsGet, { params: { id: "fx-agent" } });
    expect(agent.recipes).toEqual([]);

    const facets = await api.call(API_ROUTES.targetsFacets);
    expect(facets.category.length).toBeGreaterThan(3);
  });

  it("drops the fixture recipes into the recipe list as bundled-style active recipes", async () => {
    const { recipes } = await api.call(API_ROUTES.recipesList, { query: { status: "active" } });
    expect(recipes.map((recipe) => recipe.id)).toEqual(
      expect.arrayContaining(["fx-people.scan.v1", "fx-people.remove.v1", "fx-captcha.remove.v1"]),
    );
  });
});

describe("one-click campaign", () => {
  const fixtureIds = [...EMAIL_FIXTURES, "fx-company", "fx-captcha", "fx-agent", "fx-people"];

  it("previews what a preset would do before anything is sent", async () => {
    for (const preset of ["companies", "email_brokers", "people_search"] as const) {
      const preview = await api.call(API_ROUTES.campaignsPreview, {
        params: { id: world.profileId },
        body: { selection: { preset }, rights: ["opt_out", "delete"] },
      });
      expect(preview.items.length).toBeGreaterThan(0);
      expect(
        preview.counts.skipped + preview.counts.request_created + preview.counts.scan_started,
      ).toBe(preview.items.length);
      if (preset === "email_brokers") {
        const first = preview.items.find((item) => item.outcome === "request_created");
        if (!first) throw new Error("the email_brokers preset created nothing");
        const detail = await api.call(API_ROUTES.targetsGet, { params: { id: first.targetId } });
        if (!detail.privacyEmail) throw new Error("a real broker without an address");
        world.realBroker = { targetId: detail.id, email: detail.privacyEmail };
      }
    }
    expect((await readInbox(world.realBroker.email)).length).toBe(0);
  });

  it("previews the email, which discloses name and email and nothing more", async () => {
    const preview = await api.call(API_ROUTES.campaignsPreview, {
      params: { id: world.profileId },
      body: { selection: { targetIds: ["fx-complete"] }, rights: ["opt_out", "delete"] },
    });
    expect(preview.counts).toMatchObject({ request_created: 1 });
    const email = preview.sampleEmail;
    expect(email?.text).toContain("Jordan Example");
    for (const withheld of ["1990-04-12", "100 Example Street", "78701", "+15125550142"]) {
      expect(email?.text).not.toContain(withheld);
    }
  });

  it("creates every request and starts the scan, in one call", async () => {
    const created = await api.call(API_ROUTES.campaignsCreate, {
      params: { id: world.profileId },
      body: {
        selection: { targetIds: [...fixtureIds, world.realBroker.targetId] },
        rights: ["opt_out", "delete"],
      },
    });
    expect(created.counts).toEqual({
      request_created: fixtureIds.length - 1 + 1,
      scan_started: 1,
      skipped: 0,
    });
    for (const item of created.items) {
      if (item.requestId) world.requestIds.set(item.targetId, item.requestId);
    }
    expect(created.items.find((item) => item.targetId === "fx-people")?.outcome).toBe(
      "scan_started",
    );

    const again = await api.call(API_ROUTES.campaignsCreate, {
      params: { id: world.profileId },
      body: { selection: { targetIds: ["fx-complete", "fx-people"] }, rights: ["opt_out"] },
    });
    expect(again.items.map((item) => item.reason).sort()).toEqual([
      "already_active",
      "scan_in_progress",
    ]);
  });

  it("sends each email from the mailbox, paced by the server, and keeps it inside GreenMail", async () => {
    const emailTargets = [...EMAIL_FIXTURES, "fx-company"];
    for (const targetId of emailTargets) {
      await waitForStatus(targetId, ["awaiting_reply"], 90_000);
    }
    await waitForStatus(world.realBroker.targetId, ["awaiting_reply"], 90_000);

    const request = await requestFor("fx-complete");
    const [mail] = await receivedBy(brokerAddress("fx-complete"));
    expect(mail?.from).toBe(MAILBOX_ADDRESS);
    expect(mail?.subject).toContain(request.reference);
    expect(mail?.text).toContain("Jordan Example");
    expect(mail?.messageId).toMatch(/^<.+@.+>$/);
    for (const withheld of ["1990-04-12", "100 Example Street", "78701"]) {
      expect(mail?.text).not.toContain(withheld);
    }

    const realCopies = await receivedBy(world.realBroker.email);
    expect(realCopies).toHaveLength(1);

    const dashboard = await api.call(API_ROUTES.dashboardGet, { params: { id: world.profileId } });
    expect(dashboard.sending?.sent).toBe(emailTargets.length + 1);
  });
});

describe("work the browser worker does after the campaign", () => {
  it("scans the fixture people-search site and lists what it found as matches to confirm", async () => {
    const matches = await eventually(
      async () => {
        const queue = await api.call(API_ROUTES.reviewQueue, {
          query: { profileId: world.profileId },
        });
        const found = queue.matches.filter((match) => match.targetId === "fx-people");
        return found.length >= 2 ? found : undefined;
      },
      { what: "the scan to produce matches", timeoutMs: 60_000 },
    );
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => match.recordUrl).sort()).toEqual([
      "http://fixture-people.test:8530/people/jordan-example-austin",
      "http://fixture-people.test:8530/people/jordan-example-portland",
    ]);
    const austin = matches.find((match) => match.recordUrl.endsWith("austin"));
    expect(austin?.fields).toMatchObject({ name: "Jordan Example", age: 34 });
    expect(austin?.fields.locations).toContain("Austin, TX");
  });

  it("parks the CAPTCHA fixture for a person instead of getting past it", async () => {
    const blocked = await eventually(
      async () => {
        const queue = await api.call(API_ROUTES.reviewQueue, {
          query: { profileId: world.profileId },
        });
        return queue.blockedTasks.find((item) => item.task.targetId === "fx-captcha");
      },
      { what: "the CAPTCHA task to be blocked", timeoutMs: 60_000 },
    );
    expect(blocked.task).toMatchObject({
      kind: "form",
      status: "blocked",
      blockedReason: "captcha",
    });
    expect(blocked.url).toBe("http://fixture-captcha.test:8530/optout/captcha");
    expect(blocked.manualInstructions.length).toBeGreaterThan(10);
    expect(blocked.requestReference).toBe((await requestFor("fx-captcha")).reference);

    const screenshot = await api.call(API_ROUTES.taskScreenshot, {
      params: { id: blocked.task.id },
    });
    expect((screenshot as unknown as Buffer).subarray(1, 4).toString("ascii")).toBe("PNG");

    const dashboard = await api.call(API_ROUTES.dashboardGet, { params: { id: world.profileId } });
    expect(dashboard.attention.blockedTasks).toBe(1);
    const everyone = await api.call(API_ROUTES.reviewQueue);
    expect(everyone.blockedTasks.map((item) => item.task.kind)).toEqual(["form"]);
    expect(
      (await fixtureState()).submissions.filter((entry) => entry.path === "/optout/captcha"),
    ).toEqual([]);
  });

  it("leaves a form target with no recipe to an agent, which the built-in worker does not take", async () => {
    const request = await requestFor("fx-agent");
    expect(request.status).toBe("queued");
    const detail = await api.call(API_ROUTES.requestsGet, { params: { id: request.id } });
    const agentTask = detail.tasks.find((task) => task.kind === "agent");
    expect(agentTask).toMatchObject({ status: "queued", claimerKind: null });
  });
});

describe("broker replies", () => {
  it("injects a reply of every class and applies each one on the next poll", async () => {
    await api.call(API_ROUTES.settingsPatch, { body: { schedule: { pollMinutes: 1 } } });

    await replyFrom(
      "fx-complete",
      "Your request has been completed. We have removed your personal information from our records.",
    );
    await replyFrom(
      "fx-ack",
      "Thank you for contacting us. We have received your request and will respond within 10 business days. Ticket number 4412.",
    );
    await replyFrom(
      "fx-norecord",
      "We could not find any record matching your information, so there is nothing to remove.",
    );
    await replyFrom(
      "fx-reject",
      "We are unable to process your request because we are not required to honor it.",
    );
    await replyFrom(
      "fx-verify",
      "To process your request we need additional information. Please provide your full name, date of birth and zip code so we can verify your identity.",
    );
    await replyFrom(
      "fx-link",
      "Please confirm your opt-out request by clicking this link: http://fixture-link.test:8530/confirm?token=linktoken001\nIf you did not make this request, ignore this email.",
    );
    await replyFrom(
      "fx-linkjs",
      "Please confirm your opt-out request by clicking this link: http://fixture-linkjs.test:8530/confirm-js?token=scripttoken01\nIf you did not make this request, ignore this email.",
    );
    await replyFrom(
      "fx-needsform",
      "We do not accept opt-out requests by email. Please use our online form at http://fixture-needsform.test:8530/optout/simple to submit your request.",
    );
    await replyFrom(
      "fx-unrelated",
      "Our spring newsletter is out. Enjoy 20 percent off sprockets while stocks last.",
    );

    const [original] = await receivedBy(brokerAddress("fx-bounce"));
    if (!original) throw new Error("fx-bounce never got our mail");
    await deliver({
      from: "mailer-daemon@broker.test",
      to: MAILBOX_ADDRESS,
      subject: "",
      text: "",
      raw: bounceMessage(MAILBOX_ADDRESS, brokerAddress("fx-bounce"), original),
    });

    await pollNow();

    await waitForStatus("fx-complete", ["confirmed"]);
    await waitForStatus("fx-norecord", ["no_record"]);
    await waitForStatus("fx-reject", ["rejected"]);
    await waitForStatus("fx-verify", ["needs_verification"]);

    const ack = await requestFor("fx-ack");
    expect(ack.status).toBe("awaiting_reply");
    expect(await eventTypes(ack)).toContain("classified");
  });

  it("follows a confirmation link on the broker's own site", async () => {
    const request = await requestFor("fx-link");
    expect(request.status).toBe("awaiting_reply");
    await eventually(async () => (await eventTypes(request)).includes("link_followed"), {
      what: "the link to be followed",
    });
    expect((await fixtureState()).confirmed).toContain("linktoken001");
  });

  it("hands a link that needs a browser to the worker", async () => {
    const request = await requestFor("fx-linkjs");
    await eventually(async () => (await fixtureState()).confirmed.includes("scripttoken01"), {
      what: "the worker to open the confirmation page",
    });
    await eventually(async () => (await eventTypes(request)).includes("link_followed"), {
      what: "the confirmation to be recorded",
    });
  });

  it("switches to the broker's form after a bounce, and the worker submits it", async () => {
    const request = await waitForStatus("fx-bounce", ["awaiting_reply"], 90_000);
    expect(request.channel).toBe("form");
    expect(await eventTypes(request)).toEqual(
      expect.arrayContaining(["channel_switched", "task_completed"]),
    );
    const submission = (await fixtureState()).submissions.find((entry) =>
      entry.host.startsWith("fixture-bounce.test"),
    );
    expect(submission?.fields).toEqual({ name: "Jordan Example", email: MAILBOX_ADDRESS });
  });

  it("switches to the form a broker points to, and the worker submits it", async () => {
    const request = await waitForStatus("fx-needsform", ["awaiting_reply"], 90_000);
    expect(request.channel).toBe("form");
    const submission = (await fixtureState()).submissions.find((entry) =>
      entry.host.startsWith("fixture-needsform.test"),
    );
    expect(submission?.fields).toEqual({ name: "Jordan Example", email: MAILBOX_ADDRESS });
  });

  it("keeps mail it cannot read for a person, who classifies it by hand", async () => {
    const queue = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    const message = queue.messages.find((item) => item.targetName === "Fixture Unrelated Data");
    if (!message) throw new Error("the newsletter is not in the review queue");
    const detail = await api.call(API_ROUTES.messageGet, { params: { id: message.id } });
    expect(detail.text).toContain("sprockets");

    await api.call(API_ROUTES.messageClassify, {
      params: { id: message.id },
      body: { classification: "completed" },
    });
    await waitForStatus("fx-unrelated", ["confirmed"]);
    const after = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    expect(after.messages.find((item) => item.id === message.id)).toBeUndefined();
  });
});

describe("the screens a person sees, with a review queue that has things in it", () => {
  it("fit the window, load without errors, and agree with the queue in every size and theme", async () => {
    const [request] = world.requestIds.values();
    const routes = [
      "/",
      "/targets",
      "/targets/fx-people",
      "/requests",
      `/requests/${request}`,
      ...["blocked", "matches", "verifications", "mail", "failed", "scans"].map(
        (tab) => `/review?tab=${tab}`,
      ),
      "/profiles",
      `/profiles/${world.profileId}`,
      `/profiles/${world.profileId}/mailbox`,
      "/campaigns/new",
      "/settings",
      "/settings/agents",
      "/about",
      "/no-such-page",
    ];
    const browser = await launchBrowser();
    try {
      const reports = await inspectScreens(browser, routes, PASSWORD);
      const wrong = reports.flatMap((report) => [
        ...(report.overflow > 0
          ? [`${report.route} scrolls sideways by ${report.overflow}px at ${report.viewport}`]
          : []),
        ...report.problems
          .filter((problem) => !(report.route === "/no-such-page" && problem.includes("404")))
          .map((problem) => `${report.route} (${report.viewport}, ${report.scheme}): ${problem}`),
      ]);
      expect(wrong).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it("counts everything waiting on a person in the Review badge, and lines the status pills up", async () => {
    const queue = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    const waiting =
      queue.blockedTasks.length +
      queue.matches.filter((match) => match.decision === "pending").length +
      queue.verifications.length +
      queue.failedTasks.length +
      queue.agentTasks.length +
      queue.messages.length;
    expect(waiting).toBeGreaterThan(0);

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${STACK.serverUrl}/login`);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("link", { name: /^Review/ }).waitFor();
      await expect
        .poll(() => page.getByRole("link", { name: /^Review/ }).innerText())
        .toContain(String(waiting));

      await page.goto(`${STACK.serverUrl}/requests`);
      await page.getByRole("region", { name: "Requests" }).waitFor();
      for (const offset of await statusPillOffsets(page)) expect(offset).toBeLessThan(2);
    } finally {
      await browser.close();
    }
  });
});

describe("a broker that asks for more", () => {
  it("lists what it asked for, and sends only the fields the person approves", async () => {
    const queue = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    const item = queue.verifications.find((entry) => entry.request.target.id === "fx-verify");
    if (!item) throw new Error("fx-verify is not waiting for verification");
    expect(item.requestedFields).toEqual(expect.arrayContaining(["date_of_birth", "zip"]));

    await api.call(API_ROUTES.requestsVerification, {
      params: { id: item.request.id },
      body: { messageId: item.message.id, fields: ["zip"] },
    });
    await waitForStatus("fx-verify", ["awaiting_reply"]);

    const received = await receivedBy(brokerAddress("fx-verify"), 2);
    const followUp = received.at(-1);
    expect(followUp?.text).toContain("78701");
    expect(followUp?.text).not.toContain("1990-04-12");
    expect(followUp?.inReplyTo).toBeTruthy();
  });

  it("confirms once the broker says it is done", async () => {
    await replyFrom(
      "fx-verify",
      "Thank you. Your request has been completed and your data has been deleted.",
    );
    await pollNow();
    await waitForStatus("fx-verify", ["confirmed"]);
  });
});

describe("a match on the people-search site", () => {
  it("removes the record the person says is theirs, and only that one", async () => {
    const queue = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    const matches = queue.matches.filter((match) => match.targetId === "fx-people");
    const mine = matches.find((match) => match.recordUrl.endsWith("austin"));
    const other = matches.find((match) => match.recordUrl.endsWith("portland"));
    if (!mine || !other) throw new Error("the scan did not find both records");

    await api.call(API_ROUTES.matchDecide, {
      params: { id: other.id },
      body: { decision: "not_mine", rights: ["opt_out"] },
    });
    const decided = await api.call(API_ROUTES.matchDecide, {
      params: { id: mine.id },
      body: { decision: "mine", rights: ["opt_out", "delete"] },
    });
    expect(decided.requestId).toBeTruthy();

    const request = await waitForStatus("fx-people", ["awaiting_reply"], 90_000);
    expect(request.recordUrl).toBe(mine.recordUrl);
    expect(request.channel).toBe("form");
    expect(request.awaitingConfirmationSince).not.toBeNull();

    const state = await fixtureState();
    expect(state.tokens).toHaveLength(1);
    expect(state.tokens[0]).toMatchObject({
      record: "jordan-example-austin",
      email: MAILBOX_ADDRESS,
    });
    expect(state.removed).toEqual([]);
  });

  it("finishes the removal when the broker's confirmation email arrives", async () => {
    const [issued] = (await fixtureState()).tokens;
    if (!issued) throw new Error("no confirmation token was issued");
    await deliver({
      from: "no-reply@fixture-people.test",
      to: MAILBOX_ADDRESS,
      subject: "Confirm your removal request",
      text: `Please confirm that you want this record removed by clicking this link: http://fixture-people.test:8530/confirm?token=${issued.token}`,
    });
    await pollNow();

    await eventually(async () => (await fixtureState()).removed.includes("jordan-example-austin"), {
      what: "the confirmation link to be followed",
    });
    const request = await requestFor("fx-people");
    await eventually(
      async () => (await requestFor("fx-people")).awaitingConfirmationSince === null,
      {
        what: "the request to stop waiting for the email",
      },
    );
    expect(await eventTypes(request)).toContain("link_followed");
  });

  it("settles the request when the broker says the record is gone", async () => {
    await deliver({
      from: "no-reply@fixture-people.test",
      to: MAILBOX_ADDRESS,
      subject: "Your removal is complete",
      text: "Your record has been removed from our site.",
    });
    await pollNow();
    await waitForStatus("fx-people", ["confirmed"]);
  });

  it("finds the person gone when it scans again", async () => {
    await api.call(API_ROUTES.scansStart, {
      params: { id: world.profileId },
      body: { targetIds: ["fx-people"] },
    });
    const scan = await eventually(
      async () => {
        const { items } = await api.call(API_ROUTES.scansList, { params: { id: world.profileId } });
        const finished = items.filter(
          (entry) => entry.targetId === "fx-people" && entry.finishedAt,
        );
        return finished.length >= 2 ? finished[0] : undefined;
      },
      { what: "the second scan to finish", timeoutMs: 60_000 },
    );
    expect(scan.candidateCount).toBe(1);
    expect(scan.matchCounts.pending).toBe(0);
  });
});

describe("a CAPTCHA a person has to pass", () => {
  it("resumes the parked task after the person has done the check, and the worker finishes the form", async () => {
    const queue = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    const blocked = queue.blockedTasks.find((item) => item.task.targetId === "fx-captcha");
    if (!blocked) throw new Error("the CAPTCHA task is not blocked");

    await solveFixtureCaptcha();
    await api.call(API_ROUTES.taskResume, { params: { id: blocked.task.id } });

    const request = await waitForStatus("fx-captcha", ["awaiting_reply"], 90_000);
    expect(request.channel).toBe("form");
    const submissions = (await fixtureState()).submissions.filter(
      (entry) => entry.path === "/optout/captcha",
    );
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.fields).toEqual({ name: "Jordan Example", email: MAILBOX_ADDRESS });

    const after = await api.call(API_ROUTES.reviewQueue, { query: { profileId: world.profileId } });
    expect(after.blockedTasks).toEqual([]);
    expect(await eventTypes(request)).toEqual(
      expect.arrayContaining(["task_blocked", "task_resumed", "task_completed"]),
    );
  });
});

describe("an agent over MCP", () => {
  it("is off until the settings page turns it on, then refuses anyone without the token", async () => {
    const poke = (headers: Record<string, string> = {}) =>
      fetch(`${STACK.serverUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: "{}",
      });
    expect((await poke()).status).toBe(503);

    await api.call(API_ROUTES.settingsPatch, { body: { mcp: { enabled: true } } });
    world.mcpToken = (await api.call(API_ROUTES.settingsMcpToken)).token;

    expect((await poke()).status).toBe(401);
    expect((await poke({ authorization: "Bearer not-the-token" })).status).toBe(401);
    expect((await poke({ authorization: `Bearer ${STACK.workerToken}` })).status).toBe(401);
    const wrong = await connectMcp("not-the-token").then(
      () => "connected",
      () => "refused",
    );
    expect(wrong).toBe("refused");
  });

  it("claims the agent task, reads its target, and completes it with a typed result", async () => {
    const client = await connectMcp(world.mcpToken);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_tasks",
          "claim_task",
          "complete_task",
          "block_task",
          "fail_task",
          "get_target",
        ]),
      );

      const listed = await callTool<{
        tasks: { id: string; kind: string; targetName: string | null }[];
      }>(client, "list_tasks", { kind: "agent" });
      expect(listed.tasks.map((task) => task.targetName)).toContain("Fixture Agent Data");

      const claimed = await callTool<{
        task: {
          id: string;
          kind: string;
          instructions: string;
          fields: Record<string, string>;
          target: { id: string; optOutUrl: string };
        } | null;
      }>(client, "claim_task", { workerId: "e2e-agent" });
      const task = claimed.task;
      if (!task) throw new Error("the agent found nothing to claim");
      expect(task).toMatchObject({ kind: "agent", target: { id: "fx-agent" } });
      expect(task.instructions).toContain("http://fixture-agent.test:8530/optout/simple");
      expect(task.fields.email).toBe(MAILBOX_ADDRESS);
      expect(Object.keys(task.fields)).not.toContain("date_of_birth");

      const target = await callTool<{ id: string; recipes: unknown[] }>(client, "get_target", {
        targetId: "fx-agent",
      });
      expect(target).toMatchObject({ id: "fx-agent", recipes: [] });

      const wrongShape = await client.callTool({
        name: "complete_task",
        arguments: {
          workerId: "e2e-agent",
          taskId: task.id,
          result: { candidates: [] },
        },
      });
      expect(wrongShape.isError).toBe(true);

      await callTool(client, "complete_task", {
        workerId: "e2e-agent",
        taskId: task.id,
        result: {
          purpose: "remove",
          form: { outcome: "submitted", confirmationText: "Your opt-out request was received" },
        },
        usage: { inputTokens: 1200, outputTokens: 300, durationMs: 4000 },
      });
    } finally {
      await client.close();
    }

    const request = await waitForStatus("fx-agent", ["awaiting_reply"]);
    const detail = await api.call(API_ROUTES.requestsGet, { params: { id: request.id } });
    expect(detail.tasks.find((task) => task.kind === "agent")).toMatchObject({
      status: "done",
      claimerKind: "mcp",
      finishedBy: "e2e-agent",
      usage: { inputTokens: 1200 },
    });
  });
});

describe("the whole run", () => {
  it("picks up a reply by itself on the schedule, with nobody pressing check now", async () => {
    await replyFrom("fx-company", "Your request has been completed. We have deleted your data.");
    await waitForStatus("fx-company", ["confirmed"], 170_000);
  }, 200_000);

  it("ends with every request settled or waiting on a broker, and nothing stuck", async () => {
    const dashboard = await api.call(API_ROUTES.dashboardGet, { params: { id: world.profileId } });
    expect(dashboard.counts).toMatchObject({
      queued: 0,
      sent: 0,
      confirmed: 5,
      no_record: 1,
      rejected: 1,
      needs_verification: 0,
      bounced: 0,
    });
    expect(dashboard.attention).toEqual({
      blockedTasks: 0,
      pendingMatches: 0,
      unreviewedMessages: 0,
      needsVerification: 0,
      failedTasks: 0,
    });
    expect(dashboard.recentEvents.length).toBeGreaterThan(5);
    expect((await api.call(API_ROUTES.reviewQueue)).blockedTasks).toEqual([]);
    expect(dashboard.mailbox?.lastError).toBeNull();

    const state = await fixtureState();
    const paths = state.submissions.map((entry) => entry.path).sort();
    expect(paths).toEqual(["/optout/captcha", "/optout/simple", "/optout/simple", "/remove"]);
  });
});
