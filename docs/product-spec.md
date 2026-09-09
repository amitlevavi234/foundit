# Solvd — Product Specification

**Version 1.0 · Draft for design + engineering · 2026-09-09**

---

## 1. Product name + pitch

**Name candidates**

| Name | Rationale | Risk |
|---|---|---|
| **Solvd** | Short, ownable, says "solved" without claiming a category word. Works in Hebrew transliteration (סולבד) and reads fine in RTL. | Vowel-dropped names are common; needs a strong mark. |
| Needle | "Needle in a haystack" — finding the one tool that fits. | Heavily used in dev tooling; SEO conflict. |
| Fitly | Emphasises constraint-fit over popularity. | Reads slightly cute; weaker as a verb. |

**Chosen: Solvd.** Used throughout this document.

**One-line pitch:** Describe the problem — Solvd finds the tool.

**Tagline (product surfaces):** "You don't need the name. Just the problem."

---

## 2. Problem, audience, positioning

### The problem

Discovery today is **name-first**. App stores rank by install volume and match on titles and keywords; you must already know roughly what the thing is called. Google returns SEO-optimised listicles ("17 Best Expense Apps in 2026") that are affiliate-driven, stale, and never account for your actual constraints. Neither surface understands "free", "works offline", "has a Hebrew interface", "doesn't upload my data".

The result: people either settle for the biggest brand in a category, or give up and do the thing manually.

### What Solvd does differently

Solvd indexes tools by **the problems they solve**, written in plain language, and by **structured constraints** that are verified and kept current. A query is parsed into intent plus constraints, matched semantically against problem statements, filtered on hard constraints, and ranked with honest explanations of why each result appeared — including what it does *not* do.

### Positioning statement

For people who know what they need but not what it's called, Solvd is a problem-first tool directory that recommends software matching your real constraints — unlike app stores and listicles, which rank by popularity and marketing spend.

### Personas

| | **Noa Barzilai** | **Marcus Ade** | **Priya Raghunathan** |
|---|---|---|---|
| Age / role | 27, product marketer, Tel Aviv | 41, operations lead, Manchester | 33, indie developer, Bangalore |
| Language | Hebrew primary, English fluent | English | English |
| Context | Planning a 9-person trip. Needs expense splitting her Hebrew-speaking friends will actually open. | Constantly asked "is there a tool for X?" by his team. Budget-constrained, privacy-cautious. | Built a small self-hosted receipt scanner. Wants users, hates marketing. |
| Frustration | English-only apps mean she becomes tech support for the whole group. | Every search result is an affiliate listicle. | Product Hunt gave one day of traffic, then nothing. |
| Success | Finds a free tool with a real Hebrew interface in under two minutes. | Gets three credible options with trade-offs stated, not fifteen. | Listing is verified, discoverable, and gets steady problem-matched traffic. |

Noa is the primary persona for search. Priya is the primary persona for submission and the verified-maker path. Marcus represents the repeat-visit, collection-building user.

---

## 3. Core principles

1. **Describe, don't name.** Every entry point accepts a sentence about a problem. Category browsing exists, but it is never the required path.
2. **Constraints are first-class.** Free, Hebrew, offline, open-source, no-account are not filters buried in a sidebar — they are extracted from the query, shown as chips, and directly drive ranking. A result that violates a stated hard constraint is excluded, not demoted.
3. **Honest recommendations.** Every card states why it matched and what it costs. Every detail page has a "Not good for" section. No paid placement, ever. Where a listing is affiliate-linked, it is labelled.
4. **Community-curated, editorially governed.** Anyone can submit; trusted reviewers approve. Facts are versioned and attributable. Opinions live in reviews, not in listing copy.
5. **Answer, then get out of the way.** The goal is a resolved problem in under two minutes. No forced signup, no interstitials, no engagement loops.

---

## 4. Information architecture

### Top-level navigation

Persistent header: **Logo (→ Homepage) · Search field (collapsed on Homepage, expanded elsewhere) · Browse · Submit a tool · Saved · Avatar menu**

Logged-out, the avatar menu is replaced by "Sign in". Reviewers see a **Queue** item with an unresolved-item count badge.

Footer: About · How ranking works · Guidelines · Report a listing · Language · Dark mode toggle.

### Screen map

```
Homepage
├── Results
│   ├── Clarifier (inline state of Results, not a separate route)
│   └── No-good-match state → Submit a tool
├── Tool detail
│   ├── Reviews (tab/section)
│   ├── Alternatives (section)
│   ├── Rate & review (modal → full flow)
│   ├── Suggest an edit → Edit a listing
│   └── Report a listing (modal)
├── Submit a tool (5 steps)
├── Saved
│   └── Collection detail → Share collection (public read-only view)
├── Profile (own / public)
├── Review queue (reviewers only)
│   └── Submission review · Edit review (diff view)
├── Auth (sign in / sign up / magic link sent)
└── Settings (Account · Language & region · Notifications · Privacy)
```

Canonical screen names used in section 5 and expected on artboards: **Homepage, Results, Tool detail, Submit a tool, Review queue, Edit a listing, Rate & review, Saved, Profile, Auth, Settings.**

---

## 5. Screen-by-screen specification

### 5.1 Homepage

**Purpose.** Communicate the model — you type a problem, not a name — and get the user into a query within one screen.

**Layout.** Single column, max content width 960px, centred.

*Above the fold:* header (logo left, minimal nav right); hero headline; the chat input; example prompt chips. Nothing else. The input sits at roughly 38% viewport height on desktop.

*Below the fold:* "Trending problems" (2-column list, 8 items), "Recently added" (3-card row), a three-step "How Solvd works" strip, footer.

**Elements.**

