# Product decisions

The authoritative list of what Foundit does and does not do, as settled during the
design phase. Where this disagrees with `product-spec.md`, **this file wins** — the
spec was written first, under the earlier name "Solvd", and parts of it were
deliberately cut afterwards.

Last updated: 12 September 2026.

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

- Ratings and reviews belong to whoever wrote them. **Nobody can edit someone
  else's review** — not the listing's maintainer, not us. A maintainer can reply to
  a review.
- **Only an admin can remove someone else's review** (decided by the owner,
  11 September 2026). Removing is not editing: the text is never changed, it is
  taken down whole. A listing's maintainer cannot remove a review, however unfair
  they think it is; they report it like anyone else. This replaces the earlier
  rule that not even we could delete one, which left no way to take down an
  illegal or abusive review — and the EU Digital Services Act (Arts 16–17,
  `research/13` §2.1) requires exactly that route, plus telling the author why.
  So when removal is built (Phase 6/7) it comes with: the reason recorded, the
  author told, and the removal visible in the operator dashboard.
- Reports of a review or a listing come in through the contact and report pages
  (`/contact`, `/report`) and reach the team by email (§5).
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

**Amended 11 September 2026, after the owner's review of the live results page.**
Two changes, both his, and neither alters the rule above.

*How a result matched is no longer on the face of every card.* His words: "how the
match goes doesn't need to show on each card." The "Matched: problem + description"
label, the sentence explaining it and the quoted problem statement moved behind a
small, quiet **"Why this?"** on each card — a native disclosure, keyboard-operable,
closed by default. The card keeps the name, the summary, the constraint chips
(**met and unmet stay visible**: that is the rule above and a Phase 5 non-negotiable,
and a person must never have to open something to see a constraint the tool
misses), likes, Save, and Open with the domain beside it. The designed fit bar with
its percentage stays out until Phase 5 calibrates a real score, because a rescaled
similarity shown as a percentage is the lie `docs/build-phases.md` forbids. When the
bar arrives it is where the answer to "why this?" will live.

*If nothing fits, the page says so.* "If there are no matching for what I asked I
don't want to see apps that are not related … I prefer a note saying there are no
tools like that right now." A relevance floor in the database
(`db/migrations/0006_relevance_floor.sql`) now drops every result without evidence
— not close in meaning, not carrying every word, not named what was typed — so a
page may hold three results, or none, and the heading counts what is there rather
than promising twelve. An empty page says plainly that Foundit does not have a tool
for that yet, and offers the ways forward that exist: browse the problems people
solved, describe it differently, or drop a constraint. It does not apologise, and it
does not promise the tool will be added. The honesty rule above now covers the page
as well as the card: a partial answer looks like a partial answer, and no answer
looks like no answer.

*How well that works, measured, because the decision should not be read as a
solved problem.* An adversarial review wrote 25 sentences the catalogue cannot
answer, before reading ours. The floor refuses 40% of them. Every threshold that
refuses more starts emptying pages for real questions — a Hebrew query about
splitting costs, a Russian one about removing noise — and the two are not
separable by similarity alone: "a recording studio that rents by the hour" looks
exactly like a catalogue full of recording software. So the page is honest when
it is empty, and it is still too often not empty when it should be. The full
frontier is in `eval/baselines.md`; a calibrated score in Phase 5 is what fixes
it properly.

**Amended 12 September 2026, by Phase 5.** Two changes, and one thing that
deliberately did not change.

*The band on a result now comes from a reading of that result, where there was
one.* Phase 5 added a reranker: over the top candidates the search returned,
`gpt-5-nano` is shown the sentence and each candidate's own name, summary and
problem statements — and nothing else, not its price, its rating, its like
count or the rank the search gave it — and grades each one 0 to 3. **Where that
ran, the band is the grade**: 3 is *Strong*, 2 is *Possible*, 1 is *Loose*, and
0 is not shown at all. **Where it did not run** — no key, a timeout, a
malformed answer, the daily cap spent — the band is what it has been since
Phase 3: a *location*, naming which of a listing's texts the words turned up
in. The two are different claims and are worded differently, and the line above
the results says which of the two the page is showing. That line is also the
first in five phases allowed to use the word *fits*, because for the first time
something has read the pair and formed a view.

*A page can now be empty because nothing fitted, rather than because nothing was
close.* That is the state the relevance floor could never reach, and the reason
is written up in `eval/baselines.md`: "a recording studio that rents by the
hour" really is about recording, so no cosine threshold separates it from the
recording software without emptying real questions too. A reading does. The copy
on that page says which of the two happened.

