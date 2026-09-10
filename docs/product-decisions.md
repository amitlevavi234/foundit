# Product decisions

The authoritative list of what Foundit does and does not do, as settled during the
design phase. Where this disagrees with `product-spec.md`, **this file wins** — the
spec was written first, under the earlier name "Solvd", and parts of it were
deliberately cut afterwards.

Last updated: 10 September 2026.

---

## 1. What the product is

A person describes a problem in plain language and gets back real tools that solve it,
ranked by how well they fit. They never need to know a tool's name. Interface is
English only; people may type their query in any language.

Desktop web only for now. Every screen is designed at 1440×900 and scrolls like an
ordinary browser tab.

## 2. Accounts and when we ask for one

Searching, reading results and browsing never require an account. The account gate
appears only at the moment someone tries to **save, like, review, or add a tool**.
A skippable prompt may appear from the second search onward, never before the first
set of results.

Sign-in options: **Google, Apple, and a 6-digit code sent by email.** No passwords,
no magic links, no GitHub.

## 3. Who owns a listing

Two roles, and nobody in between:

| Role | How you get it | What it gives you |
| --- | --- | --- |
| **Founder** | You added the listing | Credit on the page, and the listing is yours to edit |
| **Maker** | You ticked "I made this tool" when adding it | The same, plus the maker dashboard |

- **Whoever adds a tool maintains it.** Nobody can take a listing over.
- **Users may only add tools they made themselves.** Step one of the add flow is a
  single required tick — "Yes, I made this tool" — and Continue stays disabled until
  it is ticked. Recommending someone else's tool is not in this version; that link
  sends us a tip instead.
- **Claiming applies only to listings we seeded at launch.** It is one click, with no
  verification: say it is yours and it is. The listing then shows "Maintained by @you"
  publicly, and anyone can report that if it is untrue. Disputes are settled by hand.

The reasoning: verification friction means nobody claims anything, and at launch scale
no listing is worth stealing. This is a deliberate trade, to be revisited when the
catalogue is worth policing.

## 4. Reviews

- Ratings and reviews belong to whoever wrote them. **Nobody can edit or delete
  someone else's review** — not the listing's maintainer, not us. A maintainer can
  reply to a review.
- Deleting your own account removes your own reviews.

## 5. Publishing and moderation

Nothing waits for approval. A tool is live the moment it is published. There is no
review queue, no editor role, no approver.

Reports go to the team by email rather than into a queue.

**Deliberately deferred** (designed, not built): the moderation queue, reviewing an
outside edit, requesting changes, merging duplicates, and a public change history.
Build these when the catalogue is large enough to need policing.

## 6. Results and the fit score

Every result carries a **fit score** — how well that tool matches what was actually
asked, not how popular it is. It must be honest: a partial match must look like a
partial match. Constraints stated in the query (free, offline, a specific language,
no account) are shown as met or unmet on each result.

The results page is a conversation: the person can add more detail and re-run the
match rather than starting over.

## 7. Homepage

A single chat-style input, example prompts in several languages, and a "top tools"
section with an option to see all of them.

## 8. Constraints we track per tool

Pricing model, platforms, languages, offline capability, and whether an account is
required. **Data-and-privacy and licence were removed** — too fiddly to keep accurate,
and not what people were asking about.

## 9. Visual direction

Neo-brutalist "Toybox": cream ground, 2px ink borders, offset shadows that press down
on hover, coral for actions, violet for structure, lime for reward. Bricolage Grotesque
for display, Onest for interface. Motion is CSS-only and respects
`prefers-reduced-motion`. No blur effects and no sub-degree rotation on text — both
made type render soft.

The 37 designed screens are in `design/canvas/`, regenerated with
`node design/canvas/build.mjs`.

---

## 10. Operator dashboard (added 10 September 2026)

A private dashboard for the owner, at `/admin`, visible to nobody else. Its job is to
answer "is this working, and what should I build next" — and to show the money.

**What it shows**

| Panel | Contents |
| --- | --- |
| Demand | Searches per day; searches that returned nothing good — the most valuable list on the page, because it is demand the catalogue cannot serve yet |
| What people ask for | The most frequent queries, grouped, with counts. Text without names attached |
| Catalogue | Tools added this week, by whom; tools nobody has ever matched; claims made |
| People | Signups per day, returning visitors, and each user's **public** activity: tools added, reviews written, likes given, last seen |
| Words | Reviews posted, reports received |
| Money | Embedding calls today, model calls today, estimated spend this month against the cap, database size and egress against the free-tier limits |

**The privacy line.** Search text is visible in aggregate — deduplicated, counted, not
attached to a person. Individual users are visible through what they did in public.
The two are never joined, so the dashboard can never become a record of what a named
person went looking for. This costs nothing in usefulness: product decisions come from
what many people ask, not from what one person asked.

Access is enforced in the database, not just the page: an `is_admin` flag on the
profile, checked by the row-level rules, so the dashboard cannot be reached by
guessing the URL.

## 11. Paid accounts, later (added 10 September 2026)

Premium accounts are expected eventually, not soon. Two consequences to plan for now,
neither of which is work today:

1. **The day the first payment is taken, the free hosting tier becomes ineligible** —
   it is non-commercial only. Budget $20/month from that day.
2. The database gets a `plan` column on the profile from the first migration, so that
   adding tiers later is a change of behaviour rather than a migration of everyone.

## 12. The link out to the tool (added 10 September 2026)

Every result and every tool page carries a link to the address the maker entered, so a
person can go straight to the thing. This is the whole point of a recommendation, and
it is already in the design as **"Open Splitwise ↗"** on the tool page.

How it behaves:

- Opens in a new tab, so Foundit stays where it was.
- Shows the domain next to the button, so people can see where they are going before
  they go.
- Accepts `https` addresses only. No other kind of link is stored or rendered.
- Carries `rel="noopener noreferrer"`, so the opened page cannot reach back into ours.
- The click is counted — this is the "opened from Foundit" number on the maker
  dashboard — and the count is recorded without attaching it to a person.

Note that **the browser opening a link is not the same as our server fetching one**
(§5 of the plan). The visitor's own browser goes to the maker's site, exactly as it
would from any other link on the web. That has none of the risk that made us defer the
automatic filling-in of details, so the link ships in version one.
