# The golden set

`eval/golden.jsonl` is 60 queries with known right answers. It is the standard the
search is measured against, and it exists so that "the ranking got better" is a claim
somebody can check rather than a claim somebody makes.

Written **10 September 2026**, before any ranking was tuned, against the development
catalogue in `db/seed/dev_seed.sql`.

---

## The one rule

**The golden set is never edited to make a score move.**

If a change to ranking drops the number, the change was worse. That is the entire
purpose of the file, and adjusting a judgement to rescue a score converts the evaluation
into a record of what the search already does — which is worth nothing, since we could
read that off the results page.

There are exactly three legitimate reasons to change a line:

1. **A judgement is factually wrong** — the tool graded 3 does not in fact solve the
   problem, or a tool that clearly does was never listed. Fix it, and say so in the
   commit message, *before* running the harness rather than after seeing its output.
2. **A tool left the catalogue.** Slugs must exist in the seed; if one goes, its
   judgements go with it.
3. **The catalogue grew a genuinely better answer.** Add it at the grade it deserves.

Doing any of these immediately after a disappointing run is how the rule gets broken by
people who believe they are being reasonable. If a run disappoints, record the number.

---

## Why it was written first

`docs/build-phases.md`, Phase 2: *"the golden set is written before any tuning, or it
becomes a rationalisation of whatever was built."* A set written afterwards encodes the
mistakes of the thing it is supposed to be judging, and every subsequent phase is then
measured against those mistakes.

It also fixes the measurement problem that made the development catalogue necessary at
all. With ten tools in the database every query returns everything, recall@10 is 1.0,
and the harness reports a perfect score for a search that has done nothing. The seed now
holds 223 published tools with deliberate near-misses in every domain, so a ranking can
be wrong, and therefore the number means something.

---

## The shape of a line

One JSON object per line, no trailing commas, UTF-8:

```json
{"id":"q001","query":"free app to split expenses with friends while travelling","lang":"en","note":"why these are right","constraints":{"pricing":["free","freemium","open_source"]},"relevant":{"splitwise":3,"tricount":2}}
```

| Field | Meaning |
| --- | --- |
| `id` | `q001` … `q060`, in file order. |
| `query` | What a person would type. Plain language, not keywords. |
| `lang` | BCP-47 tag for the language the query is written in. |
| `note` | One line on why these answers, so a human can audit the judgement later. |
| `constraints` | Optional. Any of `pricing`, `platforms`, `flags`, `languages`, each an array of values from the enums in `0001_init.sql`. |
| `relevant` | Tool **slug** → grade. Every slug must exist in `db/seed/dev_seed.sql` and be published. |

## What the grades mean

| Grade | Meaning | Test to apply |
| --- | --- | --- |
| **3** | Clearly the right answer. | If a knowledgeable friend were asked this question, this is what they would say first. Seeing it at rank 1 would feel correct. |
| **2** | A good alternative. | Solves the same problem well but is second choice — heavier, narrower, more expensive, or fewer people would reach for it. Seeing it in the top five would feel correct. |
| **1** | Defensible. | Solves part of the problem, or solves it by a route the asker did not have in mind. Seeing it on the first page would not be an error; seeing it at rank 1 would. |
| *absent* | Not relevant. | Everything not listed. Absence is a judgement too, and near-misses are deliberately absent. |

Every query has at least one 3. Two to six judgements is typical. A few queries have a
single answer (q033 meditation, q052 home automation) because the catalogue honestly
contains one, and inventing a second would be a lie in the direction of a nicer-looking
score.

## How the queries were chosen

- **Domains.** Money, travel, writing, study, images, audio, video, health, focus,
  privacy, files, documents, home, accessibility, communication, reading and language.
  Spread deliberately, because a set concentrated in one domain measures one domain.
- **Phrasing.** Varied on purpose. Some are short and near-keyword
  (`free screen reader for windows`), some are a whole sentence with the product word
  missing (`we all paid for different bits of the holiday and now nobody knows who owes
  who`), and some are vague on purpose (`something to help me stop forgetting things I
  read`, which has two honest right answers pointing in different directions).
- **Near-misses.** Every query lands in a part of the catalogue that contains several
  plausible-but-worse tools. That is what makes ranking able to be wrong.
- **Repeats across languages.** q002/q009, q029/q031 and q042/q057 are the same
  judgement asked in different languages. The gap between them is the size of the
  non-English problem, and Phase 4 is supposed to close it.

## Non-English queries

Ten of the sixty, written in their own scripts and not transliterated: Hebrew (3),
Spanish (2), French (2), Russian, Portuguese (pt-BR) and Arabic. The audience starts in
Israel and the United States and goes wider, and the interface being English does not
make the queries English.

Phase 2 has no translation step, so most of these will score badly at first. That is the
correct outcome to record, not a reason to soften the set. The seed carries a small
number of non-English problem statements so the slice is measurable rather than a flat
zero, and Phase 4's job is to move it.

## Constraint-carrying queries

Seventeen of the sixty carry a constraint: thirteen on pricing, two on flags, one on
platforms, one on languages.

Several are chosen so a **paid tool is otherwise the best match**, which is what makes
the constraint do real work rather than decorate the query:

| Query | The tool the constraint has to remove |
| --- | --- |
| q003 budgeting, data stays local | YNAB and Monarch Money — the best budgeting apps, both hosted and paid |
| q028 free video editor, no watermark | Camtasia — trial-only |
| q035 block distracting sites for free | Freedom (trial) and Deepwork (paid) |
| q038 free password manager that syncs | 1Password — paid |
| q040 password manager with a Russian interface | 1Password again — no Russian listed |
| q033 free guided meditation | Insight Timer — freemium, and the paywall is the point |

Every judgement in a constrained query satisfies that query's own constraint. That is
checked mechanically, not by eye: a relevant tool the filter would remove would punish
a search for filtering correctly, which is the opposite of what Phase 2 must prove.

## Checks that must pass

Before the set is used for anything:

- 60 lines, every one valid JSON, ids `q001`–`q060` in order.
- Every slug in every `relevant` map exists in `db/seed/dev_seed.sql` **and** is
  `status = 'published'`.
- Every query has at least one grade of 3; grades are only 1, 2 or 3.
- At least 8 non-English queries and at least 10 carrying a constraint.
- Every relevant tool satisfies the constraints its own query declares.

## What this set does not measure

Ordering *within* a grade, whether the fit score shown to a person is honest, latency,
and anything about the twenty-first result. It also cannot tell you whether the
catalogue contains the right tools — only whether search finds the ones it has. The
searches that come back with nothing good are a different signal, and they live in
`search_events` and on the operator dashboard.