*What the reranker does not see, added 12 September 2026 after the Phase 5
adversarial review.* It is shown **the first four problem statements** a listing
carries, in the order the listing keeps them, and no more — `MAX_CANDIDATE_STATEMENTS`
in `lib/rerank.ts`. Today that binds on nothing, because four is also the most
any listing has. From Phase 7, when a maker writes their own, a tool with six
statements is judged on four of them and the two it does not see may be the two
that answer the sentence. When that starts to matter the choice is to raise the
number — the cost is roughly linear in it — or to choose *which* four rather
than the first four, and neither should happen without somebody deciding it.

*What did not change is the percentage: there still is not one.* The designed
fit bar stays out. A calibrated number means something specific — of the results
shown at 80%, about eighty in a hundred are what the person wanted — and it can
only be fitted against pairs that PEOPLE have judged. `eval/golden.jsonl` was
graded by an agent and is the test set; fitting a score on it and then reporting
a score against it is reporting a number about itself. So the bands stay until
there are at least 200 judged pairs in `eval/judged.jsonl`, each with the name
of whoever judged it and the date. `eval/calibrate.mjs` is the command that
fits the curve the day they exist, and it refuses to fit on fewer. `/ranking`
says all of this to a visitor in two paragraphs, because somebody reading a
ranked list is entitled to know which kind of number they are looking at.

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

**A private saved list is not operator data** (decided 12 September 2026). Until
now `collections_read` carried `or auth.is_admin()`, inherited from `0001`, so an
administrator could read any collection — including one with no share token, which is
a list somebody made for themselves and showed to nobody. Phase 6's adversarial review
found it, and it contradicts the privacy line directly: a person is visible to the
operator through what they did **in public**, and a private list is the opposite of
that. A saved list is the same category of sensitive as a like list, which `0003`
already made private, and this catalogue lists tools for leaving somebody, hiding money
and managing an illness. So `or auth.is_admin()` is gone from `collections_read` and
`collection_items_read` (`0015_phase6_review.sql`), and an administrator now reads a
shared collection only the way anybody else does: by holding its link. The dashboard
loses nothing it was going to use — the "saves" figure it wants is a count, and Phase 8
will get counts from a definer function that returns numbers rather than rows.

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

## 15. The typed sentence now leaves our server (added 11 September 2026)

Phase 3 sends the sentence somebody types to **OpenAI**, at
`https://api.openai.com/v1/embeddings`, to turn it into a vector. Nothing else
goes with it — not who asked, not their address, not what the catalogue holds.
One call, one hardcoded URL, from one file (`lib/embeddings.ts`), and the
vector is cached so the same sentence is sent once rather than once per person.

This is a change of kind, not of degree, and it has one consequence that is not
optional:

**The privacy notice must name the provider and the transfer before a real
person uses Foundit.** `research/13-required-pages-and-notices.md` §6.3 already
says so — a sub-processor who receives the content of a search is a
sub-processor who has to be named, and for an EU visitor the transfer needs its
basis stated. `/privacy` is currently an `UnwrittenPage` that deliberately
claims nothing (§14), which is the honest state while nobody is using the site;
it is not the honest state on the day one person does.

The rest of §12's distinction still holds and is worth restating beside this
one: **the browser opening a link is not our server fetching one.** We still
never fetch a URL a maker submitted. What changed is that we now send *the
visitor's own words* to a third party, which is a different fact about a
different piece of data, and it belongs on the privacy page rather than in a
footnote about outbound links.

## 16. What the sentence reader does, and what it will not do (added 12 September 2026)

Phase 4 added a second paid call to a search: `gpt-5-nano` reads the sentence
somebody typed and reports what it requires. This section is what that model is
allowed to decide, and — more usefully — what it is not.

**It reads the sentence and nothing else.** The request carries the normalised,
200-character-capped sentence, the instructions, and five settings. No
catalogue, no tool names, no slugs, no list of what we have, nothing about the
visitor, the session or the request. The model is not choosing an answer; it is
reading a question.

**It can name no tool, because no field can hold one.** The schema has seven
fields and every one is an enum member, an ISO language code, a boolean, or a
restatement of the person's own sentence. The one field that could smuggle text
into the ranker — `residual` — is accepted only when it is proved to be a
*deletion* of what was typed: every character of it appearing in the input, in
order. A model that rewrote, translated or embellished the sentence fails that
check and the rules' version stands.

