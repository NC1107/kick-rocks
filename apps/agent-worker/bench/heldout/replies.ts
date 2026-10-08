import { REF, type ReplyCase, reply } from "../reply-cases.js";

/**
 * Sixty-four replies kept out of tuning. They cover the same classes and styles as the dev set
 * with different senders and wording. Every name, address and domain is an invented or reserved one.
 */
export const HELDOUT_REPLY_CASES: ReplyCase[] = [
  // bounce
  reply(
    "held-bounce-1",
    "bounce",
    "plain",
    "Undelivered Mail Returned to Sender",
    `
This is the mail system at host smtp3.example.net.

I'm sorry to have to inform you that your message could not be delivered to one or more recipients. It's attached below.

<privacy@infoseeker.example.org>: host mx.infoseeker.example.org[192.0.2.77] said: 452 4.2.2 <privacy@infoseeker.example.org>: Recipient address rejected: Mailbox full (in reply to RCPT TO command)

<privacy@infoseeker.example.org>: unable to deliver after 5 days; giving up`,
    "the mail system says it could not deliver and gave up",
  ),
  reply(
    "held-bounce-2",
    "bounce",
    "html-text",
    "Delivery has failed to these recipients or groups",
    `
[https://ssl.example.com/mail/images/warning.png]

Your message wasn't delivered to dataprivacy@lookupland.example.com because the address couldn't be found, or is unable to receive mail. [https://support.example.com/mail/answer/6596?hl=en&ref=ndr]

LEARN MORE [https://support.example.com/mail/?p=NoSuchUser]

The response was:
550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos or unnecessary spaces.`,
    "a delivery failure notice for an address that does not exist",
  ),
  reply(
    "held-bounce-3",
    "bounce",
    "legal",
    "Mail delivery failed: returning message to sender",
    `
This message was created automatically by mail delivery software.

A message that you sent could not be delivered to one or more of its recipients. This is a permanent error. The following address(es) failed:

  rights@recordvault.example.net
    The recipient's server rejected the message as it did not pass sender policy checks (SPF).

CONFIDENTIALITY NOTICE: This email and any attachments are for the exclusive use of the intended recipient.`,
    "an automatic permanent failure notice, despite the legal footer",
  ),
  reply(
    "held-bounce-4",
    "bounce",
    "quoted-thread",
    "Undeliverable: Opt-out request",
    `
Delivery to the following recipient failed permanently:

     privacy-team@finderlist.example.com

Technical details of permanent failure:
The recipient server did not accept our requests to connect. Learn more at https://support.example.com/mail/answer/7720
[finderlist.example.com. 25: timed out]

----- Original message -----
> From: Jordan Example <jordan.example@example.com>
> To: privacy-team@finderlist.example.com
> Subject: Opt-out request
> Please delete my listing and confirm.`,
    "permanent failure because the recipient server could not be reached, with our request quoted",
  ),
  reply(
    "held-bounce-5",
    "bounce",
    "ticket",
    "Message not delivered",
    `
Your email to support@oldlistings.example.org was not delivered.

The mailbox is no longer in service. Please send future messages to help@oldlistings.example.org.

Reason: 550 5.2.1 Mailbox disabled, not accepting messages`,
    "the mailbox is disabled and the message was not delivered",
  ),
  reply(
    "held-bounce-6",
    "bounce",
    "plain",
    "Returned mail: User unknown",
    `
The original message was received at Wed, 7 Oct 2026 13:41:02 -0500

   ----- The following addresses had permanent fatal errors -----
<dpo@peoplemap.example>
    (reason: 550 5.1.1 User unknown)

   ----- Transcript of session follows -----
550 5.1.1 <dpo@peoplemap.example>... User unknown`,
    "a permanent delivery failure",
  ),

  // auto_ack
  reply(
    "held-ack-1",
    "auto_ack",
    "autoresponder",
    "Out of office until Monday",
    `
Hello,

I am currently out of the office and will return on Monday, October 12. I will have limited access to email and will respond to your message when I return.

If this is urgent, please call the main office.

Thanks,
Gregory Pell`,
    "an out-of-office reply with no decision",
  ),
  reply(
    "held-ack-2",
    "auto_ack",
    "ticket",
    `Re: Request ${REF} [Case #CR-118204]`,
    `
Thank you for contacting Lookupland Customer Care. We have created case CR-118204 for your inquiry.

Please quote this number in any further correspondence. We aim to respond to all cases within 10 business days.

Please note: this is an automated response and replies to it are not monitored.`,
    "a case-created notice with a response time estimate and no decision",
  ),
  reply(
    "held-ack-3",
    "auto_ack",
    "legal",
    "Your request has been logged",
    `
We have logged your request under the Virginia Consumer Data Protection Act. Under the Act we must respond within forty-five (45) days of receipt. We may extend that period by forty-five days when reasonably necessary, in which case we will tell you.

We will contact you if we need more information to verify your identity. This acknowledgement does not mean that we have accepted or refused the request.`,
    "an acknowledgement that explicitly accepts and refuses nothing",
  ),
  reply(
    "held-ack-4",
    "auto_ack",
    "html-text",
    "We got your message",
    `
[https://img.example.com/peoplemap/banner.jpg]

Hi,

Thanks for reaching out to PeopleMap. This is a quick note to let you know we've got your message. Our team reads every email, and you can expect a reply within 3 to 5 business days.

In the meantime, check out our FAQs [https://help.peoplemap.example/faq?utm_campaign=autoreply&utm_content=faq] or follow us [https://social.example.com/peoplemap].

Please don't reply to this email. It was sent by an automated system.`,
    "an automated note that the message arrived",
  ),
  reply(
    "held-ack-5",
    "auto_ack",
    "quoted-thread",
    "Automatic reply: Delete my data",
    `
I am away from my desk and checking email only occasionally until October 14. I will reply to your message on my return.

> From: Jordan Example
> Sent: Tuesday, October 6, 2026 8:30 AM
> Subject: Delete my data
> Please delete all my personal information and tell me when it has been done.`,
    "an away message that decides nothing",
  ),
  reply(
    "held-ack-6",
    "auto_ack",
    "autoresponder",
    "Thank you for your privacy inquiry",
    `
Thank you for your message to the Privacy Office. We have received it and will review it. A privacy specialist will write to you after the review. Please keep the reference ${REF} for your records.

This automatic message is not a response to your request.`,
    "an automatic message that says it is not a response",
  ),

  // confirmation_link
  reply(
    "held-link-1",
    "confirmation_link",
    "odd-link",
    "Finish removing your listing",
    `
Hi Jordan,

You are one step from having your listing taken down. Follow this link to authorize the removal:

https://remove.infoseeker.example.org/authorize?r=KR7QX4M2&t=19ab4c

The link works once and stops working after 24 hours.`,
    "asks the person to follow a link to authorize the removal",
  ),
  reply(
    "held-link-2",
    "confirmation_link",
    "odd-link",
    "Validate this email address",
    `
We received an opt-out request that lists this email address.

To validate the address and start processing, open the link below:
https://privacy.lookupland.example.com/validate/ZK81-77QP

No other action is required.`,
    "asks to open a link to validate the address",
  ),
  reply(
    "held-link-3",
    "confirmation_link",
    "html-text",
    "Please verify your request",
    `
[https://cdn.example.com/recordvault/logo.svg]

VERIFY YOUR OPT-OUT

Hello,

Click the button to verify that you made this request.

[ Yes, this was me ] [https://track.example.com/r?u=https%3A%2F%2Frecordvault.example.net%2Fverify%2F55ab&c=8812]

If you did not make this request you can ignore this message.

Recordvault, 1 Example Way. Privacy [https://recordvault.example.net/privacy] | Unsubscribe [https://recordvault.example.net/unsub]`,
    "asks to click a button to verify that the person made the request",
  ),
  reply(
    "held-link-4",
    "confirmation_link",
    "quoted-thread",
    `Re: Data deletion request ${REF}`,
    `
Hi,

Thanks for getting in touch. We cannot go ahead until you click the link in this email. Please do so within 3 days:

https://dsar.finderlist.example.com/c/e41b9

Kind regards,
Finderlist Privacy

On 10/06/2026 9:00 AM, Jordan Example wrote:
> Delete all data you hold on me, and confirm. I am a Texas resident.`,
    "the only ask is to click a link; the quoted text is our own request",
  ),
  reply(
    "held-link-5",
    "confirmation_link",
    "odd-link",
    "Your request is on hold - action needed",
    `
Request ${REF} is paused.

Resume it now: https://privacy.peoplemap.example/resume/77310

After you click Resume we will continue processing and you will not need to do anything else.`,
    "asks to click Resume to continue, a click-only ask",
  ),
  reply(
    "held-link-6",
    "confirmation_link",
    "legal",
    "Email confirmation required for your request",
    `
In accordance with our verification procedures for requests to opt out, we require confirmation that you control the email address from which the request was sent. Please confirm by selecting the following link: https://compliance.oldlistings.example.org/confirm?id=4491-AA.

Requests not confirmed within seven (7) days will be closed without further notice.`,
    "legal wording whose only ask is to select a link to confirm",
  ),
  reply(
    "held-link-7",
    "confirmation_link",
    "other-people",
    "Is this your request? Pat Example added your name",
    `
Hi Jordan,

Someone asked us to remove a listing for Pat Example and named you as a relative who should also be removed. We only act for you if you say so.

Click here to agree to the removal of your own listing: https://remove.recordvault.example.net/agree/81220

If you do not click, we will leave your listing as it is.`,
    "asks the person to click a link to agree to the removal; the other person is incidental",
  ),

  // verification_required
  reply(
    "held-verify-1",
    "verification_required",
    "id-request",
    "We need to confirm who you are",
    `
Thank you for your request. As an extra safeguard we ask every requester to attach a photo of a government issued ID (driver's license, state ID or passport). A recent utility bill with your name and address is also accepted.

Once we have checked it we will process your request and delete the file.`,
    "asks for an ID document or a bill, neither a profile field",
    [],
  ),
  reply(
    "held-verify-2",
    "verification_required",
    "legal",
    "Verification of consumer request",
    `
To verify your request under the Colorado Privacy Act, please provide the following, which we will compare with the information we hold: (1) the year you were born, and (2) the city and state of your current address.

We will not use this information for any other purpose, and will delete it after verification.`,
    "asks for a birth year, a city and a state",
    ["birth_year", "city", "state"],
  ),
  reply(
    "held-verify-3",
    "verification_required",
    "ticket",
    "[Ticket #55310] More information needed",
    `
##- Please type your reply above this line -##

Hi Jordan,

We could not match the email address in your request to an account. Please reply with the full name that appears on your account so that we can search for it.

Thanks,
Sam from Lookupland Support`,
    "asks for the full name on the account",
    ["full_name"],
  ),
  reply(
    "held-verify-4",
    "verification_required",
    "partial",
    "Your opt-out: partly done",
    `
We have taken your listing out of public search results. To delete the underlying record from our database we must also confirm your identity. Please send the full mailing address (street, city, state and ZIP code) that appears on the record, and your date of birth.

Until we hear from you the record stays on file.`,
    "partial progress, and asks for a full address and date of birth",
    ["street", "city", "state", "zip", "date_of_birth"],
  ),
  reply(
    "held-verify-5",
    "verification_required",
    "quoted-thread",
    "Re: Please remove my profile",
    `
Hi,

We found your profile, but the form you used did not include a link to it. Please send the web address of the listing page you want removed.

Thanks,
Support

> On Wed, Oct 7, 2026 at 11:15 AM Jordan Example wrote:
> Please remove my profile from your website and confirm by email.`,
    "asks for the web address of the listing",
    ["record_url"],
  ),
  reply(
    "held-verify-6",
    "verification_required",
    "other-people",
    `Re: Request ${REF}`,
    `
Hello Jordan,

The email you used is also listed on the profile of Pat Example. We cannot act on a profile that belongs to a different person, and we cannot tell whether you are that person. Please reply with the phone number on your profile so that we can check it is yours.`,
    "asks for the phone number to check it is the right person; another person is mentioned",
    ["phone"],
  ),
  reply(
    "held-verify-7",
    "verification_required",
    "html-text",
    "Complete identity verification",
    `
[https://cdn.example.com/finderlist/shield.png]

HELLO,

We received your request to delete your data but cannot process it until we have verified your identity.

Reply to this email and include your date of birth and the ZIP code of your address. [https://help.finderlist.example.com/verification?ref=7781]

Requests that are not verified within 14 days will be closed.`,
    "asks for a date of birth and a ZIP code",
    ["date_of_birth", "zip"],
  ),
  reply(
    "held-verify-8",
    "verification_required",
    "id-request",
    "Notarized statement needed",
    `
We can only act on a deletion request after your identity is verified to a high degree of certainty. Please return the attached declaration form, signed in front of a notary public, with a copy of your photo ID.`,
    "asks for a notarized declaration and an ID, none of them profile fields",
    [],
  ),

  // completed
  reply(
    "held-done-1",
    "completed",
    "plain",
    `Re: ${REF}`,
    `
Hello,

We have processed your request. The profile you identified has been permanently removed from Infoseeker and will not be restored. A suppression flag keeps it from being added again.

Regards,
Infoseeker Privacy`,
    "the profile was removed",
  ),
  reply(
    "held-done-2",
    "completed",
    "ticket",
    "[Ticket #55872] Request resolved",
    `
##- Please type your reply above this line -##

Your request has been resolved. We deleted your personal data from our systems and confirmed that no copies remain in active use. Backups are overwritten within 35 days.

If you believe this ticket was closed in error, reply and we will reopen it.`,
    "the data was deleted and the ticket was resolved",
  ),
  reply(
    "held-done-3",
    "completed",
    "legal",
    "Confirmation of completion of your request",
    `
Further to your request received on October 2, 2026, we confirm that we have deleted the personal information we hold about you, save for information that we are required to retain under applicable law, including records of transactions retained for tax purposes. Such information is restricted to those purposes.

We have also directed our service providers to delete your personal information from their records.`,
    "the data was deleted apart from legally required records",
  ),
  reply(
    "held-done-4",
    "completed",
    "partial",
    "Your request is complete",
    `
We have deleted your account and the personal data attached to it. We could not delete the entry in the public property records we index, because the county publishes it. We have hidden that entry from our site so it no longer appears in search.

Nothing further is needed from you.`,
    "deleted the data and hid the public entry",
  ),
  reply(
    "held-done-5",
    "completed",
    "html-text",
    "Opt-out confirmed",
    `
[https://cdn.example.com/lookupland/hdr.png]

You're all set.

Your opt-out has been processed and your information has been removed from Lookupland. Please allow up to 7 days for the change to reach partner sites. [https://help.lookupland.example.com/partners]

Keep this email for your records. Reference: ${REF}.

(c) 2026 Lookupland LLC. Unsubscribe [https://lookupland.example.com/u/3321]`,
    "the opt-out was processed and the information removed",
  ),
  reply(
    "held-done-6",
    "completed",
    "other-people",
    "Update on the removal of your listing",
    `
Hi Jordan,

The listing for Jordan Example in Austin has been taken down. The listing for your neighbor, Riley Sample, at the same address was not part of your request, so we left it in place. Riley can ask us separately.

Thanks for your patience.`,
    "the requested listing was taken down; a neighbor's listing was left alone",
  ),
  reply(
    "held-done-7",
    "completed",
    "no-sale-denial",
    "Your Do Not Sell or Share request",
    `
We do not sell the personal information of people we know to be under 16, and we do not share it for cross-context advertising. Your preference has still been recorded and is now applied to your profile. This took effect on October 7, 2026.`,
    "the preference was recorded and applied",
  ),

  // no_record
  reply(
    "held-norec-1",
    "no_record",
    "plain",
    "Re: Delete my data",
    `
We searched for jordan.example@example.com and the name and address you gave us. We do not have any data about you, so there is nothing to delete.`,
    "searched and found no data",
  ),
  reply(
    "held-norec-2",
    "no_record",
    "legal",
    "Response to consumer request",
    `
We have received your request. We do not collect, maintain or sell personal information about consumers who have not created an account with us or purchased from us. A search for the details supplied returned no matching account or purchase. We are therefore unable to identify any personal information relating to you.`,
    "no matching information was found",
  ),
  reply(
    "held-norec-3",
    "no_record",
    "ticket",
    "[Ticket #56004] No matching profile",
    `
Hi,

We could not find a profile that matches the details in your request. We looked under the name and the city you gave. As there is no profile, we have closed the request with no change.

You are welcome to write again if you think you are listed under another name.`,
    "no matching profile exists",
  ),
  reply(
    "held-norec-4",
    "no_record",
    "no-sale-denial",
    "About your opt-out",
    `
We do not sell data and we have no information about you in our systems. A search by name, email address and city produced nothing, so there is nothing to opt out of.`,
    "has no information about the person at all",
  ),
  reply(
    "held-norec-5",
    "no_record",
    "other-people",
    "Re: Removal",
    `
Hello,

Your relative Pat Example has a listing with us, but you asked about Jordan Example, and we have no listing for that name. We did not look at or change Pat's listing. If you would like Pat's listing removed, Pat needs to contact us.`,
    "no listing exists for the person; a relative's listing was not touched",
  ),
  reply(
    "held-norec-6",
    "no_record",
    "quoted-thread",
    "RE: Opt-out request",
    `
No record found.

> On Oct 7, 2026, Jordan Example wrote:
> Hello, I would like my information removed from your database, including
> my address history and relatives. Please confirm when it's done.`,
    "no record was found",
  ),

  // rejected
  reply(
    "held-reject-1",
    "rejected",
    "no-sale-denial",
    "Re: Opt out of sale",
    `
We do not sell your personal information. Because there is no sale to opt out of, we have not taken any action. Your request is closed.`,
    "closes the request with no action because it does not sell data",
  ),
  reply(
    "held-reject-2",
    "rejected",
    "legal",
    "Notice regarding your request",
    `
We have reviewed your request to delete. The information you describe is a public record that we are authorized to publish under the First Amendment and applicable state law. For that reason we decline to delete it. We will not change this listing.

This decision is final.`,
    "declines to delete public records",
  ),
  reply(
    "held-reject-3",
    "rejected",
    "ticket",
    "[Ticket #56213] Request declined",
    `
Hi,

We are unable to fulfil this request. You have already made more than two requests in the last twelve months, and we only act on two per year. Your ticket is closed.`,
    "declines because of a request limit",
  ),
  reply(
    "held-reject-4",
    "rejected",
    "plain",
    "Re: Delete my information",
    `
We will not delete your information. It is needed to prevent fraud and to comply with our legal duties.`,
    "refuses to delete",
  ),
  reply(
    "held-reject-5",
    "rejected",
    "partial",
    "Your request - outcome",
    `
We have reviewed your request. We cannot delete your data because it is covered by a legal hold. We can only suppress your email address from marketing, which we have done, but the underlying record cannot be deleted or removed from search. Your request to delete is therefore denied.`,
    "the deletion was denied; only marketing suppression was done",
  ),
  reply(
    "held-reject-6",
    "rejected",
    "quoted-thread",
    "Re: Remove my profile",
    `
Sorry, we don't do that. Profiles are only removed by court order.

> On Wed, Oct 7, 2026, Jordan Example wrote:
> Please remove my profile from your site. I have asked once before and would
> like it done this week.`,
    "refuses to remove the profile",
  ),

  // needs_form
  reply(
    "held-form-1",
    "needs_form",
    "plain",
    "Re: Opt out",
    `
Hello,

We are unable to action opt-out requests sent by email. Please complete the form at https://optout.infoseeker.example.org/start and we will process your request.`,
    "must use the form",
  ),
  reply(
    "held-form-2",
    "needs_form",
    "legal",
    "How to submit your privacy request",
    `
Requests relating to personal information must be submitted using the Privacy Request Portal at https://privacy.recordvault.example.net. The portal lets us authenticate you and keep a record of your request. We are not able to accept requests by email, telephone or post.`,
    "must use the portal",
  ),
  reply(
    "held-form-3",
    "needs_form",
    "ticket",
    "[Ticket #56500] Please use our web form",
    `
Hi,

This helpdesk cannot handle data deletion or opt-out requests. Please submit them using the Data Subject Request form: https://support.lookupland.example.com/dsr-form. Our team will pick them up from there.`,
    "must submit using the form",
  ),
  reply(
    "held-form-4",
    "needs_form",
    "autoresponder",
    "Auto-reply: privacy requests",
    `
You have written to an address that does not accept privacy requests. To make a request to know, delete or opt out, fill in the form on our Your Privacy Choices page: https://www.peoplemap.example/privacy-choices

Messages sent here are deleted unread.`,
    "an auto-reply that points to the privacy choices form",
  ),
  reply(
    "held-form-5",
    "needs_form",
    "html-text",
    "Submit your request online",
    `
[https://cdn.example.com/oldlistings/logo.png]

Hi,

To remove a listing you need to use our online removal tool. Go to the removal tool [https://oldlistings.example.org/remove?src=email&cid=7712], find your listing and select Remove. We cannot do it for you by email.

Thanks,
Old Listings Team`,
    "must use the online removal tool",
  ),
  reply(
    "held-form-6",
    "needs_form",
    "other-people",
    "Re: Remove Jordan Example and Pat Example",
    `
Hello,

You asked us to remove listings for yourself and for Pat Example. We do not accept removal requests by email, and each person must submit their own request. Please go to https://optout.finderlist.example.com/ and complete the form once for yourself. Pat will need to do the same.`,
    "each person must submit the form themselves",
  ),

  // unrelated
  reply(
    "held-unrel-1",
    "unrelated",
    "plain",
    "Your monthly statement is ready",
    `
Your October statement for the account ending 4417 is now available. Sign in to view it: https://bank.example.com/statements

For your security we never include account numbers in email.`,
    "a bank statement notice",
  ),
  reply(
    "held-unrel-2",
    "unrelated",
    "html-text",
    "Weekly digest: 5 stories you may have missed",
    `
[https://cdn.example.com/news/masthead.png]

THE WEEKLY

1. Local council backs new bike lanes [https://news.example.com/s/881?utm_source=digest]
2. Why your electric bill is rising [https://news.example.com/s/882?utm_source=digest]
3. Ten fall recipes [https://news.example.com/s/883?utm_source=digest]

Update your preferences [https://news.example.com/prefs] | Unsubscribe [https://news.example.com/unsub]`,
    "a news digest",
  ),
  reply(
    "held-unrel-3",
    "unrelated",
    "plain",
    "Reminder: dentist appointment tomorrow",
    `
This is a reminder of your appointment on Thursday, October 8 at 2:30 PM with Dr. Singh at Lakeside Dental. Reply C to confirm or call 555-0142 to reschedule.`,
    "an appointment reminder",
  ),
  reply(
    "held-unrel-4",
    "unrelated",
    "legal",
    "Update to our terms of service",
    `
We are updating our Terms of Service and Privacy Policy, effective November 1, 2026. The changes explain how we process your data to improve our products. You do not need to take any action. By continuing to use the service after that date you accept the updated terms.

Read the changes: https://example.com/terms/2026`,
    "a notice of a terms change, not a reply to a request",
  ),
  reply(
    "held-unrel-5",
    "unrelated",
    "other-people",
    "Casey Example wants to connect",
    `
Hi Jordan,

Casey Example, Product Designer at Brightside Studio, would like to add you to their professional network.

Accept: https://network.example.com/i/55812
View Casey's profile: https://network.example.com/in/casey-example

You are receiving connection request emails. Unsubscribe.`,
    "a network invitation from another person",
  ),
  reply(
    "held-unrel-6",
    "unrelated",
    "ticket",
    "[Ticket #57310] Your password has been changed",
    `
Hi Jordan,

The password for your Datavista account was changed on October 7, 2026 at 3:12 PM CT. If this was you, no further action is needed. If it was not, reset your password immediately: https://accounts.example.com/reset`,
    "an account security notice, not about a privacy request",
  ),

  // unknown
  reply(
    "held-unknown-1",
    "unknown",
    "plain",
    "Re: Re: request",
    "Got it",
    "a two word message that decides nothing",
  ),
  reply(
    "held-unknown-2",
    "unknown",
    "plain",
    "Fwd: Fwd: please advise",
    `
Can you take this one?

---------- Forwarded message ---------
From: records@oldlistings.example.org
Subject: question

[message body removed]`,
    "a forward with the body removed",
  ),
  reply(
    "held-unknown-3",
    "unknown",
    "plain",
    `Re: ${REF}`,
    `
Call me when you get a chance. We should talk this through before I reply in writing. My direct line is below.

Regards,
Sam
(512) 555-0199`,
    "asks for a call and says nothing about the request",
  ),
  reply(
    "held-unknown-4",
    "unknown",
    "quoted-thread",
    "RE: Re: privacy",
    `
Agreed, let's wait for legal.

> > Should we respond to this?
> I don't know. The last one was handled by Mia.
> > It came in through the general inbox.`,
    "an internal exchange that decides nothing",
  ),
  reply(
    "held-unknown-5",
    "unknown",
    "plain",
    "Re: your question",
    `
Yes.`,
    "a one word answer that does not say what it refers to",
  ),
  reply(
    "held-unknown-6",
    "unknown",
    "plain",
    "(no subject)",
    `
.

Sent from my phone`,
    "contains no content",
  ),
];
