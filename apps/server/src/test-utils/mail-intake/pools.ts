/** Wording the generator draws from. Everything is invented; no sentence is copied from a real sender. */

export interface Rng {
  next(): number;
}

/** A small seeded generator, so the same seed always produces the same corpus. */
export function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)] as T;
}

export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng.next() * (max - min + 1));
}

export function hex(rng: Rng, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += "0123456789abcdef"[int(rng, 0, 15)];
  return out;
}

export function digits(rng: Rng, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String(int(rng, 0, 9));
  return out;
}

export const FIRST_NAMES = ["Sam", "Priya", "Marcus", "Elena", "Tom", "Aisha", "Diego", "Hannah"];
export const MARKETING_ADJECTIVES = ["Exclusive", "Limited-time", "Early access", "Members-only"];

export const AMAZON_MARKETING_SUBJECTS = [
  "You received 90 days FREE with your purchase",
  "Deals on headphones you may like",
  "Your Prime Day picks are waiting",
  "Save 20% on your next grocery order",
  "Jordan, new arrivals in Home & Kitchen",
  "Try Prime Video free for 30 days",
  "Recommended for you: standing desks",
  "Last chance: lightning deals end tonight",
  "Add Kindle Unlimited to your account for $0.99",
  "Back to school savings are here",
];

export const NETFLIX_MARKETING_SUBJECTS = [
  "New this week on Netflix",
  "Top picks for Jordan",
  "Because you watched a documentary",
  "Your plan, your way: try the ad-supported tier",
  "Season finale tonight",
];

export const BROKER_MARKETING_SUBJECTS = [
  "See who searched for you this month",
  "Your free report is ready to view",
  "Unlock your full background report",
  "We miss you: come back for 50% off",
];

export const ORDER_SUBJECTS = [
  "Your Amazon.com order of {item} has shipped",
  "Delivered: Your package with {item}",
  "Order confirmation: {item}",
  "Your refund for {item} has been processed",
  "Arriving tomorrow: {item}",
  "Review your recent purchase: {item}",
  "Your return label for {item}",
];

export const ITEMS = [
  "USB-C charging cable",
  "stainless steel water bottle",
  "wireless mouse",
  "desk lamp",
  "cast iron skillet",
  "running socks",
  "bike lock",
  "notebook set",
  "LED light bulbs",
  "phone stand",
];

export const NETFLIX_ACCOUNT_SUBJECTS = [
  "Your Netflix payment was declined",
  "New sign-in to your Netflix account",
  "Your membership will renew soon",
  "Your receipt from Netflix",
  "Netflix: update your payment method",
];

export const AMAZON_ACCOUNT_SUBJECTS = [
  "Your Amazon password was changed",
  "Sign-in attempt from a new device",
  "Your Amazon Prime membership renewal",
  "Amazon: confirm your new email address",
  "Your Subscribe & Save delivery is scheduled",
];

export const OTHER_MARKETING = [
  {
    domain: "e.target.com",
    name: "Target Circle",
    local: "targetnews",
    subjects: [
      "Weekend deals just for you",
      "Your Circle offers expire soon",
      "New markdowns in home",
    ],
  },
  {
    domain: "mail.instacart.com",
    name: "Instacart",
    local: "hello",
    subjects: [
      "$10 off your next order",
      "Fresh picks near you",
      "Free delivery on your first three orders",
    ],
  },
  {
    domain: "uber.com",
    name: "Uber",
    local: "uber",
    subjects: ["Your ride summary", "Get 15% off your next trip", "Try Uber Eats today"],
  },
  {
    domain: "linkedin.com",
    name: "LinkedIn",
    local: "jobs-listings",
    subjects: [
      "5 new jobs match your profile",
      "Jordan, you appeared in 12 searches",
      "Your weekly digest",
    ],
  },
  {
    domain: "github.com",
    name: "GitHub",
    local: "noreply",
    subjects: [
      "[example/repo] Pull request #214: tighten retry logic",
      "Your GitHub security digest",
      "A new sign-in to your account",
    ],
  },
  {
    domain: "shopify-mail.com",
    name: "Brightside Coffee",
    local: "orders",
    subjects: [
      "Your beans are on the way",
      "Order #4821 confirmed",
      "Roast of the month: Ethiopia Guji",
    ],
  },
  {
    domain: "airline-news.example",
    name: "Skyline Air",
    local: "offers",
    subjects: [
      "Fares from $79 this fall",
      "Check in now for your flight",
      "Earn double miles this month",
    ],
  },
  {
    domain: "gymfit.example",
    name: "Gymfit",
    local: "team",
    subjects: ["Your membership renews on the 1st", "Try our new classes", "We saved your spot"],
  },
  {
    domain: "utility-co.example",
    name: "Lone Star Power",
    local: "billing",
    subjects: ["Your October bill is ready", "Usage alert for your account", "Autopay scheduled"],
  },
];