- **Hero headline (H1):** "Describe the problem. Find the tool."
- **Subhead:** "Search 4,200+ tools by what they actually solve — not by what they're called."
- **Chat input.** Large multi-line textarea, auto-growing to 4 lines, rounded, with a subtle inner shadow. Placeholder: "e.g. I need a free way to split expenses with friends while travelling — in Hebrew". Submit button inside the field, right-aligned (arrow icon, aria-label "Search"). Enter submits; Shift+Enter newlines. Character guidance appears at 300 chars: "Shorter questions usually work better."
- **Example chips** (5, horizontally wrapped, clicking populates and submits): "Split expenses with friends" · "Scan documents without an account" · "Track habits offline" · "Transcribe interviews in Hebrew" · "Self-hosted password manager".
- **Trending problems.** Section header "What people are trying to solve this week". Each row: problem phrasing + result count, e.g. "Remove background noise from a voice recording · 31 tools".
- **Recently added.** Section header "Just added". Card: icon, name, one-line problem summary, constraint chips, "Added 2 days ago by @priya".
- **How it works strip.** Three steps: "1. Describe it in your own words" / "2. We match against what tools actually solve" / "3. Compare on the constraints you care about".

**States.**

| State | Behaviour |
|---|---|
| Default | As above. |
| Focused input | Chips remain; a hint line appears below the field: "Include constraints like free, offline, Hebrew, or open-source — they change the results." |
| Submitting | Button becomes a spinner; input disabled; route transitions to Results within 150ms (do not hold the Homepage waiting for results). |
| Empty submit | Inline, non-blocking: "Tell us what you're trying to do — even one sentence helps." |
| Data unavailable (trending/recent fail) | Sections omitted silently. The hero never depends on network data. |

**Actions.** Primary: submit a query. Secondary: click an example chip; open a trending problem; open a recently-added tool; Submit a tool; Sign in.

---

### 5.2 Results

**Purpose.** Turn a sentence into a small, ranked, explained set of options, and let the user adjust the constraints the system inferred.

**Layout.** Two regions on desktop: a sticky top query bar spanning full width, and a single results column (max 860px) with a right rail (280px) on ≥1200px viewports. Below 1024px the rail collapses into a "Filters" sheet.

*Above the fold:* query bar with the user's text, extracted constraint chips, result count and sort control, and the first two result cards.

**Elements.**

- **Query bar.** The original query in an editable field ("I need a free tool to split expenses between friends while travelling, in Hebrew"), with a "Refine" affordance. Below it: **extracted constraint chips**, each toggleable and removable — `Free ×` `Hebrew ×` `Mobile ×` `Group expenses ×`. Chips have three visual states: active (filled), inactive (outline, struck), and inferred-but-soft (outline with a dotted border and a tooltip: "We guessed this from your query. Tap to turn off."). An "+ Add constraint" chip opens a taxonomy picker.
- **Clarifier.** When confidence is below threshold (see §6), a single card appears above results: heading "One quick question", the question ("Is this for a one-off trip, or ongoing shared costs like a flat?"), 2–4 answer chips, and a "Skip — show me everything" link. **Maximum one clarifying question per query.** Answering re-runs the search and replaces the card with a summary line: "Answered: one-off trip · Change".
- **Result count + sort.** "9 tools match. 3 strong matches." Sort dropdown: Best match (default) · Highest rated · Most recently updated · Free first.
- **Result card.** Icon (48px), name, one-line summary, then:
  - **"Why this matches"** — one or two generated sentences, visually distinct (tinted panel, small label): "Matches because it's built specifically for splitting trip costs across a group, has a full Hebrew interface, and the core features are free."
  - **Constraint satisfaction row** — small chips with status: `✓ Free` `✓ Hebrew` `✓ iOS · Android` `— No offline mode`. Satisfied chips are neutral-positive; unmet ones are muted grey with an em-dash, never red.
  - **Caveat line** where relevant: "Free plan shows ads."
  - Rating: `4.6 ★ · 812 ratings`.
  - Actions: **Save** (bookmark icon, optimistic), **Compare** (checkbox), card body links to Tool detail.
- **Right rail.** "Narrow it down" — grouped filter controls (Price, Platform, Language, Privacy & data, Licence), plus a "Nothing fits?" panel with a "Suggest a tool we're missing" button.
- **Sticky compare bar** appears when ≥2 cards are checked: "2 selected · Compare" .

**States.**

| State | Content |
|---|---|
| Loading | Query bar renders immediately with a shimmer on chips; three skeleton cards. Copy under the bar: "Reading your request…" then "Matching against 4,200 tools…" (swap at 700ms). |
| Strong results | As above. |
| Weak results (top score below threshold) | Banner above cards: "Nothing here is a great fit — these are the closest we found." Cards render with dimmed "why" panels. |
| No results | Full-panel empty state. Heading: "We don't have a good answer for this yet." Body: "Solvd only recommends tools we can stand behind, and nothing in our database fits: **free · Hebrew · mobile · group expenses**." Actions: "Know a tool that fits? Add it" (primary) · "Drop the Hebrew constraint" (secondary, one per hard constraint) · "Email me if this changes" (tertiary; email field inline for logged-out users). |
| Error | "Something broke on our side. Your search is safe." + "Try again". |
| Constraint removed | Results re-rank in place with a 200ms transition; a toast reads "Showing results without 'Free' · Undo". |

**Actions.** Primary: open a result. Secondary: toggle/remove constraints, answer the clarifier, sort, save, compare, submit a missing tool.

**Microcopy notes.** Never claim certainty the system lacks. Use "Matches because…", not "Perfect for you". Unmet constraints read as facts ("No Hebrew interface"), not failures.

---

### 5.3 Tool detail

**Purpose.** Give a person enough verified fact and honest opinion to commit to trying something — or to rule it out fast.

**Layout.** Two columns on desktop (main 680px, sticky sidebar 320px); stacked on mobile.

*Above the fold:* name, icon, one-line summary, constraint chips, rating summary, primary action ("Open Splitwise ↗"), Save.

**Main column, in order.**

