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
