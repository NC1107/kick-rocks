#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EM_DASH = "\u2014";
const BRAND = ["cla", "ude"].join("");

// Pinned upstream data is copied verbatim and may contain anything.
const EM_DASH_EXEMPT = [/^packages\/brokers\/data\/upstream\//];

// Only the Anthropic provider needs the brand, because its model ids are named after it.
// biome.json ignores the .claude worktree directory, which is a tooling path rather than prose.
const BRAND_ALLOWED = [
  /^apps\/agent-worker\/src\/config(\.test)?\.ts$/,
  /^apps\/agent-worker\/src\/providers\//,
  /^\.env\.example$/,
  /^biome\.json$/,
  /^scripts\/check-standards(\.test)?\.mjs$/,
];

const ATTRIBUTION_PATTERNS = [
  { name: "Co-Authored-By trailer", regex: /^\s*co-authored-by:/im },
  { name: '"Generated with" line', regex: /generated with/i },
];

const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|db|gz|zip)$/i;
const ZERO_SHA = /^0+$/;

export function findViolations(files, readFile) {
  const violations = [];
  for (const file of files) {
    if (BINARY_EXTENSIONS.test(file)) continue;
    let text;
    try {
      text = readFile(file);
    } catch {
      continue;
    }
    const checkDash = !EM_DASH_EXEMPT.some((re) => re.test(file));
    const checkBrand = !BRAND_ALLOWED.some((re) => re.test(file));
    text.split("\n").forEach((line, index) => {
      if (checkDash && line.includes(EM_DASH)) {
        violations.push(`${file}:${index + 1}: em dash`);
      }
      if (checkBrand && line.toLowerCase().includes(BRAND)) {
        violations.push(`${file}:${index + 1}: mention outside the allowlist`);
      }
    });
  }
  return violations;
}

export function findCommitViolations(commits) {
  const violations = [];
  for (const { sha, message } of commits) {
    for (const { name, regex } of ATTRIBUTION_PATTERNS) {
      if (regex.test(message)) violations.push(`commit ${sha.slice(0, 10)}: ${name}`);
    }
  }
  return violations;
}

export function resolveRange(env, refExists) {
  const explicit = env.STANDARDS_RANGE;
  if (explicit) {
    const base = explicit.split("..")[0];
    return ZERO_SHA.test(base) ? "HEAD^!" : explicit;
  }
  return refExists("origin/main") ? "origin/main..HEAD" : "HEAD^!";
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function refExists(ref) {
  try {
    git("rev-parse", "--verify", "--quiet", ref);
    return true;
  } catch {
    return false;
  }
}

function readCommits(range) {
  const format = "--format=%H%x1f%B%x1e";
  let output;
  try {
    output = git("log", format, range);
  } catch {
    // A force push can leave the old base unreachable, so check the head commit alone.
    output = git("log", format, "-1");
  }
  return output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, message] = entry.split("\x1f");
      return { sha, message };
    });
}

function main() {
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  const range = resolveRange(process.env, refExists);
  const violations = [
    ...findViolations(files, (file) => readFileSync(file, "utf8")),
    ...findCommitViolations(readCommits(range)),
  ];
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    console.error(`\n${violations.length} standards violation(s).`);
    process.exit(1);
  }
  console.log(`standards ok (${files.length} files, commits ${range})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