1. **Header block.** Icon, name, verified-maker badge if applicable ("Maintained by the maker"), one-liner: "Splits shared expenses across a group and tells everyone who owes what." Constraint chips: `Free plan` `iOS · Android · Web` `Hebrew` `Account required`.
2. **Screenshots.** Horizontal gallery, 3–6 images, click to lightbox. Caption field per image. Empty state: a neutral placeholder with "No screenshots yet — [add one]" for logged-in users.
3. **Solves these problems.** The distinguishing section. A list of natural-language problem statements, each with a match-count signal: "Splitting a holiday's costs across a group of friends — *matched 1,240 searches*", "Tracking who paid for what in a shared flat", "Settling up in a currency that isn't your own". Each links to a Results screen pre-seeded with that phrasing.
4. **Good for / Not good for.** Two adjacent lists. Good for: "Groups of 3–15", "Multi-currency trips", "People who want a phone app, not a spreadsheet". Not good for: "Offline use — it needs a connection to sync", "Anyone unwilling to create an account", "Itemised receipt scanning (paid tier only)".
5. **Pricing.** Table: plan, price, what you actually get, catch. Row example: "Free · $0 · Unlimited groups and expenses · Ads in the app; receipt scanning locked."
6. **Platforms & languages.** Two chip rows. Language chips flag interface vs content support: "Hebrew (full interface)" vs "Hebrew (partial)".
7. **Ratings breakdown.** Overall number, 5-bar histogram, plus structured sub-scores derived from review prompts: "Solved my problem 4.7", "Easy to start 4.4", "Worth the price 4.1". Below: "Most recommended for: trips (68%) · shared flats (21%)".
8. **Reviews.** Sort: Most helpful · Newest · Lowest rated. Each review shows stars, "Used it for: splitting a two-week trip in Greece", body, author with trust level, date, and helpfulness votes ("Helpful (14)"). "Write a review" button opens Rate & review.
9. **Alternatives.** 3–4 cards with a differentiator line each: "Tricount — no account needed, weaker currency handling."
10. **Listing footer.** "Last verified 12 Aug 2026 by @marcus · Suggest an edit · Report this listing · View change history".

**Sidebar.** Sticky. Primary CTA "Open Splitwise ↗" (external-link icon, `rel="noopener"`), Save button with collection dropdown, share, and a facts block (licence, company/maker, first added, last updated, data location if known).

**States.** Loading: skeleton with header block prioritised. Unverified listing: amber strip, "Some details here haven't been verified in over 12 months. [Suggest an edit]". Delisted/dead: grey strip, "This tool appears to be discontinued. Last working check: 4 Mar 2026." with alternatives promoted to the top. Zero reviews: "No reviews yet. Used this? [Be the first to review it]".

**Actions.** Primary: open the tool, save. Secondary: review, suggest an edit, report, view alternatives, search a listed problem.

---

### 5.4 Submit a tool

**Purpose.** Get a high-quality listing from someone with 90 seconds of patience, while separating maker submissions from third-party recommendations.

**Layout.** Centred single column, 640px. Persistent step indicator across the top: `URL → Details → Problems → Constraints → Preview`. Back is always available; progress autosaves per step.

**Step 0 — Relationship (a short screen before Step 1).** Two large radio cards: "I made this tool" and "I'm recommending someone else's tool". The maker path adds an ownership-verification step before publication (see §8) and shows: "You'll be asked to verify ownership — a DNS record or a link from the tool's own site. Verified makers can update their own listing without waiting for review."

**Step 1 — URL.** Single field, label "Where does it live?", placeholder "https://". Helper: "A homepage, App Store page, or GitHub repo all work." Submit triggers fetch.
*States:* fetching ("Reading the page…", 8s timeout); success (metadata preview appears); duplicate found (blocking card: "We already list Splitwise. [View listing] · [Suggest an edit instead] · [This is a different tool]"); fetch failed ("We couldn't read that page. You can fill in the details manually.").

**Step 2 — Details.** Pre-filled from fetch, all editable: name, one-line summary (max 120 chars, live counter), icon (auto-pulled, replaceable), screenshots (drag-drop, up to 6), category. Helper on summary: "Say what it does, not why it's great. 'Splits shared expenses across a group' beats 'the #1 expense app'."

**Step 3 — Problems it solves.** The most important step, given the most space. Heading: "What problems does this solve?" Body: "Write like someone describing their situation — this is what people actually search." Three numbered natural-language inputs (first required, others encouraged), each with an example ghost: "Splitting a holiday's costs across a group of friends". A live panel on the right shows "People searching for this would find you" with 2–3 real recent queries that would now match — the strongest motivation for a maker to write good problem statements.

**Step 4 — Constraints & tags.** Structured, chip-based selectors: Price (Free / Freemium / Paid / One-time / Open-source), Platforms, Languages (searchable multi-select, Hebrew present and prominent), Offline capability, Account required, Data & privacy (self-hostable, no telemetry, E2E encrypted), Licence. Each answer is a claim: helper text reads "Only tick what's true today. Reviewers check these."

**Step 5 — Preview & submit.** Renders the actual Tool detail card as it will appear. Checkbox: "I've checked these details are accurate." Primary button: "Submit for review". Copy below: "A reviewer usually gets to submissions within 48 hours. We'll email you either way."

**States.** Draft saved ("Draft saved · continue anytime" in the step bar). Logged-out: the flow is fully usable through Step 4; Step 5 requires auth with a preserved draft — "Almost there. Sign in to submit — your draft is saved." Submission success: full-screen confirmation, "Submitted. We'll review it within 48 hours." with "Submit another" and "Back to search". Rejected/changes requested: entering the flow from an email link pre-loads the submission with the reviewer's note pinned at the top.

---

### 5.5 Review queue

**Purpose.** Let trusted reviewers clear submissions and edits quickly, with enough context to judge without leaving the screen.

**Access.** Trust level 2+ (see §8). Hidden entirely from other users.

**Layout.** Three panes on desktop: filter list (200px) · queue list (320px) · review pane (fill). Mobile: list, then full-screen review.

**Elements.**

