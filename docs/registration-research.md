# When Should Foundit Ask Users to Register?

Evidence-first research brief. Product: Foundit — desktop web, chat-style problem input → ranked tool results with fit score and "why this matches"; plus collections, likes, ratings/reviews, tool submission.

---

## 1. Sources consulted

| # | Source | What it says |
|---|---|---|
| 1 | [NN/g — Don't Force Users to Register Before They Can Buy](https://www.nngroup.com/articles/optional-registration/) | Registration is one of the most common complaints in e-commerce usability testing; sites that add a guest path typically see an immediate sales increase. Always provide a no-account "escape hatch." |
| 2 | [Baymard — Save Account Creation for the Confirmation Step (42% Don't)](https://baymard.com/blog/delayed-account-creation) | 42% of sites ask for an account before/at the start of checkout. Baymard's recommendation: defer the ask until after the user's goal is complete, when the data is already captured and the account costs one extra field. Show 3–5 concrete benefits at the moment you ask. |
| 3 | [NN/g — A Checklist for Registration and Login Forms](https://www.nngroup.com/articles/checklist-registration-login/) | Ask for the minimum — "email and password should be enough." No duplicate email/password fields, no email-confirmation step, disclose constraints upfront, offer social login so users reuse rehearsed credentials. |
| 4 | [NN/g — Popups: 10 Problematic Trends and Alternatives](https://www.nngroup.com/articles/popups/) | Popups before the user has received value are the top failure mode: "give value to your visitors before asking them anything." Prefer non-modal, dismissible banners and inline modules over blocking overlays; one prompt at a time. |
| 5 | [Google Identity — Sign in with Google case studies](https://developers.google.com/identity/sign-in/case-studies) | Reddit: button + One Tap ≈ 2× conversion. eBay: users 100% more likely to sign in on desktop and mobile web. Pinterest: users 2× more likely to use One Tap than multi-step sign-in. Iron Company: 8× sign-ups. |
| 6 | [Apple HIG — Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple) / [Buttons](https://developers.apple.com/design/human-interface-guidelines/technologies/sign-in-with-apple/buttons) | Display the button prominently; it must be **no smaller** than other sign-in buttons and users should not have to scroll to see it. Apps using a third-party/social login for the primary account must offer Sign in with Apple as an *equivalent* option. |
| 7 | [FIDO Alliance — Passkey Index (Oct 2025)](https://fidoalliance.org/fido-alliance-launches-passkey-index-revealing-significant-passkey-uptake-and-business-benefits/) | 93% sign-in success rate for passkeys vs ~63% for other methods; ~30% conversion lift; 73% faster login. 36% of eligible accounts have a passkey enrolled; 26% of sign-ins use one. |
| 8 | [Perplexity growth playbook — logged-out activation](https://www.startupriders.com/p/perplexity-growth-playbook-450m-arr) | Search works logged-out. The activation metric is **3 queries in first session** (target: 30% of logged-out visitors). Desktop gets a *soft half-screen prompt* first, escalating to a full takeover only around search #5; mobile web gets a takeover sooner. |
| 9 | [First Round Review — A/B testing at Duolingo](https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker/) | Moving the sign-up screen back a few steps produced roughly a **20% increase in DAU**. Duolingo runs "soft walls" (skippable, with a "Later" button) *before* hard walls — the hard walls perform significantly worse without the soft walls priming them. |
| 10 | [Corbado — Guest checkout vs forced login](https://www.corbado.com/blog/guest-checkout-vs-forced-login) (summarising Baymard) | Forced account creation is cited by ~24–26% of abandoners as a reason for leaving; roughly 35% will abandon if they cannot proceed without an account. |
| 11 | [Tech.co / gHacks — ChatGPT drops the login wall (Apr 2024)](https://www.ghacks.net/2024/04/02/chatgpt-no-longer-requires-an-account-to-use-but-there-are-some-limitations/) | OpenAI removed the account requirement for the free tier in April 2024 explicitly to make the product "approachable and accessible" to people unwilling to hand over personal info first. The category leader concluded the wall cost more than it earned. |
| 12 | [TechCrunch — Spotify replaces the heart with a plus](https://techcrunch.com/2023/02/27/spotify-kills-its-heart-button-to-be-replaced-with-a-plus-sign/) | Spotify collapsed "heart" (affection) and "add to playlist" (utility) into one **save** action, because the heart was ambiguous: users could not tell whether it was an opinion or a filing action. |
| 13 | [Leaky Paywall / gating benchmarks](https://leakypaywall.com/soft-paywall-vs-hard-paywall/) | Registration walls convert 3.2–6.7% of impressions vs 0.9–1.45% for a standard newsletter popup — because the wall catches users mid-task, at proven intent. Delayed gating reports ~35–45% higher conversion than hard gating. |

---

## 2. Soft gates vs hard gates vs action-triggered gates

**Hard gate (register before anything).** Maximises registered-user *rate per visitor who survives*, minimises the number who survive. Baymard's checkout data is the cleanest natural experiment: ~24–26% of abandoners name forced account creation, and ~35% abandon outright when there is no guest path. NN/g's e-commerce finding is the same in the other direction — adding a guest path produces an immediate lift. For a discovery product where the visitor has *no prior relationship and no cart*, the hard gate is strictly worse: the visitor has invested nothing, so has nothing to lose by leaving. ChatGPT — the product with the strongest possible reason to believe people would sign up — removed its wall in April 2024.

**Soft gate (free usage, then a skippable prompt).** Perplexity and Duolingo both do this and both publish the mechanism. Duolingo's number is the strongest single data point: pushing the sign-up screen back a few steps ≈ **+20% DAU**. Duolingo's second finding is the one most teams miss — the soft wall is not merely gentler, it *primes* the later hard wall; hard walls shown without a preceding ignorable soft wall convert significantly worse. Registration walls placed mid-task convert 3.2–6.7% of impressions versus ~1% for a cold newsletter popup, and delayed gating reports 35–45% better conversion than gating at entry.

**Action-triggered gate (free to consume, account required to *keep* something).** This is the highest-intent gate available, because the user has already declared what they want by clicking. The sign-up is no longer an abstract "join us" — it is the last step of an action already in flight. This is what Pinterest, Are.na and Product Hunt use for collections, and what Baymard recommends for checkout: ask when the data is already gathered and the account is one extra field.

### The two mechanisms

**Aha before ask.** The prompt must land *after* perceived value exceeds interaction cost. Before the first result set, "create an account" is a price quoted for an unknown good. After it, the price is quoted for something the user has just seen work. NN/g states this as a rule for popups: give value before asking for anything.

**Reciprocity + sunk value (endowment).** Two distinct forces. *Reciprocity*: the product gave a useful ranked answer for free, so a small counter-ask is socially cheap. *Sunk value / endowment*: once the user has typed a specific query in their own words and received a result set they consider theirs, registering **protects** an asset rather than buying an unknown one. This is why the copy at the gate must be about *keeping*, not *joining* — the psychological unit is loss, not gain. It is also why the pending action must survive auth: if a user signs up to save a tool and lands on an empty dashboard, the endowment is destroyed and the mechanism inverts into regret.

---

## 3. Recommendation for Foundit: a three-tier gate

**Headline: no hard gate before results. Hard-gate only writes.** Foundit's aha moment is the first ranked result set with fit scores and "why this matches" — that is cheap to serve and is the entire marketing argument. Gate the *writes*, because a write is by definition an act of intent, and a write without an account has nowhere to live.

| Action | Anonymous | Trigger | Notes |
|---|---|---|---|
| Land on homepage | Free | — | No modal on load, ever (NN/g: worst-performing popup timing) |
| First search / chat message | Free | — | The aha. Zero interruption |
| View ranked results, fit score, "why this matches" | Free | — | Full fidelity — do not blur or truncate |
| Open a tool detail page | Free | — | Also the SEO surface; must be crawlable and shareable |
| Read others' reviews/ratings | Free | — | Social proof works on logged-out users too |
| **Second search** | Free | **Non-blocking inline banner** below results, dismissible, persists dismissal | Duolingo-style soft wall; its job is priming, not converting |
| **Third search** | Free | Banner upgrades to a sticky, still-dismissible strip | Perplexity's escalation shape |
| **Fourth+ search** | Free | Nudge only every 3rd search; never blocks | Do **not** hard-gate search. Rate-limit abuse by IP, not by login |
| **Save to collection** | Hard gate | Modal, after optimistic UI shows the save landing | Pending action preserved |
| **Like a tool** | Hard gate | Same modal, lighter copy | Optimistic heart fills, then modal |
| **Rate & review** | Hard gate | Full page (long-form task, needs a URL) | Preserve draft text verbatim |
| **Submit a tool** | Hard gate + email verified | Full page | Spam surface; verification is justified here |
| Second-session return with anonymous saves in local storage | — | One-time banner: "You have 3 saved tools on this device" | Highest-intent moment in the whole funnel |

**Exact trigger rules**

1. Never show any sign-in prompt before the first result set has rendered.
2. After results render on search #2, show a non-blocking banner beneath the last result. Dismissal is remembered for 7 days.
3. Never block search. Free search is the acquisition engine and the shareable artefact.
4. Save / like / review / submit open the auth surface **after** an optimistic UI change, so the user sees the thing they are about to lose.
5. Persist the pending action to local storage *before* redirecting to auth (Firebase's guidance: migrate before sign-in, so a failed merge can fall back to the anonymous state). On auth success, replay it, then show a confirmation naming the specific object.
6. Cap total nudges at 3 per session.

---

## 4. Registration design

**Method.** Ship **Sign in with Apple + Sign in with Google + email magic link**, no password at all. Google's own case studies show the button plus One Tap roughly doubling conversion (Reddit), and eBay reporting users 100% more likely to sign in. Passwords add a creation cost now and a recovery cost forever; magic links remove both, at the cost of a real reliability tax — corporate mail scanners pre-fetch and burn one-time tokens, and opening the link in a different browser breaks the session. Mitigate by pairing every magic link with a **6-digit code shown on the same screen** that can be typed back into the original tab; this is the single highest-value detail in the flow. Add **passkeys as an upgrade offer after the second successful login**, not at registration — FIDO's 93% success rate and ~30% conversion lift are real, but enrolment at first contact adds an unfamiliar OS dialog to a moment that must be frictionless.

**Button order (desktop web).** Apple's HIG requires the Sign in with Apple button be no smaller than other sign-in buttons and visible without scrolling; if you offer social login for the primary account you must offer Apple as an equivalent option. On a desktop web app with no iOS app the legal requirement is softer, but the design guidance is sound. Recommended stack:

1. **Continue with Google** (largest addressable pool on desktop web)
2. **Continue with Apple** (identical width, height, corner radius, and font weight — equivalence is about visual parity, not order)
3. Thin divider — "or"
4. **Email field** with a single **Continue** button

**Google One Tap: yes, with conditions.** Use it on the *logged-out returning-visitor* path and at the gate — not as an interstitial on first landing. One Tap on cold arrival is exactly the "popup before value" pattern NN/g identifies as the worst timing, and it obscures content. Suppress it entirely until the first result set has rendered.

**Modal vs page.** **Modal** for save and like — short, single-purpose, and the user must not lose the result list behind it. **Full page** for review and submit — long-form tasks that deserve a URL, per NN/g's guidance that complex tasks in modals carry high interaction cost.

**Friction to remove:** no name field (derive from OAuth, or ask later in-product), no confirm-email field, no confirm-password (there is no password), no ToS checkbox — use inline text under the button: "By continuing you agree to the Terms and Privacy Policy," which is legally sufficient in most jurisdictions and removes a required click. No CAPTCHA on the happy path. No marketing-opt-in checkbox at the gate.

**Returning users.** One unified "Continue" flow — no separate Sign in / Sign up tabs. Detect the account server-side from the identifier and route accordingly. Remember the last method used and label it: "You used Google last time."

**Anonymous → account merge.** Write anonymous saves and likes to local storage keyed by a client-generated anonymous ID (cap at ~20 items). On auth, POST the pending payload, merge server-side with last-write-wins on duplicates, then clear local storage only after a 200. Show the merge result explicitly. Cross-device is intentionally out of scope — the local-storage carry-over is itself a reason to register.

---

## 5. Likes vs saves

The distinction that works is **public signal (ranking input) vs private utility (retrieval)**.

- **Product Hunt** separates the *upvote* — public, counted, drives the daily leaderboard — from *Collections*, which are user-curated lists. The upvote is a vote; the collection is a filing cabinet.
- **Pinterest** has only *save*, and it is the core verb; the boards are the product. There is no separate "like," because a save already implies approval — a useful warning that two overlapping verbs can be one too many.
- **Are.na** uses *connect* — adding a block to a channel. It is simultaneously an act of filing and, because channels are usually public, a curatorial signal. Are.na deliberately has no like count.
- **Spotify** collapsed heart-into-plus in 2023 precisely because users could not tell whether the heart was an opinion or a filing action.

**Recommendation for Foundit.** Keep both, but make them visually and semantically unequal.

- **Like** = public, counted, feeds ranking. Small ghost icon + count in the card's metadata row, next to the fit score. Low visual weight. Tooltip: "Helpful — improves ranking for queries like yours."
- **Save** = private, uncounted, the primary card action. A labelled "Save" button (text, not bare icon) in the card's action area. Saving never affects ranking.

Two rules keep the card uncluttered: (a) **one primary action per card** — Save is the button, Like is metadata; (b) **liking is only offered where the user has enough information to have an opinion** — show Like on the tool detail page and on hover in the result card, not persistently on every row. Never let a save silently imply a like.

---

## 6. Microcopy

**Post-first-search nudge banner** (non-blocking, below results, dismissible)

> **Keep your results.**
> Create a free account to save tools you like and pick up where you left off. Takes about five seconds.
> `[ Create free account ]`   `Not now`

**Save gate modal**

> **Save "Splitwise" to your collection**
> Sign in to keep this tool — and everything else you save. Free, no card, five seconds.
> `[ Continue with Google ]` `[ Continue with Apple ]`
> — or —
> `[ email field ]` `[ Continue ]`
> Small print: *We'll add Splitwise to your collection as soon as you're in.*

**Like gate modal**

> **Your vote counts.**
> Likes help rank tools for people searching like you. Sign in to add yours.

**Review gate (full page)**

> **Your review is saved as a draft.**
> Sign in to publish it. Nothing you've written is lost.

**Magic link sent screen**

> **Check your email**
> We sent a sign-in link to **amit@example.com**. It expires in 15 minutes.
> Or enter the 6-digit code from that email: `[ _ _ _ _ _ _ ]`
> `Resend link` · `Use a different email`

**Post-auth confirmation toast**

> **Saved.** Splitwise is in your collection — along with the 2 other tools you saved before signing in. `View collection →`

---

### Bottom line

Free search, free results, free tool pages, forever and for everyone. A skippable banner from search #2 whose job is priming, not converting. A hard gate only on save, like, review and submit — fired *after* an optimistic UI change, with the pending action replayed on the far side. Passwordless, three buttons, no name field, no ToS checkbox.
