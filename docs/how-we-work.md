# How we work

Written for the owner of this project, who is not a developer. It explains the two
environments, what is safe to touch, and the handful of rules that keep a free-tier
project from breaking or costing money. Full reasoning and sources are in `research/`.

---

## The two environments

```
   develop  ──────►  Development site  ──────►  Supabase project "foundit-dev"
   (your work)       (only you see it)          (fake data, safe to break)
       │
       │  merge when it works
       ▼
   main     ──────►  Production site   ──────►  Supabase project "foundit-prod"
   (the real one)    (the public)               (real users, real reviews)
```

**Everything starts on `develop`.** Changes are built and tried there against the
development database. When a change works, `develop` is merged into `main`, and only
then does the public see it. Nothing is ever edited directly in production — not the
code, not the database.

Two Supabase projects is exactly what the free plan allows, so there is no third one
to spare. The development project holds invented data. If it gets mangled, we reset it
and lose nothing.

## The rules that matter

1. **Never put production credentials in a local file.** Your machine talks to the
   development database only. The production keys live in Vercel and nowhere else.
2. **Database changes travel as migration files**, committed to the repository. If a
   change is clicked into the Supabase dashboard instead, the two environments quietly
   drift apart and nobody finds out until production breaks. A check in CI fails the
   build if the database stops matching the files.
3. **The free Supabase plan takes no backups.** None. We run our own scheduled dump,
   and we test restoring it — a backup nobody has restored is not a backup.
4. **Every service that can bill us has a hard cap set**, and the app enforces its own
   limits on top. See the cost report for the exact settings.
5. **Secrets never enter the repository.** They live in Vercel's environment variables
   and GitHub Actions secrets. `.env.local` stays on your machine and is ignored by git.

## What "done" means for a change

A change is finished when: it works on the development site, the automatic checks pass,
the database migration is committed alongside the code, and the search quality test has
not got worse. Then it merges to `main`.

## When something goes wrong

| Symptom | First thing to check |
| --- | --- |
| The site is up but has no data | The free Supabase project pauses after a week of no traffic — wake it in the dashboard |
| A change worked locally and broke in production | The environments have drifted; check whether a migration was skipped |
| Costs appear where there should be none | Check the spending caps are still set, and the rate limits in the app |
| Search results got worse | Run the relevance test set before changing anything else |

## Vocabulary

- **Branch** — a parallel copy of the project. `develop` is where work happens, `main` is what the public sees.
- **Merge** — copying finished work from one branch into another.
- **Migration** — a file describing one change to the database, applied in order so both environments end up identical.
- **CI** — automatic checks that run on every change, before it can be merged.
- **RLS (row level security)** — rules inside the database saying who may read and write each row. The real security boundary, enforced even if the app has a bug.