- **Filters:** New submissions · Edit suggestions · Reported listings · Duplicate candidates · My claimed items. Each with a count. Queue items are claimable; a claimed item shows "Being reviewed by @marcus" for 30 minutes.
- **Queue item row:** tool name, submitter with trust level, age ("4h"), and flags — `Possible duplicate` `Unverified maker` `First submission` `Auto-flag: promotional language`.
- **Review pane.** Rendered listing preview at the top; below, an evidence strip: fetched page title vs submitted name, screenshot of the live homepage, similarity scores against the nearest three existing listings ("Splitwise — 0.91 similarity"). Then the checklist: "Does the summary describe function, not marketing?" / "Are the problem statements specific?" / "Do the constraint claims match the site?"
- **Decision bar (sticky bottom):** **Approve** · **Request changes** · **Merge duplicate** · **Reject**.
  - *Request changes* opens a note field with reusable snippets: "The summary reads like marketing copy — please describe what it does." / "Please confirm the Hebrew interface claim with a screenshot."
  - *Merge duplicate* opens a field-by-field merge picker (keep left / keep right / keep both) with the target listing.
  - *Reject* requires a reason from a fixed list (Spam · Not software · Dead link · Duplicate · Unfixable quality) plus optional note.
- **Edit review (diff view).** Field-level diff, old on the left with strikethrough, new on the right, unchanged fields collapsed. Header: "@noa suggested 3 changes to Tricount". Per-field accept/reject checkboxes so a reviewer can take two of three changes. Submitter's rationale is pinned above the diff.

**States.** Empty queue: "Queue's clear. Nice work." Conflict: "@marcus approved this while you were reviewing. [Refresh]". Reviewer-conflict-of-interest: if the reviewer is the submitter, all actions are disabled — "You can't review your own submission."

**Actions.** Primary: approve. Secondary: request changes, merge, reject, claim/release, open the tool's live site.

---

### 5.6 Edit a listing

**Purpose.** Let anyone correct facts without letting anyone break listings.

**Layout.** The Tool detail layout in edit mode — same visual structure, fields become inputs, edited fields get a left accent bar. Sticky bottom bar: "3 changes · Discard · Review changes".

**Flow.** Click "Suggest an edit" on Tool detail → fields become editable in place → "Review changes" shows a diff summary → a required rationale field ("What's changed? e.g. 'Free tier now caps at 3 groups — see their pricing page'") → **Submit suggestion**.

**Rules.** Verified makers editing their own listing skip review for descriptive fields but not for constraint claims or pricing (§8). Trust level 3 edits apply immediately and are logged. Everyone else's edits enter the Review queue.

**Change history.** Reachable from the listing footer. Reverse-chronological entries: "12 Aug 2026 · @noa changed Languages, Pricing · approved by @marcus · [View diff] · [Revert]" (revert restricted to trust level 3).

**States.** Pending edit exists: banner "@someone already suggested changes to this listing. [See what's pending]" to prevent duplicate work. Submitted: "Thanks — a reviewer will look at this within 48 hours." Applied immediately (high trust): "Your edit is live. It's recorded in this listing's history."

---

### 5.7 Rate & review

**Purpose.** Collect ratings that are useful for *matching*, not just averages — which is why the structured prompts matter more than the star count.

**Layout.** Modal on desktop (560px), full screen on mobile. Three short steps in one scroll, no pagination.

**Elements.**

1. **Stars.** "How well did it work for you?" 1–5, with a live label: 1 "Didn't work", 3 "Did the job", 5 "Solved it completely".
2. **Problem prompt (required).** "What did you use it for?" — free text with a placeholder "Splitting costs on a two-week trip with 6 people". Suggestion chips drawn from the tool's existing problem statements let users tap instead of type.
3. **Recommend-for prompt.** "Would you recommend it for…" — multi-select chips generated from the tool's use cases: `Trips` `Shared flats` `Couples` `Business expenses`, plus "Not for" toggling on each chip.
4. **Sub-ratings.** Three 1–5 sliders: "Easy to start", "Worth the price", "Would use again".
5. **Written review (optional).** Textarea. Helper: "What surprised you — good or bad? Specifics help more than adjectives."
6. **Verification note:** "Reviews from accounts under 7 days old are held for review."

**States.** Logged-out: stars are interactive, then a gate — "Sign in to post your rating. We'll keep what you've written." Editing an existing review: prefilled, header "Update your review", plus "Delete review". Success toast: "Posted. Thanks — this makes matching better for everyone." Held for moderation: "Posted for review. It'll appear once a moderator checks it."

**Helpfulness votes.** On Tool detail, each review has "Helpful" / "Not helpful" (aria-labelled), one vote per user, self-votes disabled. Sorting by "Most helpful" uses a lower-bound confidence score, not raw counts.

---

### 5.8 Saved

**Purpose.** Turn one-off searches into a personal, shareable library.

**Layout.** Header with title, view toggle (grid / list), search-within-saved, sort (Recently saved · Name · Rating), and "New collection". Left rail lists collections with counts; main area shows items.

**Elements.**

- **Grid card:** icon, name, one-line summary, constraint chips, personal note preview, "…" menu (Move to collection, Add note, Remove).
- **List row:** denser — icon, name, summary, constraints, note, saved date. Better for comparison; remembered per user.
- **Note per item.** Inline expanding textarea. Placeholder: "Why did you save this? e.g. 'Backup option if Tricount's currency handling is bad.'"
- **Collections.** Create modal: name, optional description, visibility (Private / Anyone with the link). Collection header shows title, description, item count, owner, and "Share" / "Duplicate" buttons.
- **Share.** Modal with a copy-link field and a toggle "Anyone with the link can view". Copy reads: "Shared collections are read-only. Your notes are included — remove any you'd rather keep private." Public collection view is a clean, logged-out-friendly page with a "Save a copy" CTA.

