import type { Config } from "../config.js";

export type HostPolicy = (host: string | undefined) => boolean;

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const isIpLiteral = (hostname: string) =>
  hostname.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);

const isLoopbackName = (hostname: string) =>
  hostname === "localhost" || hostname.endsWith(".localhost");

/**
 * The names this server answers to. A page on an attacker's domain can be pointed at this server by
 * DNS rebinding, and the browser then sends that domain as the Host and Origin, so only loopback
 * names, a bare IP address (which no one can rebind), the configured public address, and any
 * extra names the operator listed are accepted.
 */
export function createHostPolicy(config: Pick<Config, "publicUrl" | "allowedHosts">): HostPolicy {
  const named = new Set(
    [new URL(config.publicUrl).hostname.toLowerCase(), ...config.allowedHosts].filter(Boolean),
  );
  return (host) => {
    if (host === undefined) return false;
    const hostname = hostnameOf(host);
    if (hostname === null) return false;
    return isIpLiteral(hostname) || isLoopbackName(hostname) || named.has(hostname);
  };
}