**The rules keep the last word.** `lib/constraints.ts` runs first, costs
nothing, and is never overruled: a dimension the rules read is a dimension the
model cannot touch. The model may only fill one they left empty.

**And it may only fill one dimension: pricing.** This was measured rather than
decided, on the golden set and both negatives files, and the numbers are in
`eval/baselines.md`. Letting the model contribute platforms or flags made the
search worse in a way worth stating plainly: asked what a sentence requires, a
model offers the things people generally want. "Notes app where my notes stay
as files on my own computer" came back requiring `accessible` and `no_ads`, and
the page emptied. Pricing is different because the phrasings are endless
("without paying for anything", "without owning photoshop") and the only two
readings a sentence can produce are already enumerated.

**A non-English sentence is restated in English, and the restatement is
embedded — never filtered on and never ranked on.** It is also the only thing
the model writes that reaches the ranker at all, so it is checked like an input
rather than trusted like an answer: at most thirty words, one line, no markup,
no longer than twice the sentence, and it may not name a tool in the catalogue.
A restatement naming a tool is the model writing the query instead of reading
the sentence. Anything that fails falls back to embedding the sentence itself
and is counted. The catalogue is English and
indexed as English, so this is the first thing in four phases to move the
non-English slice for a structural reason rather than a tuning one. Giving the
restatement to full-text search as well was measured and was worse; it is not
done.

**"This is not a request for software" empties the page, and needs four
agreements to do it.** The sentence must name no program in any language the
catalogue serves; it must name no tool in our own catalogue; *both* of two
independent samples of the model must say so; and the reader must not have been
refusing more than half of everything lately, which is a circuit that opens when
it is and stops any refusal being honoured until it closes. A cached refusal
also expires after a day, because it is the one answer that empties a page
without searching and one bad sample must not do that for ever. That is not belt and braces for its own sake — one sample in seven said a
question about splitting a holiday bill was not a request for software, and the
cost of being wrong is a person with a real problem told that nothing exists.
The page that results says Foundit only lists software and that this sounds
like something else, and then offers the same two ways forward as the other
empty state. It does not apologise, because nothing went wrong.

**Nothing the reader does is joinable to a person.** The readings cache
(`public.query_readings`) has no user column, no session column, no IP column
and no foreign key, exactly like `query_embeddings` and `search_events`. The
rate limiter that bounds the spend keeps nothing at all: a token bucket in
memory, keyed on a salted hash of an address that is never stored or logged, and
a restart forgets everybody.

**Two things about that limit that are true and were overstated once.** It holds
per visitor only with Cloudflare in front of us overwriting `cf-connecting-ip`,
which is the production arrangement and the origin has no published port to
reach directly; traffic that does reach the origin directly shares ONE bucket
between all of it, because `x-forwarded-for` can be written by anybody and
trusting it would let one attacker mint a fresh identity per request. And the
page a limited visitor gets is an HTTP **200**, not a 429: a Next 15 Server
Component cannot set a status code, and middleware runs in a different runtime
from the in-memory bucket. A person sees the right page; a bot sees no
`Retry-After`.

**`store: false` is in the request.** The Responses API retains a response by
default so it can be fetched back by id. The sentence somebody typed is the text
`search_events` refuses to attach to a person, and leaving a copy of it in a
provider's dashboard would undo that at the far end.

§15 still stands and now covers two calls rather than one: **the privacy notice
must name the provider and the transfer before a real person uses Foundit.**
What leaves the server is the same sentence it was; it now leaves twice.

## 17. What counts as a good match (added 12 September 2026)

`search_events.had_good_match` has existed since `0001_init.sql` and has held a
constant `false` for every row ever written, because nothing in Phases 2 to 4
could honestly fill it. The application said so in a comment rather than
guessing: the only value it could have supplied was `result_count > 0`, which
is a different question wearing this column's name. §10 calls the panel it
feeds — *searches that returned nothing good* — the most valuable on the
operator dashboard, and a panel fed by a guess is worse than an empty one,
because a dashboard reads it as measurement.

**The definition, and it is the whole of it:**

> A search had a good match when **the reranker ran on it and judged at least
> one result that the person was actually shown at relevance 2 or 3** — "fits"
> or "clearly fits" on the four-point scale in `lib/rerank.ts`.

Four things follow from it, and each is a decision rather than a detail.

**It requires a reading, not a score.** Not a similarity, not a rank, not a
count of results. The only thing in this system that has looked at a
(sentence, tool) pair and formed a view is the reranker, so it is the only
thing entitled to answer this question. Where it did not run, the question was
not asked.