**States.** Empty (no saves): illustration + "Nothing saved yet. Tap the bookmark on any result to keep it here." with a "Start a search" button. Empty collection: "This collection is empty. Saved items can be moved here from the '…' menu." Logged-out: saves persist in local storage for the session with a banner — "You've saved 3 tools on this device. Sign in to keep them." Removed item: toast "Removed from Saved · Undo".

---

### 5.9 Profile

**Purpose.** Make contribution visible and legible, so trust is earned in public.

**Layout.** Header band: avatar, display name, handle, join date, trust level badge, short bio, and (own profile) "Edit profile". Below: tabs — **Submissions · Reviews · Collections · Activity**.

**Elements.**

- **Trust badge** with a tooltip explaining the level: "Reviewer — can approve submissions and edits. Earned after 10 accepted submissions and 30 days."
- **Contribution stats row:** "24 tools submitted · 21 approved · 88% acceptance · 47 reviews · 312 helpful votes".
- **Submissions tab.** Each row: tool, status pill (`Live` `In review` `Changes requested` `Rejected`), date. "Changes requested" rows are actionable on your own profile: "Reviewer asked for changes · [Open]".
- **Reviews tab.** Your reviews with the tool they belong to, helpfulness counts, and edit/delete on your own profile.
- **Maker section.** If the user has verified ownership: "Maker of: Receiptly ✓" with a link.
- **Public vs own view.** Public profiles hide rejected submissions, saved items, and email. Collections show only public ones.

**States.** New user, no contributions: "Nothing here yet. [Submit a tool] or [write a review] to get started." Suspended account: banner "This account is suspended for guideline violations." (public), with detail on the own view.

---

### 5.10 Auth

**Purpose.** Stay out of the way. Search, results, and detail pages must work fully logged-out.

| Capability | Logged-out | Logged-in |
|---|---|---|
| Search, results, tool detail | Yes | Yes |
| Save tools | Local-only, session-scoped, with a persistent nudge | Yes, synced, collections |
| Submit a tool | Draft through step 4 | Yes |
| Rate & review | Compose, gate at post | Yes |
| Suggest an edit | No — prompted to sign in | Yes |
| Review queue | No | Trust level 2+ |

**Layout.** Centred card, 400px, with a one-line value reminder above the form: "Sign in to keep your saved tools and post reviews."

**Elements.** Email field with primary button "Email me a link" (passwordless by default — no password field, no password reset flow), a divider "or", and OAuth buttons: "Continue with Google" and "Continue with GitHub" (GitHub listed for the maker audience). Below: "By continuing you agree to our Terms and Privacy Policy." Sign-in and sign-up are the same screen; account creation is implicit on first link use, with a display-name prompt afterwards.

**States.** Link sent: "Check your email. We sent a sign-in link to noa@example.com." with "Use a different address" and a resend link disabled for 30 seconds ("Resend in 0:28"). Expired link: "That link expired. Links last 15 minutes — [send a new one]". OAuth failure: "We couldn't complete that sign-in. Try again or use email." Post-auth: always return to the originating context with any draft or pending save applied — never dump the user on the Homepage.

---

### 5.11 Settings

**Purpose.** Language, notifications, and data control — nothing else in v1.

**Layout.** Left nav (Account · Language & region · Notifications · Privacy & data) with a form panel.

**Language & region.** Interface language select (English, Hebrew, Spanish, French, German, Portuguese, Russian, Arabic in v1 scope order). Selecting Hebrew or Arabic switches the app to RTL immediately with no reload and no confirmation. Below: a separate, important control — **"Only show tools that support my language"**, a toggle defaulting **off**, with helper text: "When on, results are limited to tools with a Hebrew interface." This is stored as a standing soft constraint applied to every search and surfaces on Results as a pinned chip: `Hebrew (from your settings) ×`.

**Notifications.** Grouped switches with plain-language labels: "When my submission is approved or needs changes" (default on) · "When someone suggests an edit to a tool I maintain" (default on, makers only) · "When a review replies to mine" (default on) · "Weekly digest of new tools in your saved categories" (default off) · "Items waiting in the review queue" (default on, reviewers only). Email and in-app columns per row.

**Privacy & data.** "Use my searches to improve matching" (default on, with a plain explanation), "Download my data", "Delete my account" (destructive, confirm by typing the handle; copy: "This removes your profile, saved items, and reviews. Listings you submitted stay published, credited to a deleted account.").

**States.** Saving is automatic per control with a subtle "Saved" affordance; no global save button. Failure: inline "Couldn't save that. [Retry]" with the control reverted.

---

## 6. Natural-language search behaviour

### Pipeline

```
query → normalise & language-detect → parse (intent + constraints)
      → candidate retrieval (semantic + lexical hybrid over ProblemStatements)
      → hard-constraint filter → soft-constraint scoring → rank
      → explanation generation → (clarify if low confidence)
```

**1. Parse.** An LLM call with a constrained JSON schema extracts:
- `intent` — a normalised problem phrase ("split shared expenses across a group during travel")
- `constraints[]` — each with `type`, `value`, `hardness` (hard | soft), and `confidence`
- `entities[]` — any named tools mentioned ("something like Splitwise but free")
- `query_language`

Constraint hardness rules: explicit words ("free", "must work offline", "open-source only") → hard. Inferred context ("while travelling" → mobile) → soft. The UI marks soft-inferred constraints with a dotted chip so users can see and remove the system's guesses.

**2. Retrieval.** Hybrid: dense vector search over ProblemStatement embeddings (each statement embedded separately, so a multi-purpose tool can match on one of its jobs) unioned with BM25 over statements, summary, and tags. Top 200 candidates.

**3. Hard filter.** Candidates violating a hard constraint are removed and counted; the count feeds the "no good match" copy ("14 tools solve this, but none are free and in Hebrew — [drop 'Hebrew']").

**4. Ranking.**

