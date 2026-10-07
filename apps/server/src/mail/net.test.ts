import { describe, expect, it } from "vitest";
import { describeMailError, isLoopbackHost, isTrustedPlaintextHost } from "./net.js";

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "mail.localhost",
    "127.0.0.1",
    "127.9.9.9",
    "::1",
    "[::1]",
    "localhost.",
  ])("treats %s as this machine", (host) => expect(isLoopbackHost(host)).toBe(true));

  it.each([
    "smtp.gmail.com",
    "10.0.0.5",
    "192.168.1.2",
    "127.example.com",
    "localhost.example.com",
    "",
  ])("treats %s as another machine", (host) => expect(isLoopbackHost(host)).toBe(false));
});

describe("isTrustedPlaintextHost", () => {
  it("trusts this machine and the hosts the operator named, and nothing else", () => {
    expect(isTrustedPlaintextHost("localhost")).toBe(true);
    expect(isTrustedPlaintextHost("greenmail", ["greenmail"])).toBe(true);
    expect(isTrustedPlaintextHost(" GreenMail ", ["greenmail"])).toBe(true);
    expect(isTrustedPlaintextHost("smtp.gmail.com", ["greenmail"])).toBe(false);
    expect(isTrustedPlaintextHost("greenmail")).toBe(false);
  });
});

describe("describeMailError", () => {
  it("explains a refused connection, even when the library hides it behind a generic code", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNECTION",
    });
    expect(describeMailError(error)).toBe(
      "The server refused the connection. Check the host and port.",
    );
  });

  it("explains a host that does not exist", () => {
    const error = Object.assign(new Error("getaddrinfo ENOTFOUND smtp.nowhere.test"), {
      code: "EDNS",
    });
    expect(describeMailError(error)).toMatch(/host name could not be found/);
  });

  it("says a login was rejected, with what the server said", () => {
    const error = Object.assign(new Error("Invalid login"), {
      code: "EAUTH",
      response: "535 5.7.8 Username and password not accepted",
    });
    expect(describeMailError(error)).toBe(
      "The server rejected the username or app password. The server said: 535 5.7.8 Username and password not accepted",
    );
  });

  it("recognizes an IMAP authentication failure", () => {
    const error = Object.assign(new Error("Command failed"), {
      authenticationFailed: true,
      responseText: "Invalid credentials (Failure)",
    });
    expect(describeMailError(error)).toMatch(
      /rejected the username or app password.*Invalid credentials/,
    );
  });

  it("explains certificate problems", () => {
    const error = Object.assign(new Error("self signed"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    expect(describeMailError(error)).toMatch(/self-signed/);
  });

  it("removes the password wherever it appears", () => {
    const error = new Error("LOGIN jordan s3cr3t-app-pass failed: s3cr3t-app-pass");
    const text = describeMailError(error, ["s3cr3t-app-pass"]);
    expect(text).not.toContain("s3cr3t-app-pass");
    expect(text).toContain("[hidden]");
  });

  it("removes the password from what the server said", () => {
    const error = Object.assign(new Error("x"), {
      code: "EAUTH",
      response: "535 bad password hunter2hunter2",
    });
    expect(describeMailError(error, ["hunter2hunter2"])).not.toContain("hunter2hunter2");
  });

  it("falls back to the library's message, and then to a generic one, and stays short", () => {
    expect(describeMailError(new Error("Something odd happened"))).toBe("Something odd happened");
    expect(describeMailError("boom")).toBe("The mail server failed.");
    expect(describeMailError(new Error("x".repeat(1000))).length).toBeLessThanOrEqual(300);
  });
});