**So there are three states, not two, and the schema carries both.**
`0010_generated_statements.sql` adds `search_events.match_judged`:

| `match_judged` | `had_good_match` | What it means |
| --- | --- | --- |
| `false` | `false` | Nobody looked. No key, a timeout, a malformed answer, the daily cap, or a page with nothing on it to judge |
| `true` | `false` | It was read, and nothing on the page fitted |
| `true` | `true` | It was read, and something fitted |

The fourth combination is refused by a CHECK constraint, because "not judged
but good" is not a state this definition can produce. Without
`match_judged`, a `false` would mean both "nothing fitted" and "nobody looked",
and the dashboard would read the second as the first — which is the defect the
column's constant `false` has been protecting the panel from for three phases.

**Relevance 1 is not a good match.** *Loose* means "in the right area rather
than an answer to it". A search that returned three Loose results and nothing
better is a search that did not answer the question, and the panel that lists
those searches is the list of things the catalogue cannot serve yet. Counting
them as successes would empty the panel, which is precisely the failure the
column has been left alone to avoid.

**It is about what was SHOWN, not about what was judged.** A result graded 3
that never reached the page — cut by the twelve-row limit, or removed by a
category narrowing — did not help the person who searched. `hadGoodMatch()`
takes the slugs on the page and no others.

**The privacy line in §10 is unaffected.** `search_events` still has no user
column, no session column and no foreign key to anything that has one, and
`log_search_event` still takes no identity and returns no row id.
`match_judged` is a boolean about a search, and there is nothing in this row
that could ever say whose.

## 18. What accounts actually do, and the nine things Phase 6 had to decide (added 12 September 2026)

§2 settled that there are accounts and when we ask for one. Building them
raised nine questions it did not answer. Each is recorded here rather than only
in a code comment, because each is a product decision wearing an implementation
hat, and the next person to touch this will want to know it was decided rather
than defaulted.

**1. Sharing a collection is a LINK, not a flag.** `0001_init.sql` gave a
collection an `is_public` boolean and a policy that made a public one readable
by anybody who could reach the database — enumerable by id, one guess at a time.
That is a wider promise than anyone made. A shared collection is now readable by
whoever holds a **128-bit token in the URL** and by nobody else: the token is
the whole of the permission, the policy compares it to the column, and revoking
a share sets it back to null so the old link stops working immediately. The
flag stays because the Share control needs something to be on or off, and a
CHECK makes the two impossible to disagree. `/c/<token>` is `noindex` for the
same reason: a link somebody sent to one person is not a page a search engine
should hand to everybody.

**2. A shared collection is therefore NOT listed on a public profile.** The
artboard counts "3 public collections" on `ProfilePublic`. Listing them would
publish the tokens, which would turn "anybody with the link" into "anybody". The
public profile shows what somebody did in public — listings they added, reviews
they wrote — and nothing that is only theirs.

**3. A review's byline is the @name and nothing else.** A display name is a
string a person chooses and can change to anybody else's; a review is the one
place in this product where who wrote it has to be the same string as the
profile it points at. So the tool page prints `@handle`, and the artboard's
"Priya Raman" over the review is not built.

**4. An @name is derived from the NAME, never from the address, and never
transliterated** (amended 12 September 2026 after the review). Nobody is asked to
choose a handle during sign-in, because the sign-in screen is two controls and a
sentence and that is the whole of its value. It was originally derived from the
local part of the address — which published the mailbox name on a public page, so
`amitlevavi234@gmail.com` became `@amitlevavi234` beside everything that person had
reviewed. It now comes from the name the provider gave us, sanitised to the CHECK
`0001` already carries and deduplicated with a number by the unique index rather than
by a guess; with no name — which is every emailed-code sign-in — it is a neutral word
and four digits, `maker_4821`. A name in another script gets the same neutral handle
rather than a guess at how it looks in Latin letters, because a wrong transliteration
of somebody's name is worse than no name. There is also a reserved list now: `admin`,
`settings`, `api`, `saved`, `browse`, every first path segment under `app/`, and any
`admin_…`, because `@admin` on a review byline is an impersonation of an operator.
Settings is where anybody changes it, and a handle that is refused is refused out loud
rather than quietly turned into something else.

**5. No avatar is ever fetched.** Google hands us a picture URL with the
profile. Storing it would mean every page carrying the header asks Google's CDN
for a file — a visitor's browser telling a third party where they are, on every
page, for a decoration. The avatar is an initial on a coloured ground, drawn by
us. §12's rule is about our server fetching a URL; this is the neighbouring
question and the answer has the same shape.