| Signal | Weight | Notes |
|---|---|---|
| Semantic match to problem statements | 0.40 | Max over the tool's statements, not mean — a tool that does one thing well shouldn't be penalised. |
| Soft-constraint satisfaction | 0.20 | Proportion satisfied, weighted by parse confidence. |
| Rating quality | 0.15 | Bayesian average with a prior; problem-specific sub-ratings weighted higher when the reviewer's stated problem is close to the query. |
| Freshness / liveness | 0.10 | Last verified date, last release, link health. Decays after 12 months. |
| Verified maker + listing completeness | 0.10 | Completeness only; verification never buys rank on its own beyond this cap. |
| Community signal | 0.05 | Saves and helpful-review volume, log-damped. |

No paid placement exists in the model. Any sponsored surface introduced later must be a labelled slot outside the ranked list.

**5. Explanations.** "Why this matches" is generated per result from structured facts, not free improvisation: the top-matching problem statement, the satisfied constraints, and at most one caveat pulled from the listing's "Not good for" list. The generator receives only the listing's own fields and is instructed never to assert unlisted capability. Explanations are cached per (intent-hash, tool, version) and regenerate when the listing changes.

**6. Ambiguity → clarification.** A clarifier fires when the top result's score is below 0.62, or when the top three results span more than one distinct category cluster, or when a required constraint dimension is missing for the detected category (e.g. no platform stated for a "note-taking" query). **Hard limit: one question per query.** The question is generated to be maximally discriminating between the current candidate clusters and always offers "Skip — show me everything".

**7. Multilingual.** Query language is detected. Retrieval uses a multilingual embedding model, so a Hebrew query embeds into the same space as English problem statements — a user typing "אני צריך אפליקציה חינמית לחלוקת הוצאות בטיול" retrieves the same candidates as the English equivalent. Critically, **query language ≠ required interface language**: writing in Hebrew adds a soft `language:he` constraint (confidence 0.6), shown as a removable chip, while writing "in Hebrew" or "with a Hebrew interface" makes it hard. Results, explanations, and UI render RTL when the interface language is RTL. Language claims on listings distinguish full interface support from partial or content-only.

### Worked example

**Query:** "I need a free tool to split expenses between friends while traveling in Hebrew"

**Parsed:**

| Field | Value |
|---|---|
| intent | "split shared expenses among a group of friends during a trip" |
| constraint: price | `free` — **hard**, confidence 0.95 |
| constraint: language | `he` (interface) — **hard**, confidence 0.88 ("in Hebrew" is explicit) |
| constraint: platform | `mobile` — **soft**, confidence 0.55 (inferred from "while traveling") |
| constraint: use-context | `travel/trip` — soft, confidence 0.80 |
| constraint: group-size | `small group` — soft, confidence 0.5 |
| query_language | `en` |

**Chips rendered:** `Free ×` `Hebrew ×` `Mobile ×` (dotted) `Trips ×` (dotted)

**Clarifier:** not fired — top score 0.81, single category cluster.

**Ranked results (illustrative):**

| # | Tool | Score | Free | Hebrew | Mobile | Offline | Why this matches (generated) |
|---|---|---|---|---|---|---|---|
| 1 | **Splitwise** | 0.89 | ✓ (ads on free) | ✓ full | ✓ iOS/Android | — | "Built specifically for splitting trip costs across a group, with a full Hebrew interface and free core features. Note: the free plan shows ads and caps receipt scanning." |
| 2 | **Tricount** | 0.85 | ✓ | ✓ full | ✓ | ✓ partial | "Made for group trips, works without creating an account, and has a Hebrew interface. Handles multi-currency well; the web version is weaker than the app." |
| 3 | **Settle Up** | 0.78 | ✓ (free tier) | ✓ partial | ✓ | ✓ | "Covers group expense splitting including offline entry. Hebrew support is partial — some screens are still English." |
| 4 | **Spliddit** | 0.61 | ✓ | ✗ | Web only | — | *Excluded by hard filter (no Hebrew).* Counted in "3 more tools solve this but aren't in Hebrew." |
| 5 | **Excel/Sheets template** | 0.44 | ✓ | ✓ | ✓ | ✓ | Shown under "Lower-tech options" only when fewer than three strong matches exist. |

Result header renders: **"3 tools match. 3 strong matches."** with a secondary line: "3 more solve this but aren't available in Hebrew — [show anyway]".

---

## 7. Data model

**Tool** — `id`, `slug`, `name`, `summary` (≤120 chars), `description`, `icon_url`, `screenshots[]` (url, caption, order), `primary_url`, `alternate_urls[]`, `category_id`, `status` (draft | in_review | live | needs_update | discontinued), `maker_user_id?`, `verified_maker` (bool), `first_added_at`, `last_verified_at`, `last_verified_by`, `link_health` (ok | redirect | dead, checked_at), `embedding_version`.

**ProblemStatement** — `id`, `tool_id`, `text` (natural language, 1–200 chars), `embedding` (vector), `source` (submitter | maker | derived_from_review | editor), `search_match_count`, `is_primary`, `created_by`, `status`. Many per Tool; this is the core search surface.

**Constraint** (taxonomy node) — `id`, `dimension` (price | platform | language | offline | licence | privacy | account | accessibility), `key`, `label_i18n`, `parent_id?`, `is_filterable`, `sort_order`. Fixed, editorially controlled vocabulary.

**ToolConstraint** — `tool_id`, `constraint_id`, `value` (bool | enum | string), `qualifier` (e.g. "full" / "partial" for language; "free tier" for price), `evidence_url?`, `verified_at`, `verified_by`. Constraint claims are versioned separately from descriptive copy because they carry more risk.

**Rating** — `id`, `tool_id`, `user_id`, `stars` (1–5), `sub_scores` {ease_of_start, worth_the_price, would_use_again}, `problem_text`, `problem_embedding`, `recommend_for[]` (constraint/use-case ids), `not_for[]`, `created_at`, `updated_at`. One per (user, tool).

**Review** — `id`, `rating_id`, `body`, `status` (published | held | removed), `helpful_count`, `not_helpful_count`, `helpfulness_score` (Wilson lower bound), `moderation_flags[]`.

