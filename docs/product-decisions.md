# Product decisions

The authoritative list of what Foundit does and does not do, as settled during the
design phase. Where this disagrees with `product-spec.md`, **this file wins** — the
spec was written first, under the earlier name "Solvd", and parts of it were
deliberately cut afterwards.

Last updated: 11 September 2026.

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

Sign-in options at launch: **Google, and a 6-digit code sent by email.** No passwords,
no magic links, no GitHub.

**Apple sign-in is deferred** (decided 10 September 2026). It requires an Apple Developer
Program membership at 99 USD a year — five times the rest of the year’s running costs —
plus a client secret that expires every six months. It comes back when there is an iOS
app to put in the App Store, which is the point at which Apple sign-in stops being
optional anyway. *The designed sign-in screens still show an Apple button; remove it
when those screens are built.*

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
| Backups | When the last backup ran and whether it succeeded; **when a restore was last tested and whether it passed**; the size of the backup store against R2’s 10 GB free allowance; R2 operations this month against the free million. A red row here outranks everything else on the page |
| Server | Disk used against 40 GB, memory in use, swap in use, and whether unattended security updates are current. A full disk takes down the database, Docker and the monitoring at once |

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

## 13. Hosting: our own machine (decided 10 September 2026)

Foundit is self-hosted from the start, on a single Hetzner Cloud VPS running the app,
PostgreSQL with pgvector, and a reverse proxy in Docker Compose, with Cloudflare in
front. Domain: **foundit.tools**.

**Why**, in the owner's words: he is willing to run the machine, and wants no vendor
limits. What it buys: a fixed monthly cost with no free-tier pausing, no 5 GB egress
cliff, no non-commercial restriction blocking paid accounts later, and the database
sitting on the same machine as the app — a sub-millisecond hop instead of the
160–360 ms cross-region penalty the managed plan had to design around.

**What it costs**: roughly €8–12/month all in — server, its automatic backups, and
off-site backup storage — against about $20/year on the managed free tiers. The
difference buys control, and is paid for in operator time.

**What it obliges us to do.** Everything the managed platform did silently is now ours:
security patching, TLS, firewalling, monitoring, disk space, Postgres upgrades, and
backups. In exchange, nothing about the data layer changes — the schema, the vectors
and the search are plain PostgreSQL either way.

The one open question is the authentication stack, since Supabase was providing
sign-in *and* the row-level security that makes an application bug not become a data
breach. Two candidates are under research: running the Supabase stack ourselves, or
plain Postgres with Auth.js and hand-wired row-level security. **Whichever wins, the
authorization boundary stays inside the database.** That is not negotiable.

## 14. The site chrome tells the truth about what is built (decided 11 September 2026)

The header and the footer are on every screen, and seven of the nine links in them went
to a 404: `/submit`, `/saved` and `/sign-in` from the header, `/about`, `/guidelines`,
`/contact` and `/privacy` from the footer. Two code reviews had not found it because
each link reads correctly on its own; the owner found it in a minute by clicking.

**Controls whose screens are a later phase stay drawn, and are disabled in place.**
Sign in and Saved are Phase 6 and Add a tool is Phase 7 (`docs/build-phases.md`). The
artboards draw all three, and taking them out would hide a plan that is real. So they
keep their place in the header as disabled controls — the state the design already
specifies — with a "Soon" badge beside them and one plain sentence in the footer saying
that signing in, saved lists and adding a tool arrive together with accounts. This is
what the tool page already does about claiming ("Claiming opens when sign-in does"): an
honest gap beats a convincing lie, and a control that cannot be clicked is better than
one that can be clicked and breaks.

**About, Guidelines, Contact and Privacy are real routes that say they are unwritten.**
The alternative was removing the links until somebody writes the pages. We kept them,
for two reasons. Privacy is a legal requirement before a real person uses Foundit, and
a missing link is a gap nobody trips over, whereas a page that says the notice does not
exist is a gap somebody has to answer for. And the four links are drawn in every
artboard's footer, so removing them would put the build further from the design in
order to hide something we would rather see.