**6. Deleting an account kills the session FIRST.** The rows live in two schemas
reached by two roles through two pools, and PostgreSQL cannot make that one
transaction, so the order is chosen by what a half-completed deletion leaves
behind. Sessions go first: from that instant the cookie in their browser opens
nothing, and everything that can fail afterwards fails on an account nobody can
sign into. Then the profile — one row, and `0001`'s cascades take the reviews,
likes, collections, saved items and claims with it. Then the account itself.
The brief this phase was written from asked for the opposite order, and the
opposite order leaves a window in which the profile is gone and the session
still works: a signed-in person with no profile, whose next request would create
them a new one and quietly undelete the account they had just closed.
`tests/deletion.test.mjs` fails each step in turn and checks what is left.

**7. There is no foreign key from `profiles` to Better Auth's `user` table.**
Phase 1 left a note asking for one. It is not added, and the reason is the
boundary this phase exists to draw: referential-integrity actions **bypass
row-level security by design**, so a cascade from `auth_core` would be a delete
path into `public` for the one role that is supposed to hold nothing there. The
invariant it would enforce — a profile belongs to a real account — is enforced
instead at the two places that can break it: one code path creates a profile (at
first sign-in), and one ordered deletion destroys it, both with tests.

**8. Settings shows three sections and builds two.** Notifications is not drawn
at all, because nothing in this product sends anybody anything except a sign-in
code, and five toggles over columns labelled Email and In-app would be five
promises nobody made. "Download my data" is not built: an export is a real
obligation and a real piece of work, and a button producing a partial file is
worse than no button. "Use my searches to improve matching" is not drawn either
— there is nothing to toggle, because search text is never attached to a person
in the first place, and consent to something that does not happen is a false
statement about the site in exactly the way §14 says a cookie banner would be.

**8a. A removal an administrator makes is final** (added 12 September 2026): the
author of a removed review may not clear `deleted_at`, may not change a word of it,
and may not write a new one on the same tool — otherwise the Digital Services Act
takedown §4 promises lasts until their next request, which is what the review found.

**8b. No token Google gives us is stored** (added 12 September 2026): the access token
and the ID token are nulled before the `account` row is written, because this
application never calls Google again and a credential to somebody else's system kept
for nothing is a leak waiting for a backup.

**8c. A share token is minted by the database** (added 12 September 2026): the
application may not write one and a supplied value is refused, so "128 unguessable
bits" is a rule rather than a property of the one statement anybody happens to send.

**9. Every page that carries the header is now rendered per visitor.** The
header shows an avatar or a Sign in button, so a page carrying it cannot be one
static file served to everybody. The catalogue reads underneath are still cached
for a minute (`lib/db.ts`) and **nothing that ran under somebody's identity may
ever enter that cache** — the signed-in overlay on a results page or a tool page
is a separate statement, under a claim, outside the cache. The two places that
cannot ask who is looking are the loading skeleton and the 404, and both draw
the signed-out header on purpose.

### The counter defect this phase found, and what it says about the last four

Phase 6 is the first phase in which somebody other than a migration writes a
row, and within a minute of the first Like it produced a listing with four likes
and a count of three.

`tools.like_count` is maintained by an AFTER INSERT trigger that ran **as the
person who liked** — and `tools_update` is `using (tool_is_mine(id))`, so the
update matched no rows. No error and no warning: row-level security *filters*,
it does not refuse. The same silence covered `save_count` and every column the
review counter maintains. It had never shown up because the seed inserts as the
owner, and the owner bypasses RLS wherever it is not forced.

`0014_counters.sql` moves the three counter functions to `SECURITY DEFINER`
behind one narrow policy — scoped to `foundit_owner`, which the application role
is neither a member of nor able to become, and gated on a setting the functions
turn on for the length of their own update. The result is stricter than what
shipped in `0001`: the only way to move these numbers is to insert or delete the
row they count, which is not true of a maintainer editing their own listing
today.

It also found the second half of the same defect: `updated_at` was being stamped
by a like, so `tool_problems.embedded_at < tools.updated_at` became true for any
listing anybody liked, and the embedding job's own rule for "this text changed"
started firing on a number. `tools_touch` now names the columns that are the
listing. **A like is not an edit**, and the two had been the same thing for five
phases.

The lesson is not about counters. It is that a rule which has only ever been
exercised by the migration that wrote it has not been exercised at all, and that
the way to find out is to do the thing rather than to read the schema.