**Submission** — `id`, `submitter_id`, `relationship` (maker | third_party), `payload` (full proposed Tool + ProblemStatements + ToolConstraints), `status` (draft | pending | changes_requested | approved | rejected | merged), `assigned_reviewer_id?`, `claimed_until`, `reviewer_note`, `rejection_reason`, `duplicate_candidates[]` {tool_id, similarity}, `created_at`, `decided_at`.

**EditSuggestion** — `id`, `tool_id`, `author_id`, `changes[]` {field_path, old_value, new_value, accepted?}, `rationale`, `status` (pending | partially_accepted | accepted | rejected | auto_applied), `reviewer_id`, `decided_at`. Accepted suggestions write a **ChangeHistory** row (`tool_id`, `edit_suggestion_id`, `fields[]`, `actor_id`, `applied_at`, `revertible_until`).

**Collection** — `id`, `owner_id`, `name`, `description`, `visibility` (private | link), `share_slug`, `item_count`, `created_at`. Default per user: "Saved" (undeletable).

**SavedItem** — `id`, `user_id`, `tool_id`, `collection_id`, `note`, `saved_at`, `source_query?` (the query that produced the save — feeds ranking and the ProblemStatement `derived` pipeline).

**User** — `id`, `handle`, `display_name`, `email`, `avatar_url`, `bio`, `locale`, `text_direction`, `language_filter_enabled`, `notification_prefs` (jsonb), `trust_level_id`, `reputation_points`, `is_suspended`, `created_at`.

**TrustLevel** — `id`, `level` (0–3), `name` (New · Contributor · Reviewer · Editor), `permissions[]`, `earn_criteria` (jsonb). See §8.

**SearchQuery** (analytics + improvement) — `id`, `user_id?`, `session_id`, `raw_text`, `detected_language`, `parsed_intent`, `parsed_constraints` (jsonb), `result_tool_ids[]`, `clicked_tool_id?`, `saved_tool_id?`, `clarifier_shown`, `clarifier_answer?`, `no_result` (bool), `created_at`. `no_result` queries drive the submission backlog and the trending-gaps list for reviewers.

**Report** — `id`, `target_type` (tool | review | user), `target_id`, `reporter_id`, `reason` (enum), `note`, `status`, `resolved_by`.

---

## 8. Trust, quality and moderation

**Trust levels.**

| Level | Name | Earned by | Can |
|---|---|---|---|
| 0 | New | Sign up | Save, review (held if account <7 days), submit (queued) |
| 1 | Contributor | 3 accepted submissions or edits | Submit without extra held-review; suggest edits |
| 2 | Reviewer | 10 accepted contributions + 30 days + no upheld reports | Access Review queue; approve, request changes, reject |
| 3 | Editor | Invitation by staff | Apply edits directly; merge duplicates; revert; manage taxonomy; suspend accounts |

**Spam prevention.** Rate limits: 3 submissions/day at level 0, 10 at level 1+. New accounts cannot submit for the first hour. Automated checks flag rather than block: promotional-language classifier on summary and problem statements, link reputation, duplicate-domain velocity (five submissions from one domain in a week auto-flags all of them), and a review-burst detector (a tool receiving >10 five-star reviews from accounts under 14 days old holds those reviews and notifies editors). Reviews from accounts under 7 days old are held. Self-review by a verified maker is blocked outright.

**Duplicate detection.** At submission time: exact and normalised URL match, domain match, name Levenshtein distance, and embedding similarity across summary and problem statements. Similarity ≥0.85 blocks with a "we already list this" card; 0.65–0.85 flags for the reviewer with the candidates shown inline. Merging preserves both listings' ProblemStatements, ratings, and history under the surviving `tool_id`, with the merged slug 301-ing.

**Verified maker.** Proven by one of: a DNS TXT record, a link back to the Solvd listing from the tool's own site, or an email at the tool's domain. Grants a badge, direct editing of descriptive fields, notifications about edits and reports, and the ability to respond publicly to reviews (once per review, labelled "Maker response"). It does **not** grant ranking preference beyond the completeness component, does not allow editing pricing or constraint claims without review, and does not allow removing or hiding negative reviews. Verification is revoked on domain change.

**Edit approval rules.**

| Editor | Field type | Outcome |
|---|---|---|
| Level 0–1 | Any | Queued for review |
| Verified maker | Descriptive (summary, screenshots, problem statements) | Applied immediately, logged |
| Verified maker | Pricing, constraint claims | Queued for review |
| Level 2 | Any (not own submission) | Applied immediately, logged |
| Level 3 | Any | Applied immediately, revertible |

Every applied change writes ChangeHistory and is publicly visible. Two reverts of one user's edits within 30 days triggers an editor review of their trust level.

**Reporting.** "Report this listing" on Tool detail and every review. Reasons: Dead or broken link · Wrong information · Spam or fake · Malware or unsafe · Inappropriate content · Duplicate. Three independent "dead link" reports plus a failing automated link check flips a listing to `needs_update` and shows the amber strip automatically. Malware reports page an editor immediately and hide the listing pending review. Reporters see resolution status on their profile.

**Listing decay.** Any listing not verified in 12 months shows the unverified strip and takes the freshness ranking penalty. Reviewers get a "Needs re-verification" queue filter sorted by search volume, so high-traffic listings get refreshed first.

---

## 9. Visual design direction

**Mood.** Calm, confident, editorial. Solvd should feel closer to a well-made reference publication than to a SaaS dashboard — the product's credibility *is* its value, so restraint reads as trustworthiness. Avoid: gradient hero blobs, floating 3D app mockups, purple-to-blue gradients, dashboard chrome, badge clutter, and any "AI sparkle" iconography. The intelligence should be evident in the quality of the answers, not announced with a wand icon.

**Layout rhythm.** Generous vertical space in the hero, then a tightening rhythm as content becomes denser. Results should feel like a considered shortlist, not an infinite feed: wide cards, roughly 8–10 above the fold on a laptop only when scrolled, comfortable internal padding, and clear separation between cards. Use a consistent baseline rhythm so mixed content (text, chips, ratings) sits on a shared grid. Content max-widths matter more than a 12-column grid here; most screens are one or two columns.

