# What ties mail to a request

A company that was written to answers under its own name at least once.
So mail that is not a reply to our message, does not carry our reference, and never names the target gets little to no confidence.
This page says how the mail intake and the reply classifier apply that.

## Tied to an open request

Mail is tied to an open request only if one of these holds:

- It is threaded to our message: `In-Reply-To` or `References` holds our Message-ID.
- It carries the request's `KR-` reference.
- It names the request's target in its subject, its body, the name it was sent under, or the domain it was sent from.

Bounces keep their own path.
They bind through the Message-ID of the original message, not through a name.

## What counts as naming the target

A target is known by these names:

- Its own name, without a legal ending such as Inc or LLC.
- The lead of that name when the target's domain spells it, so `equifax.com` names "Equifax Information Services" as Equifax.
- The label of its owner group from `owner-groups.yaml`.
- Its aliases from `aliases.yaml`, each with the source that shows the broker answering under that name.

A domain label is not a name by itself, since `here.com` or `retention.com` would make "click here" and "data retention" name the target.
The domain still counts as a whole, so a mention of `here.com` or mail from it names the target.

Matching is by whole word, ignoring case and accents.
Apostrophes are dropped on both sides, so "Macy's" and "Macys" are the same.
The words of a name may run together or be split by a space, a dash, a dot, an ampersand or "and", so "Barnes & Noble", "Barnes and Noble" and "BarnesNoble" are the same.
A name that is one common English word, such as "Target" or "Chase", is left out, and so is a number.
A name made only of words many targets share is left out unless it runs to three words, as "USA People Search" does, and so is a name shorter than three letters.
A name of two letters, such as "HP" or "H&M", is matched as written, with its capitals.
A target left with no name is still tied by its domain.
Only an alias is kept when its words are common, because it is entered by hand for a target that is known to use it.

The body is read without the part that quotes our own request, since that part names the target in every reply.
A company often names itself only in its signature, so the whole reply is read.

Add an alias rather than loosening the rule when a broker replies under another brand.

## What happens to mail that is tied to nothing

Mail sent to the reply address is taken in only when it names an open request.
Other mail from a stranger is taken in only when it names an open target and talks about the person's data.
Mail from a target's own domain keeps its existing rules, which already leave out newsletters and ads.

Mail that is tied to no open request is not taken in.
While the report of passed-over mail is shown, it is listed with the reason "Names no open request", so the person can take it in by hand.
Once the report is closed or its week has ended, such mail to the reply address is dropped and not kept anywhere.
The only way to find it then is the search for a missing reply.

## What happens to mail that is taken in without a name

A message can be taken in on its sender alone, for example from a sender the person added.
If it is neither threaded to our message nor names the request it would change, the classifier caps it below the rules' threshold.
The reply model cannot apply it either, however sure it is.
It goes to Review with the model's answer as a suggestion.

## Checking it

`pnpm loop:mail-intake` runs the inbox poll over the synthetic mixed inbox and reports false positives, false negatives, stored mail that should have been ignored, and misrouted mail.
The `alias_unnamed` category holds reply-address mail that names nothing, and `alias_mail` holds the same wording signed with the company's name.
