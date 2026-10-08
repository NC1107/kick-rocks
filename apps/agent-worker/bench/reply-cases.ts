import type { ProfileField, ReplyClassification } from "@kickrocks/shared";

export interface ReplyCase {
  id: string;
  truth: ReplyClassification;
  /** For verification_required, the profile fields the sender asks for. */
  requestedFields?: ProfileField[];
  subject: string;
  body: string;
}

const REF = "KR-7QX4M2";

/** Forty replies a person might get to an opt-out email. Every name and domain is a reserved example one. */
export const REPLY_CASES: ReplyCase[] = [
  // bounce
  {
    id: "bounce-1",
    truth: "bounce",
    subject: "Undelivered Mail Returned to Sender",
    body: "This is the mail system at host mx1.example.net.\n\nI'm sorry to have to inform you that your message could not be delivered to one or more recipients.\n\n<privacy@oldbroker.example.com>: host mail.oldbroker.example.com[203.0.113.9] said: 550 5.1.1 <privacy@oldbroker.example.com>: Recipient address rejected: User unknown in virtual mailbox table (in reply to RCPT TO command)\n\nFinal-Recipient: rfc822; privacy@oldbroker.example.com\nAction: failed\nStatus: 5.1.1",
  },
  {
    id: "bounce-2",
    truth: "bounce",
    subject: "Delivery Status Notification (Failure)",
    body: "Delivery has failed to these recipients or groups:\n\noptout@peoplefinder.example.org\nThe email account that you tried to reach is over quota. Please direct the recipient to https://support.example.org/mail/answer/6558 for more information.\n\nThe response was: 552 5.2.2 Mailbox full",
  },
  {
    id: "bounce-3",
    truth: "bounce",
    subject: "Mail delivery failed: returning message to sender",
    body:
      "This message was created automatically by mail delivery software.\n\nA message that you sent could not be delivered to one or more of its recipients. This is a permanent error. The following address(es) failed:\n\n  dsar@datahub.example.com\n    domain datahub.example.com does not exist\n\n------ This is a copy of the message, including all the headers. ------\nSubject: Request to delete my personal information " +
      REF,
  },
  {
    id: "bounce-4",
    truth: "bounce",
    subject: `Undeliverable: Opt-out request ${REF}`,
    body: "Your message to privacy@listmaster.example.net couldn't be delivered.\n\nprivacy wasn't found at listmaster.example.net.\n\nThe address may be misspelled or may not exist. Try retyping it or contact the recipient by another method.",
  },
  // auto_ack
  {
    id: "ack-1",
    truth: "auto_ack",
    subject: "Automatic reply: Request to delete my personal information",
    body: "Thank you for contacting Brightlist Privacy. This is an automated message to confirm we have received your email. A member of our team will review it and respond within 45 days as required by law. You do not need to send anything further.\n\nPlease do not reply to this message.",
  },
  {
    id: "ack-2",
    truth: "auto_ack",
    subject: `Out of Office: Do Not Sell request ${REF}`,
    body: "Hello,\n\nI am out of the office until Monday, October 20 with limited access to email. If your matter is urgent please contact my colleague Dana Placeholder at dana@datafolk.example.com.\n\nBest regards,\nRiley Sample",
  },
  {
    id: "ack-3",
    truth: "auto_ack",
    subject: "We received your request (ticket #48213)",
    body: "Hi there,\n\nYour request has been logged under ticket #48213. Our support team usually responds within 5 business days. You can add more information by replying to this email.\n\nThis is an automatic acknowledgement and is not a decision on your request.\n\nSupport Desk - Quickrecords",
  },
  {
    id: "ack-4",
    truth: "auto_ack",
    subject: `Re: Opt-out request ${REF}`,
    body: "Thanks for writing to the Marketflow privacy inbox. We get a high volume of messages and are working through them in the order received. Your message is in the queue. No action is needed on your side.",
  },
  // confirmation_link
  {
    id: "link-1",
    truth: "confirmation_link",
    subject: "Please confirm your opt-out request",
    body: "We received a request to remove the listing for Jordan Example from Peoplelookup.\n\nTo confirm this request, click the link below within 24 hours:\n\nhttps://www.peoplelookup.example.com/optout/confirm?token=9f3a7c21d4b8\n\nIf you did not make this request, ignore this email and nothing will change.",
  },
  {
    id: "link-2",
    truth: "confirmation_link",
    subject: "Action required: verify your email to finish your privacy request",
    body:
      "Hello,\n\nBefore we can process your deletion request " +
      REF +
      ", you must verify that you own this email address. Select the button below.\n\n[ Verify my request ]  https://privacy.datafolk.example.com/v/Zm9vYmFy\n\nThis link expires in 48 hours.",
  },
  {
    id: "link-3",
    truth: "confirmation_link",
    subject: "Confirm removal of your record",
    body: "You (or someone using your email address) asked us to remove a record from our site.\n\nClick here to complete the removal: https://records.example.net/remove/complete/88213?sig=ab12cd34\n\nUntil you click the link, the record stays visible.",
  },
  {
    id: "link-4",
    truth: "confirmation_link",
    subject: "One more step: confirm your do not sell request",
    body: "Thanks for submitting your Do Not Sell My Personal Information request.\n\nTo make sure it was really you, please confirm by opening this link: https://www.adreach.example.org/privacy/confirm/c3d4e5f6\n\nWe cannot act on your request until it is confirmed.",
  },
  // verification_required
  {
    id: "verify-1",
    truth: "verification_required",
    requestedFields: ["date_of_birth", "street"],
    subject: `Re: Request to delete my personal information ${REF}`,
    body: "Hello,\n\nWe take your privacy seriously. To verify your identity before we delete anything, please reply with your date of birth and your current street address so we can match them to our records.\n\nOnce we have verified you we will process the request.\n\nPrivacy Team, Infobase Example",
  },
  {
    id: "verify-2",
    truth: "verification_required",
    requestedFields: ["phone"],
    subject: `Verification needed for request ${REF}`,
    body: "We are unable to locate your record with the information provided. Please reply with the phone number associated with your account so that we can verify your request.",
  },
  {
    id: "verify-3",
    truth: "verification_required",
    requestedFields: ["full_name", "zip"],
    subject: "Additional information required",
    body: "Thank you for your request. Several people in our database share your name. So that we remove the correct record, please tell us your full legal name as it appears on your records and the ZIP code of your current address.",
  },
  {
    id: "verify-4",
    truth: "verification_required",
    requestedFields: [],
    subject: "Re: Your privacy request",
    body: "To protect your account we need to verify your identity. Please reply with a clear photo of a government issued ID, such as a driver's license or passport. We will delete the document once the check is complete.",
  },
  {
    id: "verify-5",
    truth: "verification_required",
    requestedFields: ["birth_year", "city", "state"],
    subject: "Please help us find your record",
    body: "Hi,\n\nWe could not match your request to a single listing. Could you send the year you were born and the city and state where you live? With those we can find and suppress the right record.\n\nThanks,\nData Rights Desk",
  },
  // completed
  {
    id: "done-1",
    truth: "completed",
    subject: "Your opt-out request has been completed",
    body:
      "Hello,\n\nWe have removed the listing for Jordan Example from Peoplelookup in response to your request " +
      REF +
      ". It may take up to 72 hours for search engine caches to clear.\n\nRegards,\nPeoplelookup Privacy",
  },
  {
    id: "done-2",
    truth: "completed",
    subject: "Re: Request to delete my personal information",
    body: "We confirm that your personal information has been deleted from our systems, except for records we are legally required to keep. You have also been added to our suppression list so we do not collect it again.",
  },
  {
    id: "done-3",
    truth: "completed",
    subject: "Do Not Sell request processed",
    body: "This message confirms that we have processed your Do Not Sell or Share request. We no longer sell or share your personal information. Your request was completed on October 3.",
  },
  {
    id: "done-4",
    truth: "completed",
    subject: `Suppression confirmed - ${REF}`,
    body: "Good news: the profile matching the details you supplied has been suppressed and will no longer appear in our search results. No further action is required.",
  },
  {
    id: "done-5",
    truth: "completed",
    subject: "Your data deletion request is complete",
    body:
      "Hi,\n\nThis is to let you know we have finished handling your deletion request. All personal data we held about you has been erased. If you have questions, reference " +
      REF +
      " in your reply.\n\nKind regards,\nCompliance Team",
  },
  // no_record
  {
    id: "norec-1",
    truth: "no_record",
    subject: `Re: Request to delete my personal information ${REF}`,
    body: "Hello,\n\nWe searched our systems using the name and email address you provided and found no records about you. There is nothing for us to delete.\n\nPrivacy Office",
  },
  {
    id: "norec-2",
    truth: "no_record",
    subject: "Your privacy request",
    body: "We have no data associated with this email address, so no action was taken. If you believe we hold information about you under another name or address, please send those details.",
  },
  {
    id: "norec-3",
    truth: "no_record",
    subject: "Re: Opt-out request",
    body: "After a thorough search we were unable to find a profile matching the information in your request. We do not appear to be listing you, so no removal is needed.",
  },
  {
    id: "norec-4",
    truth: "no_record",
    subject: "Result of your access and deletion request",
    body: "Dear requester,\n\nOur search returned zero matches for the identifiers you gave us. We therefore hold no personal information about you and have nothing to delete or sell.",
  },
  // rejected
  {
    id: "reject-1",
    truth: "rejected",
    subject: `Re: Request to delete my personal information ${REF}`,
    body: "We have reviewed your request and are unable to comply. The information you asked us to delete is publicly available government record data, which is exempt from deletion under applicable law.",
  },
  {
    id: "reject-2",
    truth: "rejected",
    subject: "Your request has been denied",
    body: "We are denying your request because we could not verify that you are the person named in it. We will not take further action on this request.",
  },
  {
    id: "reject-3",
    truth: "rejected",
    subject: "Re: Opt-out",
    body: "Requests sent on behalf of a person by an automated service are not accepted. We will not process this request. The data subject must contact us directly.",
  },
  {
    id: "reject-4",
    truth: "rejected",
    subject: "Regarding your deletion request",
    body: "We must decline your request. We retain this data as a consumer reporting agency under the Fair Credit Reporting Act and cannot remove it on request.",
  },
  // needs_form
  {
    id: "form-1",
    truth: "needs_form",
    subject: `Re: Request to delete my personal information ${REF}`,
    body: "Thanks for getting in touch. We cannot process privacy requests by email. Please submit your request using the form at https://www.brightlist.example.com/privacy/request and we will handle it from there.",
  },
  {
    id: "form-2",
    truth: "needs_form",
    subject: "How to opt out",
    body: "To opt out of the sale of your information, use our online portal: https://optout.datafolk.example.com. Email requests are not accepted and will not be actioned.",
  },
  {
    id: "form-3",
    truth: "needs_form",
    subject: "Re: Do Not Sell request",
    body: "Hello,\n\nAll consumer requests must be made through our privacy web form. Please visit the Your Privacy Choices link in the footer of our website and complete the form. Your email has not been processed.",
  },
  {
    id: "form-4",
    truth: "needs_form",
    subject: "Please use our request portal",
    body: "We received your message, but to protect your data we only accept deletion requests through our secure customer portal at https://portal.recordsco.example.net. Please create a request there.",
  },
  // unrelated
  {
    id: "unrel-1",
    truth: "unrelated",
    subject: "Our autumn sale starts now - up to 40% off",
    body: "Dear customer,\n\nDon't miss our biggest sale of the year. Use code AUTUMN40 at checkout for up to 40% off selected items. Shop now at https://shop.example.com.\n\nTo unsubscribe from marketing emails, click here.",
  },
  {
    id: "unrel-2",
    truth: "unrelated",
    subject: "Your invoice for October is ready",
    body: "Hi,\n\nYour invoice #20418 for $12.00 is now available in your billing dashboard. No action is needed; the amount will be charged to your card on file on October 15.\n\nThe Billing Team",
  },
  {
    id: "unrel-3",
    truth: "unrelated",
    subject: "Security alert: new sign-in from Linux",
    body: "We noticed a new sign-in to your account from a Linux device in Austin, TX. If this was you, you do not need to do anything. If not, secure your account here: https://accounts.example.com/security",
  },
  // unknown
  {
    id: "unknown-1",
    truth: "unknown",
    subject: "Re: your message",
    body: "Received, thanks. Forwarding to the right people.",
  },
  {
    id: "unknown-2",
    truth: "unknown",
    subject: `Re: Request ${REF}`,
    body: "Can you call us on the number below so we can discuss?\n\nRegards,\nSam\n\n--\nSent from my phone",
  },
  {
    id: "unknown-3",
    truth: "unknown",
    subject: "FW: FW: privacy",
    body: "see below\n\n> > ignore the earlier note\n> > let me know",
  },
];
