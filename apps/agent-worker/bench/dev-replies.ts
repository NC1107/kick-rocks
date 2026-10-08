import { REF, type ReplyCase, reply } from "./reply-cases.js";

/**
 * Fifty-six more replies for tuning, written the way brokers and companies write: autoresponders,
 * ticket systems, legal boilerplate, quoted threads and mail converted from HTML. Every name,
 * address and domain is an invented or reserved one.
 */
export const DEV_EXTRA_REPLY_CASES: ReplyCase[] = [
  // bounce
  reply(
    "dev-bounce-1",
    "bounce",
    "plain",
    "Mail Delivery Subsystem: Returned mail",
    `
The original message was received at Tue, 6 Oct 2026 09:12:44 -0500
from relay2.example.net [203.0.113.40]

   ----- The following addresses had permanent fatal errors -----
<optout@datahub.example.com>
    (reason: 554 5.7.1 Message rejected due to local policy)

   ----- Transcript of session follows -----
... while talking to mx.datahub.example.com.:
>>> DATA
<<< 554 5.7.1 Message rejected due to local policy. Please visit the postmaster pages.
554 5.0.0 Service unavailable`,
    "a mail system reports permanent failure to deliver our message",
  ),
  reply(
    "dev-bounce-2",
    "bounce",
    "html-text",
    "Undeliverable: Request to delete my personal information",
    `
Your message to privacy@brightlist.example.org couldn't be delivered.

The group privacy@brightlist.example.org doesn't exist or you don't have permission to send to it. [https://support.example.org/mail/ndr?code=5.1.1&ref=7c1f9a]

Contact your email admin for help.

Diagnostic information for administrators:
Generating server: relay2.example.net
privacy@brightlist.example.org
Remote Server returned '550 5.1.1 RESOLVER.ADR.RecipNotFound; not found'

Original message headers:
Received: from relay2.example.net ([203.0.113.40]) by mx.brightlist.example.org`,
    "an NDR from the mail server says the recipient was not found",
  ),
  reply(
    "dev-bounce-3",
    "bounce",
    "plain",
    "Delivery Status Notification (Failure)",
    `
Address not found

Your message wasn't delivered to dpo@peopletrace.example because the domain peopletrace.example couldn't be found. Check for typos or unnecessary spaces and try again.

The response from the remote server was:
DNS Error: Domain name not found`,
    "the mail system could not find the recipient's domain",
  ),
  reply(
    "dev-bounce-4",
    "bounce",
    "quoted-thread",
    "Returned mail: see transcript for details",
    `
This message was created automatically by mail delivery software.

A message that you sent could not be delivered to one or more of its recipients. This is a permanent error. The following address failed:

  removals@listfinder.example.com
    SMTP error from remote mail server after RCPT TO:<removals@listfinder.example.com>:
    host mail.listfinder.example.com [198.51.100.23]: 550 Mailbox disabled

------ This is a copy of the message, including all the headers ------

> Subject: Request to delete my personal information
> I am writing to ask that you delete all personal information you hold about me
> and stop selling it. Please confirm once this is done.`,
    "an automatic delivery failure notice that quotes our request below it",
  ),
  reply(
    "dev-bounce-5",
    "bounce",
    "legal",
    "Message blocked",
    `
Your message to optout@marketgrid.example.net was blocked by the recipient's content filter and was not delivered.

Error code: 5.7.1 Spam message rejected. If you believe this is an error, contact the postmaster of the receiving domain.

This notice is confidential and intended only for the sender of the blocked message.`,
    "the message was blocked and not delivered",
  ),
  reply(
    "dev-bounce-6",
    "bounce",
    "plain",
    "Failure notice",
    `
Hi. This is the qmail-send program at mail.recordcheck.example.org.
I'm afraid I wasn't able to deliver your message to the following addresses.
This is a permanent error; I've given up. Sorry it didn't work out.

<support@recordcheck.example.org>:
Sorry, no mailbox here by that name. (#5.1.1)`,
    "the mail server gave up delivering to a mailbox that does not exist",
  ),

  // auto_ack
  reply(
    "dev-ack-1",
    "auto_ack",
    "autoresponder",
    "Automatic reply: Request to delete my personal information",
    `
Thank you for your email. I am out of the office until October 20 with limited access to email. If your matter is urgent, please contact my colleague Dana Whitfield at dana.whitfield@peoplewise.example.com.

Kind regards,
Marcus Lindqvist
Privacy Counsel`,
    "an out-of-office reply with no decision on the request",
  ),
  reply(
    "dev-ack-2",
    "auto_ack",
    "ticket",
    "[Ticket #48213] We've received your request",
    `
##- Please type your reply above this line -##

Your request (48213) has been received and is being reviewed by our support staff.

To add additional comments, reply to this email.

Request #48213 "Request to delete my personal information"

This email is a service from Datavista Support.`,
    "a ticket system confirms receipt and decides nothing",
  ),
  reply(
    "dev-ack-3",
    "auto_ack",
    "legal",
    "We acknowledge receipt of your privacy request",
    `
This is an automated acknowledgement. We received your request under the California Consumer Privacy Act on October 6, 2026. Your reference is PR-20931.

We will respond within 45 calendar days of receipt, and may extend that period once by a further 45 days where reasonably necessary. Please do not send duplicate requests, as this will not speed up the response.

Nothing in this message is a decision on your request.`,
    "an automated acknowledgement that explicitly says it is not a decision",
  ),
  reply(
    "dev-ack-4",
    "auto_ack",
    "html-text",
    "Thanks for contacting Brightdata Support!",
    `
[https://cdn.example.com/brightdata/logo.png]

Hi there,

Thanks for getting in touch. We got your message and a member of our team will be with you shortly. Our average response time is 2 business days.

Browse our help center [https://help.brightdata.example.com/?utm_source=autoreply&utm_medium=email&utm_campaign=ack_2026]

Please do not reply to this message. It was sent from an unmonitored address.

You are receiving this email because you contacted us. Unsubscribe [https://brightdata.example.com/unsub?u=88213&t=ack]`,
    "an unmonitored auto-reply that only says the message arrived",
  ),
  reply(
    "dev-ack-5",
    "auto_ack",
    "quoted-thread",
    "Auto-Reply: Please delete my data",
    `
This is an automatic response. Your email was received by the Data Rights inbox. You do not need to send it again.

-----Original Message-----
> From: Jordan Example
> Subject: Please delete my data
> Please delete all of my data and confirm by email once it has been removed.
> I do not consent to the sale of my personal information.`,
    "an automatic response that only quotes our request back",
  ),
  reply(
    "dev-ack-6",
    "auto_ack",
    "ticket",
    `Case 0041927 opened - ${REF}`,
    `
Hello,

A case has been opened for your inquiry. Case number: 0041927. Priority: Normal. Status: New.

You can follow progress in the customer portal. A representative will review your case in the order it was received. This is an automated notification; replies to this address are not read.

Peoplewise Customer Care`,
    "a case-opened notice from a ticket system, with no decision",
  ),

  // confirmation_link
  reply(
    "dev-link-1",
    "confirmation_link",
    "odd-link",
    "One more tap to finish",
    `
Hi,

Your removal is nearly done. Tap the button below to finalize it:

https://privacy.datavista.example.com/f/9KJ2-ML8Q-2203

If you did not ask for this, ignore this message and nothing will happen.`,
    "the only ask is to tap a link to finalize the request",
  ),
  reply(
    "dev-link-2",
    "confirmation_link",
    "odd-link",
    `Please acknowledge request ${REF}`,
    `
We received a request to remove the listing for Jordan Example.

Please acknowledge this request by visiting the secure portal link below within 48 hours. If it is not acknowledged, the request will be cancelled and no action will be taken.

https://portal.peopletrace.example/ack/KR7QX4M2?src=mail

Thank you,
Records Management`,
    "asks the sender to visit a link to acknowledge the request",
  ),
  reply(
    "dev-link-3",
    "confirmation_link",
    "odd-link",
    "Activate your suppression",
    `
Your opt-out request is queued but not active yet.

Activate your suppression: https://optout.listfinder.example.com/activate?token=3f9c1e7a22b0

Suppressions that are not activated within 72 hours are discarded.`,
    "asks to activate the suppression with a link, which is a click-to-confirm",
  ),
  reply(
    "dev-link-4",
    "confirmation_link",
    "html-text",
    "Confirm your privacy request",
    `
[https://img.example.com/t/open.gif?id=7712&u=0]

PRIVACY CENTER

You (or someone using your email address) submitted a request to remove personal information.

[ CONFIRM MY REQUEST ] [https://click.example.com/track/c?u=https%3A%2F%2Fprivacy.marketgrid.example.net%2Fconfirm%2Fabc123&s=4412&e=9]

Button not working? Paste this link into your browser:
https://privacy.marketgrid.example.net/confirm/abc123

(c) 2026 Marketgrid Inc. 100 Example Plaza. View in browser [https://click.example.com/track/v?s=4412]`,
    "a button and link to confirm the request",
  ),
  reply(
    "dev-link-5",
    "confirmation_link",
    "odd-link",
    "Approve removal",
    `
Request ${REF} is waiting for your approval.

Click Approve to authorize us to act on this request. No reply is needed.

Approve: https://records.recordcheck.example.org/approve/28771

Click Decline if this was not you: https://records.recordcheck.example.org/decline/28771`,
    "asks to click Approve to authorize the request",
  ),
  reply(
    "dev-link-6",
    "confirmation_link",
    "quoted-thread",
    `Re: Request to delete my personal information ${REF}`,
    `
Hello,

Thank you for your request. Before we proceed, please click the link below so that we know this address belongs to you:

https://privacy.brightlist.example.org/v/5d41402abc4b

Best,
Data Rights Team

On Tue, Oct 6, 2026 at 9:12 AM Jordan Example <jordan.example@example.com> wrote:
> Please delete my personal information and confirm when done.
> Reference: ${REF}`,
    "the new text only asks for a click on a link; the quoted part is our own request",
  ),
  reply(
    "dev-link-7",
    "confirmation_link",
    "odd-link",
    "Confirme su solicitud",
    `
Hola,

Para completar su solicitud de eliminacion de datos personales, haga clic en el siguiente enlace dentro de 24 horas:

https://privacidad.datavista.example.com/confirmar/77120

Si usted no hizo esta solicitud, ignore este mensaje.

To complete your request, click the link above within 24 hours.`,
    "asks the person to click a link to complete the request, in Spanish and English",
  ),

  // verification_required
  reply(
    "dev-verify-1",
    "verification_required",
    "id-request",
    "Identity verification needed",
    `
Before we can act on your request we must confirm who you are. Please reply with a clear photo of a current driver's license or passport, with the license number and any photo cropped as you prefer. We delete the image once the check is done.`,
    "asks for a copy of an ID document, which is not a profile field",
    [],
  ),
  reply(
    "dev-verify-2",
    "verification_required",
    "legal",
    `Request ${REF}: verification of identity`,
    `
Under the California Consumer Privacy Act we must verify that the person making a request is the consumer to whom the information relates. We match at least two data points we already hold.

Please reply with your full name and the ZIP code of your current address. We will use them only to verify your identity and for no other purpose.

If we cannot verify your identity within 45 days we will deny the request.`,
    "asks for two identity details before acting",
    ["full_name", "zip"],
  ),
  reply(
    "dev-verify-3",
    "verification_required",
    "ticket",
    "[Ticket #51877] Action required: verify your identity",
    `
##- Please type your reply above this line -##

Hi Jordan,

To protect your account we need to verify it is you. Please reply to this ticket with the mobile phone number linked to your account and we will send a one time code to it.

Thanks,
Priya
Datavista Trust & Safety`,
    "asks for the phone number on the account to verify the person",
    ["phone"],
  ),
  reply(
    "dev-verify-4",
    "verification_required",
    "quoted-thread",
    "Re: Opt out request",
    `
Thanks for writing. We have several people with that name and cannot tell which listing is yours. Please send the street address and the city of the listing so we can find it.

Regards,
Opt-out desk

> On Oct 6, Jordan Example wrote:
> I want to opt out of your people search site and have my listing removed.
> Please confirm by email when it is complete.`,
    "asks for a street address and a city to find the right listing",
    ["street", "city"],
  ),
  reply(
    "dev-verify-5",
    "verification_required",
    "other-people",
    "We found more than one match",
    `
Hello Jordan,

We found three listings under your name: Jordan Example in Austin, TX, Jordan Example in Dallas, TX and Jordan Example in Plano, TX. We also found a relative, Pat Example, linked to the first two.

We do not want to remove the wrong person. Please tell us the street address on the listing you want removed and we will take it down.`,
    "several people match, and it asks for the street address to pick one",
    ["street"],
  ),
  reply(
    "dev-verify-6",
    "verification_required",
    "partial",
    "Almost there",
    `
We have started your opt-out and removed the listing from public search. To finish the deletion of the underlying record we also need your date of birth and a recent utility bill or bank statement showing your name and address.

The record stays on hold until we hear from you.`,
    "partial progress, but asks for a date of birth and a document before finishing",
    ["date_of_birth"],
  ),
  reply(
    "dev-verify-7",
    "verification_required",
    "html-text",
    "Verify your identity to continue",
    `
[https://cdn.example.com/trustid/shield.png]

IDENTITY CHECK REQUIRED

We cannot process your data deletion request until your identity is verified. Reply to this email with the last four digits of your Social Security number, or upload a government ID at [https://verify.trustid.example.com/u/66019].

This request expires in 7 days. Need help? Visit our help center [https://help.trustid.example.com].`,
    "asks for a Social Security number fragment or an ID upload, neither a profile field",
    [],
  ),

  // completed
  reply(
    "dev-done-1",
    "completed",
    "ticket",
    "[Ticket #50122] Solved: Request to delete my personal information",
    `
##- Please type your reply above this line -##

Hi Jordan,

We have removed the profile associated with jordan.example@example.com and deleted the personal data attached to it. Your ticket is now marked as solved.

If you have any further questions, simply reply to this message to reopen it.

Peoplewise Support`,
    "says the profile and its data have been removed",
  ),
  reply(
    "dev-done-2",
    "completed",
    "partial",
    "Your deletion request",
    `
We have deleted your personal information from our marketing database and from the people search product. We have retained a record of the transactions you made with us as required by tax law, for seven years, after which it will be deleted. It is not used for any other purpose.

No further action is needed from you.`,
    "the data was deleted, and only legally required transaction records are retained",
  ),
  reply(
    "dev-done-3",
    "completed",
    "no-sale-denial",
    "About your Do Not Sell request",
    `
We do not sell personal information in the way the law defines it. Even so, we have honored your request: your details have been added to our suppression list and will no longer be shared with advertising partners or used for marketing.

This was completed on October 8, 2026.`,
    "although it does not sell data, it confirms the opt-out was applied",
  ),
  reply(
    "dev-done-4",
    "completed",
    "html-text",
    "Your information has been removed",
    `
[https://cdn.example.com/listfinder/header.png]

Good news!

We removed your information from ListFinder. It can take up to 48 hours to disappear from search engines such as Google. [https://help.listfinder.example.com/search-engines]

View your confirmation [https://listfinder.example.com/optout/status/88123]

Questions? Contact privacy@listfinder.example.com`,
    "tells the person their information was removed",
  ),
  reply(
    "dev-done-5",
    "completed",
    "other-people",
    `Re: Removal request ${REF}`,
    `
Hello,

We removed the listing for Jordan Example (Austin, TX). As you asked, we also removed the two listings that named Pat Example and Casey Example as relatives of that person, because they showed your address.

Please note that other family members may have their own listings. We have not touched those.`,
    "the requested listings, and the ones naming relatives, were removed",
  ),
  reply(
    "dev-done-6",
    "completed",
    "quoted-thread",
    "RE: Opt-out request",
    `
Done. Your record has been suppressed.

Sent from my iPhone

> On Oct 5, 2026, at 4:02 PM, Jordan Example <jordan.example@example.com> wrote:
>
> Hello, please remove my information from your site. I have not agreed to it
> being published. Thanks.`,
    "a short note that the record was suppressed",
  ),

  // no_record
  reply(
    "dev-norec-1",
    "no_record",
    "legal",
    "Response to your privacy request",
    `
Dear Requester,

After a reasonable search of the systems in which we process personal information, we have been unable to locate any personal information that matches the details you provided. Accordingly there is nothing for us to delete or to opt you out of.

This response does not limit any other rights you may have.`,
    "searched and found nothing matching the person",
  ),
  reply(
    "dev-norec-2",
    "no_record",
    "ticket",
    "[Ticket #50788] We could not find an account",
    `
Hi,

We looked for an account or profile that uses jordan.example@example.com and found none. We do not hold any data under that address, so no deletion is needed.

If you used another email address, send it to us and we will look again.

Datavista Support`,
    "no account exists for the email address",
  ),
  reply(
    "dev-norec-3",
    "no_record",
    "other-people",
    "Re: Opt out of your database",
    `
Hello,

We do not have a record of you. We do hold a listing for a Jordan Examples in a different state, but its details do not match the ones you sent, so we have not changed it. We have nothing on file for the person you described.`,
    "nothing matches the person, and a different person's listing was left alone",
  ),
  reply(
    "dev-norec-4",
    "no_record",
    "quoted-thread",
    "Re: Delete my data",
    `
Nothing found under that name or email, sorry.

> -----Original Message-----
> From: Jordan Example
> Sent: Monday, October 5, 2026
> Subject: Delete my data
> Please delete everything you have on me.`,
    "reports nothing was found",
  ),

  // rejected
  reply(
    "dev-reject-1",
    "rejected",
    "no-sale-denial",
    "Re: Do Not Sell My Personal Information",
    `
Thank you for contacting us. We do not sell personal information, so your request does not apply to us and we will take no action on it.

Regards,
Compliance`,
    "declines to act because it says it does not sell data",
  ),
  reply(
    "dev-reject-2",
    "rejected",
    "legal",
    "Denial of request to delete",
    `
We are a consumer reporting agency regulated by the Fair Credit Reporting Act. Information we maintain is exempt from deletion requests under applicable privacy laws, and we are therefore unable to comply with your request to delete.

You may dispute the accuracy of any item in your file by writing to our consumer relations department.`,
    "explicitly denies the request to delete",
  ),
  reply(
    "dev-reject-3",
    "rejected",
    "plain",
    "Your request",
    `
We are legally required to retain these records for seven years and cannot honor your request. No data will be deleted at this time.`,
    "declines because of a retention duty",
  ),
  reply(
    "dev-reject-4",
    "rejected",
    "ticket",
    "[Ticket #49902] Closed: unable to process your request",
    `
Hi,

Your ticket has been closed. Our privacy rights process is open only to residents of California, Colorado, Connecticut and Virginia. As your address is outside those states, we are not able to fulfil your request.

This ticket will not be reopened.`,
    "closes the ticket and declines because of the person's state",
  ),
  reply(
    "dev-reject-5",
    "rejected",
    "legal",
    "Re: Opt out on behalf of a client",
    `
We do not accept opt-out or deletion requests submitted by third parties, authorized agents or removal services. Requests are processed only when made by the consumer personally.

Your request has been declined.`,
    "declines requests made by an agent or service",
  ),
  reply(
    "dev-reject-6",
    "rejected",
    "quoted-thread",
    "Re: Removal",
    `
No. We will not remove public records.

> On Tue, Oct 6, 2026 Jordan Example wrote:
> Please remove my listing from your website. It shows my home address and I would
> like it taken down immediately.`,
    "a plain refusal, with our request quoted",
  ),

  // needs_form
  reply(
    "dev-form-1",
    "needs_form",
    "plain",
    "Re: Delete my personal information",
    `
We do not process privacy requests by email. Please use our privacy portal to make your request: https://privacy.peoplewise.example.com/request

It takes about two minutes.`,
    "says requests must go through the portal",
  ),
  reply(
    "dev-form-2",
    "needs_form",
    "legal",
    "Exercising your privacy rights",
    `
To exercise your rights under the California Consumer Privacy Act, you must submit a verifiable consumer request through our Privacy Request Webform at https://www.brightlist.example.org/privacy/webform. Requests sent to this mailbox cannot be processed and are not logged as requests.

Brightlist Legal Department`,
    "requires the webform and says email requests are not processed",
  ),
  reply(
    "dev-form-3",
    "needs_form",
    "autoresponder",
    "Auto reply: submit your request using the form",
    `
This mailbox is not monitored for privacy requests. To have your information removed, complete the opt-out form on our site. Messages to this address will not be read.

Opt-out form: https://optout.datahub.example.com/form`,
    "an automatic reply that sends requests to the form",
  ),
  reply(
    "dev-form-4",
    "needs_form",
    "html-text",
    "Visit our Data Rights Center",
    `
[https://cdn.example.com/marketgrid/logo.png]

Hello,

We take your privacy seriously. To submit an access, deletion or opt-out request, visit our Data Rights Center [https://privacy.marketgrid.example.net/rights?utm_source=email&utm_medium=reply] and choose the request type that applies to you.

Requests made any other way cannot be verified.

(c) 2026 Marketgrid Inc.`,
    "tells the person to visit the Data Rights Center to submit the request",
  ),

  // unrelated
  reply(
    "dev-unrel-1",
    "unrelated",
    "plain",
    "Fall sale: 30% off everything this weekend",
    `
Hi there,

Our biggest sale of the season starts Friday. Take 30% off sitewide with code FALL30. Free shipping on orders over $50.

Shop now: https://shop.example.com/fall

You are receiving this because you subscribed. Unsubscribe: https://shop.example.com/unsub`,
    "a retail promotion",
  ),
  reply(
    "dev-unrel-2",
    "unrelated",
    "plain",
    "Your order #A-77213 has shipped",
    `
Good news! Your order has shipped and should arrive by Thursday, October 15.

Carrier: Parcelway
Tracking: PW 7721 3380 12

Track your package: https://track.example.com/PW772133012`,
    "an order shipment notice",
  ),
  reply(
    "dev-unrel-3",
    "unrelated",
    "plain",
    "Quick question about a role at Northwind Labs",
    `
Hi Jordan,

I came across your profile and think you could be a great fit for a Senior Engineer role on our platform team. The role is remote, with a salary range of $150k to $190k. Do you have 15 minutes this week for a chat?

Best,
Alex Rivera
Talent Partner, Northwind Labs`,
    "a recruiter message",
  ),
  reply(
    "dev-unrel-4",
    "unrelated",
    "html-text",
    "You have 3 new notifications",
    `
[https://cdn.example.com/social/logo.png]

Hi Jordan,

Casey Example and 2 others viewed your profile this week. See who [https://social.example.com/views?track=88812&utm_medium=email]

Sam Example commented on your post: "Great photo!" [https://social.example.com/c/4411]

Turn off these emails [https://social.example.com/settings/email]`,
    "social network notifications about people, not a privacy request",
  ),
  reply(
    "dev-unrel-5",
    "unrelated",
    "other-people",
    "Pat Example shared a document with you",
    `
Pat Example (pat.example@example.org) has invited you to view the following document:

Lease renewal 2027.pdf

Open in Docs: https://docs.example.com/d/1x9Qz

If you do not know Pat Example, you can ignore this message.`,
    "a document share invitation that mentions another person",
  ),

  // unknown
  reply(
    "dev-unknown-1",
    "unknown",
    "plain",
    "Re: Request",
    "Thanks.",
    "a one word message that says nothing",
  ),
  reply(
    "dev-unknown-2",
    "unknown",
    "plain",
    "FW: Data question",
    `
FYI.

Sent from my mobile device`,
    "a forward with no context",
  ),
  reply(
    "dev-unknown-3",
    "unknown",
    "plain",
    `Re: ${REF}`,
    `
Please see the attached.`,
    "refers to an attachment that is not there",
  ),
  reply(
    "dev-unknown-4",
    "unknown",
    "quoted-thread",
    "Re: Re: Re: privacy",
    `
Hmm. Not sure.

>> On Mon, Oct 5, Sam wrote:
>> Who owns this one?
>
> On Mon, Oct 5, Lee wrote:
> I thought it was you.`,
    "an internal chain that decides nothing",
  ),
  reply(
    "dev-unknown-5",
    "unknown",
    "plain",
    "Re: your email",
    `
Per my last email, see below.

--
Records Team`,
    "points to text that is not included",
  ),
];