export const NEWSLETTERS = [
  {
    domain: "substack.com",
    name: "The Weekly Ledger",
    local: "ledger",
    listId: "ledger.substack.com",
    subjects: ["What the rate cut means for renters", "Five charts on housing", "Reader mailbag"],
  },
  {
    domain: "morning-brief.example",
    name: "Morning Brief",
    local: "daily",
    listId: "daily.morning-brief.example",
    subjects: ["Your Thursday briefing", "Markets open mixed", "Seven things to know today"],
  },
  {
    domain: "devweekly.example",
    name: "Dev Weekly",
    local: "issue",
    listId: "issues.devweekly.example",
    subjects: [
      "Issue 412: SQLite in production",
      "Issue 413: the case for boring tech",
      "Issue 414: tracing without pain",
    ],
  },
  {
    domain: "gardening-club.example",
    name: "Gardening Club",
    local: "news",
    listId: "news.gardening-club.example",
    subjects: ["Plant now for spring blooms", "October garden checklist", "Composting basics"],
  },
  {
    domain: "privacy-digest.example",
    name: "Privacy Digest",
    local: "editor",
    listId: "editor.privacy-digest.example",
    subjects: [
      "This month in data broker enforcement",
      "How to send a deletion request",
      "Opt-out rights by state",
    ],
  },
];

export const PERSONAL = [
  { name: "Sam Rivera", address: "sam.rivera82@gmail.com" },
  { name: "Mom", address: "linda.example55@gmail.com" },
  { name: "Priya N", address: "priya.n@outlook.com" },
  { name: "Marcus Chen", address: "marcus@chenfamily.example" },
  { name: "Dana (work)", address: "dana.okafor@acme-corp.example" },
  { name: "Tom Becker", address: "tbecker@icloud.com" },
];

export const PERSONAL_SUBJECTS = [
  "Re: dinner Saturday?",
  "photos from the trip",
  "Can you review this doc before Friday",
  "Re: Re: moving boxes",
  "quick question",
  "Happy birthday!",
  "Re: fantasy league",
  "Lunch tomorrow?",
  "Did you ever hear back about that privacy thing?",
  "Re: remove me from the group chat lol",
  "Confirm: are you still coming Sunday",
  "Request: can I borrow your ladder",
];

export const PERSONAL_BODIES = [
  "Hey, are you free Saturday evening? We were thinking of trying the new place on Main.\n\nLet me know,\n{first}",
  "Attached the photos from the lake. The one where you are holding the fish is my favorite.\n\n{first}",
  "Can you look over the budget doc before Friday? I need to confirm the numbers with finance.\n\nThanks,\n{first}",
  "Quick question: did you manage to get the removal request thing sorted? I saw an article about people search sites and thought of you.\n\n{first}",
  "Happy birthday! Dinner is on me this weekend. Pick a place and send it over.\n\n{first}",
  "I will confirm with the landlord and get back to you tomorrow. Please do not send the deposit until then.\n\n{first}",
  "Can you remove my number from the group chat? I keep getting pinged. Thanks a lot!\n\n{first}",
  "Just checking whether you received my last email about the deposit. Please reply when you can.\n\n{first}",
];

export const BANKS = [
  {
    domain: "chase.com",
    name: "Chase",
    local: "no.reply.alerts",
    subjects: [
      "Security alert: we need to verify your identity",
      "A new device signed in to your account",
      "Your statement is ready",
      "Fraud alert on your card ending in 4412",
    ],
  },
  {
    domain: "paypal.com",
    name: "PayPal",
    local: "service",
    subjects: [
      "Confirm your identity to restore access",
      "You received a payment",
      "Action required: verify your email address",
    ],
  },
  {
    domain: "google.com",
    name: "Google",
    local: "no-reply",
    subjects: [
      "Security alert for jordan@example.com",
      "Critical security alert",
      "Verify it's you: new sign-in on Linux",
    ],
  },
];

export const BANK_BODIES = [
  "We noticed a sign-in from a new device. If this was you, no action is needed. If not, please verify your identity and secure your account at the link below.\n\nhttps://{domain}/security/review?id={token}",
  "To keep your account safe we need you to confirm your identity. Click the link below to continue. This link expires in 24 hours.\n\nhttps://{domain}/verify?t={token}",
  "A purchase of USD {amount} was attempted. Please confirm whether this was you, and we will remove the hold.\n\nhttps://{domain}/alerts/{token}",
  "Your statement is ready. Sign in to view your balance and recent transactions. Your request to update alerts has been processed.",
];