**Type.** A pairing that signals editorial judgement without losing UI clarity: a humanist or transitional serif for headlines and problem statements (the strings users read as *language*), paired with a highly legible neutral sans for UI, labels, and chips. Suggested direction: **Instrument Serif or Source Serif 4** for display, **Inter or Geist** for interface. Hebrew requires a genuine companion, not a fallback — specify **Heebo** or **Assistant** for the sans, and accept a sans display face in Hebrew rather than a mismatched serif. Numerals should be tabular in ratings and pricing tables.

**Colour.** A warm near-neutral ground (paper, not pure white) with high-contrast ink text, and one distinctive accent. Direction for the accent: a deep, slightly desaturated **teal-green** — it reads as "verified/resolved" without the medical connotation of pure green or the default-SaaS feel of blue. Use the accent sparingly and meaningfully: primary CTAs, the "why this matches" panel, satisfied-constraint chips, and the active state of extracted constraints. Everything else is neutral. Reserve a muted amber for "unverified/needs attention" and a restrained red strictly for destructive actions — never for unmet constraints, which are informational and should render as neutral grey.

**Result cards.** They should read as *arguments*, not tiles. Hierarchy inside a card: name → why this matches → constraint satisfaction → rating. The "why this matches" panel is the signature element of the product and should be visually distinct (a tinted, slightly inset panel with a small label), because it is the thing no competitor has. Cards should be hoverable but not bouncy — a subtle border-colour and elevation shift, no scale transforms. Constraint chips need three legible visual states (satisfied, unmet, inferred) that work without relying on colour alone.

**RTL / Hebrew.** RTL is a first-class layout, not a mirroring afterthought. Design Hebrew artboards for Homepage, Results, and Tool detail alongside the English ones. Requirements: full logical-property layout (`inline-start`/`inline-end`), mirrored icons for directional affordances only (arrows, back) and never for non-directional ones (bookmark, star, external link), correct bidi handling for mixed strings (Hebrew review text containing a Latin tool name), numerals and star ratings left-to-right within RTL lines, and Hebrew line-height roughly 0.05–0.1em looser than the Latin equivalent. Hebrew has no true italic — specify weight or colour for emphasis instead.

**Dark mode.** Full support, designed rather than inverted. Dark surfaces should be a warm near-black rather than pure black, with elevation communicated by surface lightness steps rather than heavy shadow. The accent needs a lighter, slightly more saturated dark-mode variant to hold contrast on dark ground. Verify the "why this matches" panel and chip states in both themes at AA.

**Accessibility baseline.** WCAG 2.2 AA. All interactive targets ≥44×44px on touch. Visible focus rings on every control including chips. Constraint states distinguishable by icon and label, not colour. Result relevance announced to screen readers on update ("9 results, 3 strong matches").

---

## 10. MVP scope vs later

| Area | v1 (MVP) | v2 |
|---|---|---|
| Search | NL parse, hybrid semantic + lexical, constraint chips, one clarifying question | Multi-turn refinement, "like X but…" comparative queries, saved searches with alerts |
| Results | Ranked list, why-this-matches, sort, no-match state | Side-by-side compare table, "lower-tech alternatives" module |
| Tool detail | Full listing, screenshots, problems, good/not-good-for, pricing, ratings, reviews, alternatives | Maker responses to reviews, changelogs, pricing-change alerts |
| Submission | 5-step flow, URL auto-fetch, maker vs third-party, duplicate blocking | Bulk import, API for makers, GitHub-repo auto-sync |
| Moderation | Review queue, approve/changes/reject/merge, diff view, trust levels 0–3 | Automated pre-screening scores, reviewer analytics, appeals flow |
| Ratings | Stars, structured prompts, sub-scores, helpfulness votes | Verified-usage signals, review replies, problem-specific rating slices surfaced in ranking |
| Saved | Saved list, collections, notes, link sharing | Collaborative collections, public curated collections with follower counts |
| Profile | Submissions, reviews, trust level, maker badge | Public contribution graph, reviewer leaderboards |
| Auth | Magic link, Google, GitHub | SSO for teams, org accounts |
| i18n | English + Hebrew (full RTL), language constraint in search | Spanish, French, German, Arabic; machine-assisted listing translation with review |
| Platform | Responsive web | PWA install, browser extension ("find a tool for this page"), public API |

**Explicitly out of scope for v1:** paid placement of any kind, affiliate revenue, a mobile native app, in-product tool comparison charts, and user-to-user messaging.

---

## 11. Success metrics

| # | Metric | Definition | v1 target |
|---|---|---|---|
| 1 | **Problem resolution rate** | Share of search sessions with a click-through to a tool followed by no reformulated query within 10 minutes. The core quality measure. | ≥45% |
| 2 | **First-query success** | Share of sessions resolved on the first query without reformulation or constraint removal. | ≥30% |
| 3 | **No-match rate** | Share of queries returning zero results after hard filtering. Tracks catalogue coverage; should fall over time. | <12% by month 6 |
| 4 | **Save rate per session** | Sessions with ≥1 save. Proxy for genuine usefulness over idle browsing. | ≥18% |
| 5 | **Listing freshness** | Share of live listings verified within the last 12 months. Directly protects trust. | ≥85% |
| 6 | **Submission approval rate + median review latency** | Quality of the intake funnel and the health of the reviewer pool. | ≥60% approved; median <24h |
| 7 | **Hebrew query resolution parity** | Metric 1 computed for Hebrew-language sessions, expressed as a ratio to the English rate. Guards against i18n being nominally shipped but functionally worse. | ≥0.9 |

**Guardrail metrics (watched, not optimised):** review report rate, share of ranked results in the top 3 that are the most popular tool in their category (a rising number means the ranking is collapsing toward popularity), and reviewer burnout (queue age at the 90th percentile).
