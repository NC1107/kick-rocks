import { describe, expect, it } from "vitest";
import { isSharedMailHost, withoutSharedHosts } from "./mail-hosts.js";

describe("isSharedMailHost", () => {
  it.each([
    "gmx.de",
    "mailbox.org",
    "protonmail.ch",
    "fastmail.fm",
    "web.de",
    "yahoo.co.uk",
    "yahoo.fr",
    "hotmail.co.uk",
    "hotmail.it",
    "outlook.de",
    "outlook.com.au",
    "comcast.net",
    "att.net",
    "sbcglobal.net",
    "verizon.net",
    "tutanota.com",
    "tuta.io",
    "duck.com",
    "mail.ru",
    "qq.com",
    "163.com",
    "naver.com",
    "rocketmail.com",
    "aim.com",
    "zohomail.com",
    "hubspotemail.net",
    "force.com",
    "mktomail.com",
    "helpscout.net",
    "intercom-mail.com",
    "mailgun.org",
    "mcsv.net",
    "mandrillapp.com",
    "exacttarget.com",
    "datagrail.io",
    "transcend.io",
    "securiti.ai",
    "osano.com",
    "Mail.Yahoo.de",
    "calendar.google.com",
  ])("is true for %s", (host) => {
    expect(isSharedMailHost(host)).toBe(true);
  });

  it.each([
    "acme.test",
    "yahoo-clone.test",
    "outlook.example.test",
    "notgmail.com",
    "gmx.acme.test",
  ])("is false for the unrelated host %s", (host) => {
    expect(isSharedMailHost(host)).toBe(false);
  });
});

describe("withoutSharedHosts", () => {
  it("lowercases and drops shared hosts", () => {
    expect(withoutSharedHosts(["Sister.test", "GMAIL.com", "yahoo.co.uk"])).toEqual([
      "sister.test",
    ]);
  });
});
