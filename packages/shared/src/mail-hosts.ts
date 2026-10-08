/**
 * Hosts that many unrelated parties send from or publish forms on: public mailbox providers and
 * multi-tenant privacy or form platforms. A signature from one of them proves only that some
 * customer of the host sent the mail, so none of them may stand in for a target's own domain.
 */
export const SHARED_MAIL_HOSTS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "aim.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "rocketmail.com",
  "gmx.com",
  "gmx.net",
  "web.de",
  "mail.com",
  "mail.ru",
  "zoho.com",
  "zohomail.com",
  "yandex.com",
  "yandex.ru",
  "fastmail.com",
  "fastmail.fm",
  "mailbox.org",
  "protonmail.ch",
  "hey.com",
  "tutanota.com",
  "tutanota.de",
  "tutamail.com",
  "tuta.com",
  "tuta.io",
  "duck.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "comcast.net",
  "att.net",
  "sbcglobal.net",
  "verizon.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "earthlink.net",
  "google.com",
  "forms.gle",
  "hubspot.com",
  "onetrust.com",
  "trustarc.com",
  "termly.io",
  "jotform.com",
  "typeform.com",
  "salesforce.com",
  "zendesk.com",
  "freshdesk.com",
  "surveymonkey.com",
  "wufoo.com",
  "airtable.com",
  "smartsheet.com",
  "office.com",
  "microsoft.com",
  "sharepoint.com",
  "mailchimp.com",
  "mcsv.net",
  "mandrillapp.com",
  "sendgrid.net",
  "mailgun.org",
  "amazonses.com",
  "hubspotemail.net",
  "force.com",
  "mktomail.com",
  "exacttarget.com",
  "helpscout.net",
  "intercom-mail.com",
  "datagrail.io",
  "transcend.io",
  "securiti.ai",
  "osano.com",
  "wixsite.com",
  "squarespace.com",
  "notion.site",
];

/**
 * Mailbox brands that run a domain per country, such as yahoo.co.uk or outlook.de. They are matched
 * by label, because listing every regional domain would always trail the providers.
 */
const REGIONAL_MAIL_BRANDS: readonly string[] = [
  "yahoo",
  "hotmail",
  "outlook",
  "live",
  "msn",
  "gmx",
  "aol",
  "ymail",
];

const COUNTRY_SECOND_LEVELS = new Set(["co", "com", "org", "net", "ac", "gov", "ne", "or"]);

/** True for `brand.<tld>` and `brand.<co|com|...>.<tld>` under any subdomain, and nothing deeper. */
function isRegionalMailHost(labels: readonly string[]): boolean {
  return labels.some((label, index) => {
    if (!REGIONAL_MAIL_BRANDS.includes(label)) return false;
    const rest = labels.length - index - 1;
    return rest === 1 || (rest === 2 && COUNTRY_SECOND_LEVELS.has(labels[index + 1] ?? ""));
  });
}

/** True when `host` is a shared host or a subdomain of one, including a provider's regional domains. */
export function isSharedMailHost(host: string): boolean {
  const lower = host.trim().toLowerCase().replace(/\.$/, "");
  return (
    SHARED_MAIL_HOSTS.some((shared) => lower === shared || lower.endsWith(`.${shared}`)) ||
    isRegionalMailHost(lower.split("."))
  );
}

/** The domains in `domains` that are not shared hosts, lowercased. */
export function withoutSharedHosts(domains: readonly string[]): string[] {
  return domains
    .map((domain) => domain.trim().toLowerCase())
    .filter((d) => d && !isSharedMailHost(d));
}