export const NO_REQUEST_TARGETS = [
  {
    id: "peoplefinders",
    name: "PeopleFinders",
    domain: "peoplefinders.com",
    local: "news",
    subjects: [
      "Search anyone, anywhere",
      "Your saved search has new results",
      "Public records, made simple",
    ],
  },
  {
    id: "truthfinder",
    name: "TruthFinder",
    domain: "truthfinder.com",
    local: "offers",
    subjects: ["Is your information online?", "Your report is ready", "Special offer inside"],
  },
  {
    id: "walmart",
    name: "Walmart",
    domain: "walmart.com",
    local: "help",
    subjects: ["Your order has shipped", "Rollbacks this week", "Your pickup order is ready"],
  },
  {
    id: "bestbuy",
    name: "Best Buy",
    domain: "em.bestbuy.com",
    local: "bestbuy",
    subjects: ["Weekend doorbusters", "Your order is ready for pickup", "Trade in and save"],
  },
  {
    id: "mylife",
    name: "MyLife",
    domain: "mylife.com",
    local: "alerts",
    subjects: [
      "Someone is looking at your profile",
      "Reactivate your account",
      "Your reputation score changed",
    ],
  },
];

export const CALENDAR_EVENTS = [
  "Dentist appointment",
  "Q4 planning",
  "Team offsite",
  "Coffee with Sam",
  "Landlord walkthrough",
  "1:1 with Dana",
  "Yoga",
  "Car service",
];

export type ReplyKind =
  | "completed"
  | "no_record"
  | "rejected"
  | "verification_required"
  | "needs_form"
  | "auto_ack";

export const REPLY_BODIES: Record<ReplyKind, readonly string[]> = {
  completed: [
    "We have removed the listing associated with {email} from {brand}. It can take up to 72 hours to disappear from search results.",
    "Your opt-out request has been processed and your information has been suppressed.",
    "Good news: the record you asked us to delete has been deleted from our systems.",
    "We have completed your request. Your profile has been removed and will no longer appear on {brand}.",
  ],
  no_record: [
    "We could not find any record matching the details in your request.",
    "After searching our database, we were unable to locate a profile for {name}.",
    "There is no matching record on file for {email}, so there is nothing for us to remove.",
  ],
  rejected: [
    "We are unable to process your request because we could not confirm you live in a state covered by our opt-out program.",
    "Your request has been denied: the information you asked about comes from public records that are exempt from deletion.",
    "We have declined this request as it does not meet the requirements of our policy.",
  ],
  verification_required: [
    "To locate your record, please provide your full name, date of birth and current street address.",
    "We need additional information to process your request. Please reply with the phone number and zip code associated with the listing.",
    "Before we can act, please confirm your identity by sending a copy of your government-issued photo ID.",
  ],
  needs_form: [
    "We do not accept requests by email. Please use our online form at https://{domain}/optout to submit your request.",
    "Requests must be submitted through our privacy portal at https://{domain}/privacy-center. Please complete the form there.",
  ],
  auto_ack: [
    "Thank you for contacting {brand}. We have received your request and will respond within 10 business days. Your ticket number is {ticket}.",
    "This is an automatic reply. We received your message and our privacy team will review it within 5 business days.",
    "Your request has been logged. Case number {ticket}. We will be in touch.",
  ],
};

export const REPLY_FIELDS_NOTE = "Reply to this message with the details above.";

export const CLEAR_NO_REFERENCE: Record<ReplyKind, readonly string[]> = {
  completed: [
    "Regarding your request to remove {name} from {brand}: we have removed the listing tied to {email}.",
    "We processed the opt-out you sent for {email}. Your profile has been removed.",
  ],
  no_record: [
    "About the removal request for {name}: we could not find any record for {email} in our system.",
    "Regarding your deletion request: there is no matching record on file for you.",
  ],
  rejected: [
    "Regarding your request to delete {name}'s data: we are unable to process it because the data is exempt from deletion.",
  ],
  verification_required: [
    "To act on your opt-out request for {name}, please provide your date of birth and current street address.",
  ],
  needs_form: [
    "Thanks for your note about removing {name}. We do not accept requests by email, please use our online form at https://{domain}/optout.",
  ],
  auto_ack: [
    "Thanks for reaching out about your removal request. Our team will respond within 7 business days.",
    "We have received your message about your data and will review it shortly.",
  ],
};

export const BOUNCE_REASONS = [
  "550 5.1.1 The email account that you tried to reach does not exist.",
  "554 5.7.1 Message rejected due to local policy.",
  "552 5.2.2 The recipient's mailbox is full.",
];

export const OUT_OF_OFFICE = [
  "I am out of the office until {date} with limited access to email. For urgent matters please contact the privacy desk.",
  "Thank you for your email. I am on leave and will reply when I return on {date}.",
];

export const FIRST_LINE_GREETINGS = [
  "Hello Jordan,",
  "Hi Jordan,",
  "Dear Jordan Example,",
  "Hello,",
];
export const SIGN_OFFS = [
  "Regards,\n{brand} Privacy Team",
  "Thank you,\nCustomer Care, {brand}",
  "Sincerely,\nData Subject Requests, {brand}",
];