Each of those four pages says, in one panel, that it has not been written and what it
will cover. **None of them invents policy, promises or an address.** The privacy page
in particular claims nothing about what is collected, how long it is kept or who sees
it: a notice guessed at from the outside is worse than none, because it stops anybody
noticing there isn't one. All four are `noindex` — an empty page under a real title is
not what a search for "Foundit privacy" should return.

**Every screen below the homepage carries a way back.** It is a link to where the page
sits, never `history.back()`, because a page opened from a link somebody sent has no
history to go back to. Results, Browse and Top go to the homepage; a tool page goes
back to the search that found it when the search is on the URL, and to Browse when it
is not — read from the URL, never guessed from a referrer. The control is the ghost
back link the submit artboards draw, in the same place on every screen.

`tests/links.test.mjs` compares every internal link the app renders against the routes
`app/` actually defines, so this class of defect cannot come back quietly.

**The page list grew from four to thirteen, and the footer grew columns to hold it
(11 September 2026).** A real site carries more than About, Guidelines, Contact and
Privacy, and `research/13-required-pages-and-notices.md` §3.7 and §3.8 name the rest.
Nine more routes now exist, each on the same terms as the first four: an `UnwrittenPage`
that says it has not been written and what it will cover, inventing no policy, promise or
address, and `noindex`.

| Page | What it will hold |
| --- | --- |
| `/terms` | What you agree to, and where Foundit's responsibility for a third-party tool ends. Acceptable use: scraping, automated submission, malicious links. |
| `/cookies` | Which cookies exist and why each is necessary. No advertising and no third-party trackers, so there is nothing to consent to — **and no banner is to be built** (§4.3 of the research: a banner asking consent for something done on another basis is a false statement about the site). |
| `/accessibility` | The commitment, the standard applied (WCAG 2.2 AA; IS 5568 is WCAG 2.0 AA), the known gaps in plain words, and a route for somebody who hits a barrier. W3C names all three, and Israeli regulations 34(ה)/35ה ask for the statement now. The route is the missing part, because no address is decided. |
| `/ranking` | "How the fit score works": what the score is, what feeds it, what does not — *no tool can pay to rank higher* — where listings come from, how reviews are handled, the limitations, and how a maker corrects a listing. Linked from the results page as well as the footer, because that is where somebody reading a ranked list looks for it. |
| `/pricing` | Free today; what paid accounts will buy later (§11); and that they will never affect ranking. Folds in the research's "How we make money". |
| `/security` | What is encrypted, where data lives, who the sub-processors are, how to report a vulnerability. |
| `/copyright` | Copyright complaints and takedown, including the DMCA §512(c) agent once one is registered. |
| `/report` | How to report a listing, a review or a security flaw. Today the only working channel is the per-listing "Report this listing" mailto on the tool page, and the page says so. |
| `/help` | Help and FAQ, written from questions people actually ask. |

`/.well-known/security.txt` is **deliberately not in this change**. RFC 9116 makes exactly
two fields mandatory and one of them is `Contact:`; a security.txt with an invented
address is worse than none, because it is the file a researcher trusts instead of looking
further. The security page says it will exist.

**The footer is three labelled columns, which the artboards do not draw.** They draw one
row of four links, and that was right for four. Thirteen in a row is a pile, so they are
grouped — *Foundit* (About, How the fit score works, Pricing, Help, Contact), *Community*
(Guidelines, Report a problem, Copyright), *Legal* (Terms, Privacy, Cookies,
Accessibility, Security) — with the wordmark and the "still being built" note where they
were. This is the one place the build is deliberately ahead of the canvas, and it is
because the content changed rather than because the design was wrong. It wraps without a
media query: the columns drop under the wordmark when they stop fitting beside it, and
stack one per line on a phone.

`tests/markup.test.mjs` holds all thirteen to the same three rules — the route exists, it
renders `UnwrittenPage`, and it is `noindex` — so one of them cannot quietly grow policy
nobody agreed to.
