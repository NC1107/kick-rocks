import { describe, expect, it } from "vitest";
import { extractLinks, stripQuoted } from "./reply-text.js";

describe("stripQuoted", () => {
  it("drops quoted lines and everything after an attribution line", () => {
    expect(
      stripQuoted(
        "Done.\n\nOn Mon, Sep 28, 2026 at 9:00 AM Jordan Example <jordan@example.com> wrote:\n> Please delete my data.\n\nignored",
      ),
    ).toBe("Done.");
  });

  it("handles an attribution that wraps onto a second line", () => {
    expect(
      stripQuoted(
        "Done.\n\nOn Mon, Sep 28, 2026 at 9:00 AM Jordan Example <jordan@example.com>\nwrote:\n> old",
      ),
    ).toBe("Done.");
  });

  it("handles original message separators and underscores", () => {
    expect(stripQuoted("Done.\n-----Original Message-----\nFrom: x\nSubject: y")).toBe("Done.");
    expect(stripQuoted("Done.\n________________________________\nFrom: x")).toBe("Done.");
  });

  it("handles an Outlook style header block but not a line that merely starts with From", () => {
    expect(
      stripQuoted(
        "Done.\n\nFrom: Jordan <j@example.com>\nSent: Monday\nTo: a@b.test\nSubject: s\n\nold",
      ),
    ).toBe("Done.");
    expect(stripQuoted("From: our records, you are not listed.\nThanks.")).toContain("Thanks.");
  });

  it("drops quoted lines in the middle of a reply and keeps the rest", () => {
    expect(stripQuoted("Answer one.\n> quoted\nAnswer two.")).toBe("Answer one.\nAnswer two.");
  });

  it("normalizes Windows line endings and leaves unquoted text alone", () => {
    expect(stripQuoted("One\r\nTwo")).toBe("One\nTwo");
    expect(stripQuoted("")).toBe("");
  });
});

describe("extractLinks", () => {
  it("reads anchors with their text and decodes entities", () => {
    expect(
      extractLinks('<a href="https://acme.test/c?a=1&amp;b=2">Confirm &amp; finish</a>', ""),
    ).toEqual([{ url: "https://acme.test/c?a=1&b=2", text: "Confirm & finish" }]);
  });

  it("reads addresses from text and strips trailing punctuation", () => {
    expect(
      extractLinks(
        null,
        "Visit https://acme.test/a, or (https://acme.test/b). Also http://acme.test/c!",
      ).map((link) => link.url),
    ).toEqual(["https://acme.test/a", "https://acme.test/b", "http://acme.test/c"]);
  });

  it("deduplicates a link found in both the HTML and the text, keeping the anchor text", () => {
    expect(
      extractLinks('<a href="https://acme.test/x">Confirm</a>', "Confirm [https://acme.test/x]"),
    ).toEqual([{ url: "https://acme.test/x", text: "Confirm" }]);
  });

  it("ignores links that are not http or https and links that do not parse", () => {
    expect(
      extractLinks(
        '<a href="javascript:alert(1)">x</a><a href="mailto:a@b.test">m</a><a href="data:text/html,hi">d</a><a href="/relative">r</a><a href="https://ok.test/">ok</a>',
        "",
      ).map((link) => link.url),
    ).toEqual(["https://ok.test/"]);
  });

  it("ignores links in a block quote and in quoted text", () => {
    expect(
      extractLinks(
        '<blockquote><a href="https://old.test/">old</a></blockquote><a href="https://new.test/">new</a>',
        "> https://quoted.test/\nhttps://plain.test/",
      ).map((link) => link.url),
    ).toEqual(["https://new.test/", "https://plain.test/"]);
  });

  it("removes whitespace a mail client wrapped into a link", () => {
    expect(
      extractLinks('<a href="https://acme.test/confirm?token=\n abc">go</a>', "")[0]?.url,
    ).toBe("https://acme.test/confirm?token=abc");
  });

  it("caps how many links one message can produce", () => {
    const text = Array.from({ length: 500 }, (_, index) => `https://acme.test/${index}`).join(" ");
    expect(extractLinks(null, text).length).toBe(200);
  });
});
