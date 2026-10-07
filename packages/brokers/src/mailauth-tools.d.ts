declare module "mailauth/lib/tools.js" {
  /** The entry of `domains` that shares an organizational domain with `domain`, or false. */
  export function getAlignment(
    domain: string,
    domains: readonly string[],
    strict?: boolean,
  ): { domain: string } | false;
}
