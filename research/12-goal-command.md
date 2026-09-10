# Claude Code `/goal` — official-source research

Researched 2026-09-10. **Sources restricted to official Anthropic properties.** Every claim below carries a URL.
Primary source is the dedicated docs page: <https://code.claude.com/docs/en/goal>
(`docs.claude.com/en/docs/claude-code/*` now 301-redirects to `code.claude.com/docs/en/*` — same official docs site.)

Status of this file: **complete** — see the "What I could NOT confirm" section at the end for the gaps.

---

## 1. What `/goal` is and what it does

> "The `/goal` command sets a completion condition and Claude keeps working toward it without you prompting each step. After each turn, a small fast model checks whether the condition holds. If the model judges it not yet met, Claude starts another turn instead of returning control to you. The goal clears automatically once the condition is met, if the model judges the condition impossible to satisfy, or if a turn fails on an error you have to fix."
> — <https://code.claude.com/docs/en/goal>

**What kind of command is it?** A **built-in command** — explicitly classified as such in the official commands reference, and distinct from `/loop`, which the same page classifies as a *bundled skill*. The reference row reads:

> | `/goal [condition\|clear]` | Set a [goal](/docs/en/goal): Claude keeps working across turns until the condition is met or the goal [clears for another reason](/docs/en/goal#how-evaluation-works). With no argument, shows the current or most recently achieved goal. `clear`, `stop`, `off`, `reset`, `none`, or `cancel` removes an active goal early |
>
> — <https://code.claude.com/docs/en/commands>

Mechanically it is described as:

> "`/goal` is a wrapper around a session-scoped [prompt-based Stop hook](https://code.claude.com/docs/en/hooks#prompt-based-hooks)."
> — <https://code.claude.com/docs/en/goal>

So it is not a plugin and not a user-authored skill; it is built into Claude Code and implemented on top of the hooks system. That implementation detail has a real consequence — see §6 (Requirements).

**Documented use cases** (verbatim list):

> "Use a goal for substantial work with a verifiable end state:
> * Migrating a module to a new API until every call site compiles and tests pass
> * Implementing a design doc until all acceptance criteria hold
> * Splitting a large file into focused modules until each is under a size budget
> * Working through a labeled issue backlog until the queue is empty"
> — <https://code.claude.com/docs/en/goal>

**One goal per session.**

> "One goal can be active per session. The same command sets, checks, and clears it depending on the argument."
> — <https://code.claude.com/docs/en/goal>

### When it was introduced — CONFIRMED

**`/goal` was introduced in Claude Code v2.1.139.** Verbatim changelog entry, from the official `anthropics/claude-code` repository:

> "Added `/goal` command: set a completion condition and Claude keeps working across turns until it's met. Works in interactive, `-p`, and Remote Control. Shows live elapsed/turns/tokens as an overlay panel"
> — `## 2.1.139`, <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

Note two things the introduction entry adds that the docs page does not: the three supported surfaces at launch (interactive, `-p`, Remote Control), and that the live elapsed/turns/tokens display is "an overlay panel".

### Full changelog history of `/goal` (official repo, verbatim)

Every line in `anthropics/claude-code`'s CHANGELOG.md mentioning `/goal`, with its version heading. Source for all: <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>

| Version | Verbatim entry |
| :-- | :-- |
| **2.1.139** | "Added `/goal` command: set a completion condition and Claude keeps working across turns until it's met. Works in interactive, `-p`, and Remote Control. Shows live elapsed/turns/tokens as an overlay panel" |
| 2.1.140 | "Fixed `/goal` silently hanging when `disableAllHooks` or `allowManagedHooksOnly` is set — now shows a clear message instead of an indicator that never resolves" |
| 2.1.143 | "Fixed `/goal` evaluator firing while background shells or delegated subagents are still running" |
| 2.1.154 | "Fixed background-session classifier losing the user's goal when a scheduled `/command` fires" |
| 2.1.172 | "Reduced idle CPU usage: `/goal` status chip no longer re-renders the terminal at 5 Hz while idle, and fewer UI re-renders while subagents run in parallel" |
| 2.1.234 | "`/goal` now clears itself with a notice when a turn dies on an unrecoverable error (e.g. revoked auth, an exhausted credit balance, or a context overflow) instead of staying armed" |
| 2.1.234 | "`/goal`: when background tasks keep a goal waiting for 30+ minutes, Claude now checks in on them instead of waiting indefinitely (set `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` to opt out)" |
| 2.1.236 | "`/goal`: an idle session whose goal is parked behind long-running background work now checks in automatically after 30 minutes (then 1h, 2h) instead of waiting for you to return" |
| 2.1.236 | "Right-aligned footer items (goal indicator, session state, background agent status) and truncated notices now share a consistent right margin with the rest of the prompt area" |
| 2.1.239 | "`/goal`: repeat check-ins on long-running background work now back off (30 min, then 1 h, then every 2 h) instead of repeating every 30 minutes" |
| 2.1.239 | "`/goal`: resuming a session from the `claude --resume` picker now restores its active goal" |
| 2.1.246 | "`/goal`: Changed idle sessions to start at most three check-ins on long-running background work per goal; your next message allows three more" |

This is the complete set — a `grep -i goal` over the whole 6,475-line changelog returns exactly these twelve lines. The changelog carries version headings but no calendar dates, so the release *date* of 2.1.139 is still not established (see gaps).

The `/goal` docs page pins the same behaviours to versions:

| Behaviour | Minimum version | Source |
| :-- | :-- | :-- |
| Background-work check-ins exist at all | **v2.1.234** | <https://code.claude.com/docs/en/goal> |
| Idle check-ins exist at all | **v2.1.236** | <https://code.claude.com/docs/en/goal> |
| Goal restored on the `claude --resume` picker route | **v2.1.239** | <https://code.claude.com/docs/en/goal> |
| Back-off applied to turn-end check-ins too | **v2.1.239** | <https://code.claude.com/docs/en/goal> |
| Idle check-ins capped at three per goal between prompts | **v2.1.246** | <https://code.claude.com/docs/en/goal> |

---

## 2. `/goal` vs `/loop` — the central comparison

The docs put these side by side themselves. This table is **quoted verbatim** from the official page:

> | Approach | Next turn starts when | Stops when |
> | :-- | :-- | :-- |
> | `/goal` | The previous turn finishes, or an idle check-in comes due while background work keeps the goal waiting, up to three times per goal between your prompts | A model confirms the condition is met or judges it impossible, or a turn fails on an error you have to fix, or you run `/goal clear` |
> | `/loop` | A time interval elapses | You stop it, or Claude decides the work is done |
> | Stop hook | The previous turn finishes | Your own script or prompt decides |
>
> — <https://code.claude.com/docs/en/goal> ("Compare ways to keep a session running")

And the follow-on prose:

> "`/goal` and a Stop hook both fire after every turn. `/goal` is a session-scoped shortcut: you type a condition and it's active for the current session only. A Stop hook lives in your settings file, applies to every session in its scope, and can run a script for deterministic checks or a prompt for model-evaluated ones."
> — <https://code.claude.com/docs/en/goal>

Cross-reference from the `/loop` side:

> "To keep the session working turn after turn toward a condition rather than on an interval, see `/goal`."
> — <https://code.claude.com/docs/en/scheduled-tasks>

And the "See also" entry on the goal page describes `/loop` as:

> "Run a prompt repeatedly with `/loop`: re-run on a time interval instead of toward a condition"
> — <https://code.claude.com/docs/en/goal>

### Full side-by-side, assembled from both official pages

| Dimension | `/goal` | `/loop` |
| :-- | :-- | :-- |
| Source page | <https://code.claude.com/docs/en/goal> | <https://code.claude.com/docs/en/scheduled-tasks> |
| Signature | `/goal [condition\|clear]` | `/loop [interval] [prompt]` (alias `/proactive`) — <https://code.claude.com/docs/en/commands> |
| Official classification | **Built-in command** (<https://code.claude.com/docs/en/commands>); "a wrapper around a session-scoped prompt-based Stop hook" | **Bundled skill** (<https://code.claude.com/docs/en/commands>, <https://code.claude.com/docs/en/skills#bundled-skills>) |
| Introduced | v2.1.139 | not established in this research |
| Trigger for next turn | Previous turn finishing (plus idle check-ins during background work) | "A time interval elapses" — fixed cron interval, or an interval Claude picks per iteration (1 min–1 hr) |
| What is re-sent each turn | Nothing re-sent; the conversation continues. Evaluator's reason becomes guidance: "Claude keeps working and takes the reason as guidance for the next turn" | The prompt is re-run. Fixed-interval loops are cron jobs (`CronCreate`) |
| Who decides completion | A separate evaluator model (small fast model, Haiku by default on the Claude API) reading the transcript | Claude itself in self-paced mode ("Claude calls the `ScheduleWakeup` tool with `stop: true`"), or the user, or 7-day expiry |
| Continuity | Same conversation, turn after turn | Iterations fire "between your turns"; scheduler enqueues at low priority |
| Concurrency | "One goal can be active per session" | "A session can hold up to 50 scheduled tasks at once" |
| Hard time bound | None documented, other than the condition text itself | "Recurring tasks automatically expire 7 days after creation" |
| Minimum cadence | n/a (turn-driven) | "Minimum interval: 1 minute"; seconds round up to a minute |
| Stop early | `/goal clear` (aliases `stop`, `off`, `reset`, `none`, `cancel`); `/clear`; Ctrl+C in `-p` | `Esc` (self-paced only), or `CronDelete` / "cancel the deploy check job" |
| Survives resume | Yes — condition carried over; "resets the turn count, timer, and token-spend baseline" | Yes if unexpired — "a recurring task created within the last 7 days, or a one-shot whose scheduled time hasn't passed yet" |
| Persists to disk | Not documented as writing a file. `/loop`'s counterpart does: `.claude/loop.md` | `.claude/loop.md` / `~/.claude/loop.md` customises the default bare-`/loop` prompt |
| Failure handling | Four failure classes clear the goal (§6); others leave it active | 7-day expiry; no catch-up for missed fires |
| Availability gate | Workspace trust; disabled by `disableAllHooks` / `allowManagedHooksOnly` | Disabled by `CLAUDE_CODE_DISABLE_CRON=1` |

### The three differences that matter most

1. **Clock vs. turn.** `/loop`'s next iteration is started by elapsed time; `/goal`'s is started by the previous turn ending. `/goal` never idles between units of work.
2. **Who judges "done".** `/goal` hands the completion decision to a *separate* model that did not do the work: "completion is decided by a fresh model rather than the one doing the work" (<https://code.claude.com/docs/en/goal>). In self-paced `/loop`, the same Claude that did the work decides to stop.
3. **Continuous conversation vs. re-fired prompt.** `/goal` keeps one conversation running and feeds the evaluator's reason forward as guidance for the next turn. `/loop` re-runs a prompt as a fresh scheduled fire between turns.

### Relationship to Auto mode (documented, and often confused with `/goal`)

> "Auto mode on its own approves tool calls within a single turn but doesn't start a new one. Claude stops when it judges the work done. `/goal` adds a separate evaluator that checks your condition after every turn, so completion is decided by a fresh model rather than the one doing the work. The two are complementary: auto mode removes per-tool prompts, and `/goal` removes per-turn prompts."
> — <https://code.claude.com/docs/en/goal>

---

## 3. Syntax reference

Official signature, from the commands reference (<https://code.claude.com/docs/en/commands>):

```text
/goal [condition|clear]
```

Detail below from <https://code.claude.com/docs/en/goal> unless noted.

| Invocation | Effect |
| :-- | :-- |
| `/goal <condition>` | Sets the completion condition. "If a goal is already active, the new one replaces it." Starts a turn immediately. |
| `/goal` (no arguments) | Shows status. **Does not** set an empty goal. |
| `/goal clear` | Removes an active goal before it resolves. |
| `/goal stop` / `off` / `reset` / `none` / `cancel` | Aliases for `clear`. |
| `/clear` | Starting a new conversation "also removes any active goal." |
| `claude -p "/goal <condition>"` | Non-interactive; "runs the loop to completion in a single invocation." |

### Setting a goal

```text
/goal all tests in test/auth pass and the lint step is clean
```

> "Setting a goal starts a turn immediately, with the condition itself as the directive. You don't need to send a separate prompt. While the goal is active, a `◎ /goal active` indicator shows how long the goal has been running."

**Argument type:** a free-text condition passed inline. **Length limit: "The condition can be up to 4,000 characters."**

There is **no documented interval flag, iteration-count flag, or file-input form** (no `/goal --file`, no `/goal.md`). Bounding is done *inside the condition text*:

> "To bound how long a goal runs, include a turn or time clause in the condition, such as `or stop after 20 turns`. Claude reports progress against that clause each turn and the evaluator judges it from the conversation."

### Status (no arguments)

```text
/goal
```

> "If a goal is active, the status shows:
> * The condition
> * How long it has been running
> * How many turns have been evaluated
> * The current token spend
> * The evaluator's most recent reason
>
> The turn count and the most recent reason appear after the first evaluation has run.
>
> If no goal is active but one was achieved earlier in the session, the status shows the achieved condition along with its duration, turn count, and token spend."

### Clearing

```text
/goal clear
```

> "Claude prints `Goal cleared:` followed by the condition to confirm, or `No goal set` if nothing was active."

### Non-interactive

```bash
claude -p "/goal CHANGELOG.md has an entry for every PR merged this week"
```

> "With the default text output, nothing prints until the run ends, so a goal that runs many turns can look stuck. Add `--output-format stream-json --verbose` to emit each message as the loop runs."
> "Interrupt the process with Ctrl+C to stop a non-interactive goal before it resolves."

Also documented as working "in the desktop app, and through Remote Control."

---

## 4. How it decides it is finished

The completion condition comes from **the user's condition text**, judged by **a separate evaluator model**, after **every turn**.

> "Each time Claude finishes a turn, Claude Code sends the condition and the conversation so far to your configured small fast model, which defaults to Haiku on the Claude API; on a third-party provider, check your provider page for the platform's default. The model returns one of three verdicts, each with a short reason:
> * **Not yet met**: Claude keeps working and takes the reason as guidance for the next turn.
> * **Met**: Claude Code clears the goal and records an achieved entry in the transcript.
> * **Impossible**: the evaluator judged that the condition can never be satisfied. Claude Code clears the goal and records a failed entry in the transcript along with the reason. You don't need to clear it yourself."
> — <https://code.claude.com/docs/en/goal>

**Critical constraint on the evaluator — it is transcript-only:**

> "The evaluator judges your condition against what Claude has surfaced in the conversation. It doesn't run commands or read files independently, so write the condition as something Claude's own output can demonstrate."
> — <https://code.claude.com/docs/en/goal>

> "It does not call tools, so it can only judge what Claude has already surfaced in the conversation."
> — <https://code.claude.com/docs/en/goal>

**Bounds.**
- **Maximum turns:** none built in. The only documented bound is the one you write into the condition (`or stop after 20 turns`).
- **Time bound:** none built in.
- **Token bound:** none built in; spend is *reported* in `/goal` status but not capped.
- **Anti-spin circuit-breaker (documented):**

> "If Claude keeps answering the evaluator without making progress (no tool use for several turns in a row), Claude Code stops the loop, prints a warning, and returns control to you with the goal still set. Evaluation resumes after your next prompt."
> — <https://code.claude.com/docs/en/goal>

The mechanism is cross-referenced to the hooks guide's "Stop hook hits the block cap" section: <https://code.claude.com/docs/en/hooks-guide#stop-hook-hits-the-block-cap>

**Stopping early:** `/goal clear` (and aliases), `/clear`, or Ctrl+C for a `-p` run.

**Evaluation cost / model:**

> "To evaluate on a different model, set `ANTHROPIC_DEFAULT_HAIKU_MODEL`."
> — <https://code.claude.com/docs/en/goal>

> **Warning:** "Claude Code reads `ANTHROPIC_DEFAULT_HAIKU_MODEL` everywhere it uses the small fast model, not only for `/goal` evaluation. When you set it, Claude Code also resolves the `haiku` alias to that model and runs background functionality, such as conversation summarization, on it."
> — <https://code.claude.com/docs/en/goal>

> **Note:** "Evaluation tokens are billed on the small fast model configured for your provider and are typically negligible compared to main-turn spend."
> — <https://code.claude.com/docs/en/goal>

---

## 5. What happens between turns

**The conversation continues.** There is no re-prompt; the evaluator's reason is injected as guidance:

> "Not yet met: Claude keeps working and takes the reason as guidance for the next turn."
> — <https://code.claude.com/docs/en/goal>

**Transcript is preserved and is the substrate for evaluation** — the evaluator is sent "the condition and the conversation so far", and verdicts land in the transcript:

> "While the goal is active, the transcript shows each verdict the evaluator returns, and you can press Ctrl+O to see the reason behind it. The status view also shows the most recent reason, so you can see what Claude is working toward next."
> — <https://code.claude.com/docs/en/goal>

Achieved / failed goals are recorded there too: "records an achieved entry in the transcript" / "records a failed entry in the transcript along with the reason."

**Compaction.** Auto-compaction runs as normal; it is only mentioned as a *failure* case when it cannot recover:

> "A context overflow that auto-compaction couldn't clear" — one of the four conditions that clears the goal.
> — <https://code.claude.com/docs/en/goal>, linking <https://code.claude.com/docs/en/model-config#set-the-auto-compact-window>

So: auto-compaction is in play during a goal run, and only an *unrecoverable* overflow ends the goal. The docs do not say the goal condition is re-injected after a compaction (see gaps).

**State across sessions:**

> "When you resume a session, Claude Code restores a goal that was still active when the session ended. Claude Code restores it on every resume route: `--continue`, `--resume` with a session ID, name, or transcript file path, and the session picker. Before v2.1.239, Claude Code restored the goal on every route except the `claude --resume` picker."
> "Claude Code carries the condition over but resets the turn count, timer, and token-spend baseline. It doesn't restore a goal that was already achieved or cleared."
> — <https://code.claude.com/docs/en/goal>

**Written to disk?** The docs say the goal is restored on resume, which implies session-state persistence, but they never name a file or location. No `goal.md` equivalent of `loop.md` is documented. See gaps.

---

## 6. Permissions and safety

**Permission mode is untouched by `/goal`:**

> "A goal doesn't change your permission mode. To let goal turns run unattended, run `/goal` in auto mode. In Manual mode, Claude still asks before tool calls that your settings don't already allow, such as the test command above."
> — <https://code.claude.com/docs/en/goal>

That is the documented answer to "what happens when a tool call needs approval and the user is not present": **it blocks on the prompt.** The prescribed remedy is auto mode (<https://code.claude.com/docs/en/auto-mode-config>), stated again in "See also": "Auto mode: approve tool calls automatically so each goal turn runs unattended."

**Availability gates (the hooks-trust rule):**

> "Claude Code makes `/goal` available under the same workspace trust rule as hooks in settings files, because the evaluator is part of the hooks system. `/goal` is also unavailable when `disableAllHooks` is `true` after settings precedence applies, or when `allowManagedHooksOnly` is set in managed settings. In each case, the command tells you why instead of silently doing nothing."
> — <https://code.claude.com/docs/en/goal>

Referenced: <https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder>, <https://code.claude.com/docs/en/hooks#disable-or-remove-hooks>, <https://code.claude.com/docs/en/settings-reference#allowmanagedhooksonly>

**Errors that clear the goal (a safety valve):**

> "If a turn fails on an error that won't clear until you fix it, Claude Code clears the goal and prints a warning naming the cause. The warning starts with `Goal cleared after an unrecoverable error` and ends with `Run /goal again to continue`. Fix the cause, then set the goal again with `/goal <condition>`. Four kinds of failure clear the goal:
> * An authentication failure, when Claude Code manages its own credentials. When a host manages them for you, such as the desktop app, the VS Code extension, or a cloud session, Claude Code leaves the goal active because the host restores access on its own.
> * An exhausted credit balance
> * A context overflow that auto-compaction couldn't clear
> * A model that isn't available
>
> After any other failure, including transient errors such as rate limits and overloaded servers, Claude Code leaves the goal active."
> — <https://code.claude.com/docs/en/goal>

**Destructive-action guidance during an unattended goal run:** the `/goal` page publishes **none**. (`/loop` has such guidance for its built-in maintenance prompt — "irreversible actions such as pushing or deleting only proceed when they continue something the transcript already authorized", <https://code.claude.com/docs/en/scheduled-tasks> — but that governs `/loop`'s bundled prompt, not `/goal`.) See gaps.

---

## 7. Official guidance on writing a good goal statement

This is published in full under "Write an effective condition". Quoted verbatim:

> "The evaluator judges your condition against what Claude has surfaced in the conversation. It doesn't run commands or read files independently, so write the condition as something Claude's own output can demonstrate. 'All tests in `test/auth` pass' works because Claude runs the tests and the result lands in the transcript for the evaluator to read.
>
> A condition that holds up across many turns usually has:
>
> * **One measurable end state**: a test result, a build exit code, a file count, an empty queue
> * **A stated check**: how Claude should prove it, such as '`npm test` exits 0' or '`git status` is clean'
> * **Constraints that matter**: anything that must not change on the way there, such as 'no other test file is modified'
>
> The condition can be up to 4,000 characters."
>
> "To bound how long a goal runs, include a turn or time clause in the condition, such as `or stop after 20 turns`. Claude reports progress against that clause each turn and the evaluator judges it from the conversation."
> — <https://code.claude.com/docs/en/goal>

Distilled into a template consistent with the above (this arrangement is mine; every element is documented):

```text
/goal <measurable end state>, proven by <exact command and expected result>,
without <constraint that must not change>, or stop after <N> turns
```

Worked examples that appear in the official page:

```text
/goal all tests in test/auth pass and the lint step is clean
```
```bash
claude -p "/goal CHANGELOG.md has an entry for every PR merged this week"
```

---

## 8. Interaction with sub-agents, background tasks, hooks and skills

### Sub-agents and background shells — documented in detail

> "If a subagent or a background shell command is still running when a turn ends, Claude Code skips the evaluation for that turn. It evaluates at the end of the next turn that finishes with no background work running. When the background work finishes, Claude Code delivers the result to Claude as a new turn, so you don't have to prompt."
> — <https://code.claude.com/docs/en/goal>

**Check-in schedule while background work blocks evaluation:**

> "Once background work has kept the goal waiting for 30 minutes, a check-in is due. In the check-in, Claude Code lists the running tasks and asks Claude to read their output, keep waiting if they're progressing, and fix or stop any that are stuck. After the first check-in, Claude Code waits twice as long before each later check-in, up to four times the first interval: with the default, 1 hour after the first check-in, then every 2 hours."
> — <https://code.claude.com/docs/en/goal>

Two delivery routes:

> "* **When a turn ends**: Claude Code delivers the check-in at the end of the next turn that finishes with the work still running. In a non-interactive session, such as one started with `-p`, this is the only way Claude Code delivers check-ins.
> * **While the session is idle**: in an interactive session, Claude Code also starts a turn on its own to deliver the check-in instead of waiting for your next prompt. If the background work has stopped without reporting a result, Claude Code asks Claude to continue toward the goal. Claude Code starts at most three idle check-ins per goal between your prompts. In the third idle check-in, Claude Code says that idle check-ins are paused until you send another prompt. Before v2.1.246, idle check-ins were uncapped. Idle check-ins require Claude Code v2.1.236 or later."
> — <https://code.claude.com/docs/en/goal>

**Tuning knob:**

> "To change the first interval, set `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`. Claude Code uses your value in place of the 30-minute interval and scales the later intervals with it. Set it to `0` to turn check-ins off. Check-ins require Claude Code v2.1.234 or later."
> — <https://code.claude.com/docs/en/goal>

The environment-variable reference gives the default explicitly:

> | `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` | How often in minutes Claude Code checks in on your goals (default: `30`). Set to `0` to turn goal check-ins off. |
>
> — <https://code.claude.com/docs/en/env-vars>

This is the only environment variable with `GOAL` in its name. (Minor doc defect worth knowing: the env-vars row links onward to `/docs/en/goal-tracking`, which returns HTTP 404 — the live page is `/docs/en/goal`.)

### Hooks — documented

`/goal` **is** a hook: "a wrapper around a session-scoped prompt-based Stop hook." Consequences documented on the page:
- It shares the workspace-trust gate with settings-file hooks.
- `disableAllHooks: true` or `allowManagedHooksOnly` makes `/goal` unavailable.
- Its no-progress circuit-breaker is the Stop hook block cap (<https://code.claude.com/docs/en/hooks-guide#stop-hook-hits-the-block-cap>).
- The page recommends writing your own Stop hook "when you need custom evaluation logic", or for deterministic script-based checks and cross-session scope.

### Skills — NOT documented for `/goal`

The `/goal` page says nothing about skill invocation during a goal run. The comparable restriction *is* documented for `/loop` (a scheduled fire only runs skills Claude may invoke on its own; built-in commands and `disable-model-invocation: true` skills arrive as plain text — <https://code.claude.com/docs/en/scheduled-tasks>). Whether the same applies to goal-driven turns is **not stated**. See gaps.

---

## 9. Known limitations, warnings and "not good for" statements (official)

From <https://code.claude.com/docs/en/goal>:

1. **The evaluator is blind outside the transcript.** "It doesn't run commands or read files independently" / "It does not call tools." A condition Claude never demonstrates in output cannot be judged met.
2. **One goal per session.** No parallel goals.
3. **A goal does not grant permissions.** In Manual mode an unattended run stalls on the first unapproved tool call.
4. **`-p` runs look stuck.** "With the default text output, nothing prints until the run ends, so a goal that runs many turns can look stuck."
5. **No-progress stall.** Answering the evaluator without tool use for several turns halts the loop with a warning; the goal stays set and resumes on your next prompt.
6. **Four unrecoverable errors kill the goal** (auth, credit exhaustion, unrecoverable context overflow, unavailable model) and require a manual `/goal <condition>` re-set.
7. **Resume loses the counters.** "Claude Code carries the condition over but resets the turn count, timer, and token-spend baseline."
8. **Availability can be revoked by policy** — untrusted workspace, `disableAllHooks`, `allowManagedHooksOnly`.
9. **The `ANTHROPIC_DEFAULT_HAIKU_MODEL` warning** — changing the evaluator model changes the small fast model everywhere, including the `haiku` alias and background summarization.
10. **Condition length cap** — 4,000 characters.
11. **Scope statement (implicit "not good for"):** "Use a goal for **substantial work with a verifiable end state**." Every documented example is a converging task with a checkable terminal condition; there is no documented support for open-ended monitoring, which is what `/loop` is pointed at ("Use `/loop` for quick polling during a session" — <https://code.claude.com/docs/en/scheduled-tasks>).

There is no "Limitations" heading on the `/goal` page (unlike `/loop`, which has one).

---

## 10. What I could NOT confirm from official sources

Rigorous separation — each item below is a question from the brief that the official documentation does **not** answer. None of these should be reported as fact.

Three questions from the brief that this section previously listed have since been **resolved** and moved into the body: the introduction version (v2.1.139, §1), the command's formal classification (built-in command, §1), and the `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` default (30, §8). What remains genuinely unanswered:

| # | Question | Status |
| :-- | :-- | :-- |
| 1 | **Calendar release date of v2.1.139.** | **Not established.** The version is confirmed, but `anthropics/claude-code`'s CHANGELOG.md carries version headings with no dates, and the docs page carries none either. Report the version, not a date. |
| 2 | **Whether the docs page itself ever states an introduction version.** | **It does not.** The version was recovered only from the changelog. Anyone reading `/docs/en/goal` alone cannot tell when `/goal` shipped. |
| 3 | **Where goal state is written to disk.** | **Not documented.** Restoration on resume is documented; no file path, no `goal.md`, no settings key is named. Do not claim a location. |
| 4 | **Whether the goal condition is re-injected after auto-compaction.** | **Not documented.** Auto-compaction is mentioned only as the failure case ("a context overflow that auto-compaction couldn't clear"). Whether the condition survives a successful compaction inside the working context is not stated. Given the evaluator is sent "the conversation so far", a compaction plausibly changes what it can see — but the docs do not address this. |
| 5 | **Any built-in maximum turn count, wall-clock limit, or token budget.** | **None documented.** The only bound is the one you write into the condition. Absence of documentation is not proof of absence of an internal cap. |
| 6 | **Guidance about destructive or irreversible actions during an unattended goal run.** | **Not published for `/goal`.** The page's only safety lever is "a goal doesn't change your permission mode." The irreversible-action guidance that exists ("pushing or deleting only proceed when they continue something the transcript already authorized") belongs to `/loop`'s built-in maintenance prompt and must not be attributed to `/goal`. |
| 7 | **Whether skills can be invoked during goal-driven turns, and whether `disable-model-invocation` restrictions apply.** | **Not documented for `/goal`.** The parallel rules are documented only for `/loop` scheduled fires. |
| 8 | **Whether other hooks (PreToolUse, PostToolUse, SessionStart) behave differently during a goal run,** or whether `/goal`'s Stop hook composes with a user's own Stop hook. | **Not documented.** The page recommends a Stop hook as an *alternative* but does not say what happens when both exist. |
| 9 | **Whether `/goal` accepts a file path or any flags.** | **No flags or file input are documented.** Only inline free text plus the `clear` aliases. Reporting "there are no flags" is an inference from a complete-looking syntax section, not an explicit statement. |
| 10 | **The exact evaluator prompt / verdict schema.** | **Not published.** Only the three verdict names and "a short reason". |
| 11 | **Behaviour with an empty or nonsense condition** beyond the no-argument case (which shows status). | **Not documented.** |
| 12 | **Interaction with `/rewind`, checkpointing, or `Esc` interruption mid-goal-turn.** | **Not documented.** Only `/goal clear`, `/clear`, and Ctrl+C (in `-p`) are given as stop routes; `Esc` is documented as a stop route for `/loop`, not for `/goal`. |
| 13 | **Anthropic engineering-blog or prompting-guide material specifically about `/goal`.** | **None found.** All substantive material came from the docs page. No official blog post about `/goal` surfaced. |

### Unofficial material — noted, NOT used

The web search surfaced third-party GitHub repositories offering their own `/goal` implementations for Claude Code, e.g. `jthack/claude-goal`, `chrischabot/claude-code-goal`, `balakumardev/claude-code-goal` (each self-describes as a "Codex-style `/goal` command for Claude Code" or "persistent markdown-backed goal mode"). **These are unofficial, are not Anthropic projects, and describe different mechanics from the documented built-in** — notably markdown-file-backed persistence, which the official `/goal` does not document. Nothing from them is used above. Also surfaced: issues on `anthropics/claude-code` (#56085 requesting a `/goal` command for parity with Codex CLI, #58348 a bug report about a `/goal` stop-hook loop). Issue trackers on an official repo are user-submitted content, not Anthropic documentation, so they are not cited as fact here; #56085's existence is at most weak evidence about timing and is not used to date the feature.

---

## Source list

Fetched and quoted directly:

- <https://code.claude.com/docs/en/goal> — primary; the entire `/goal` reference
- <https://code.claude.com/docs/en/scheduled-tasks> — `/loop`, scheduling comparison, cron reference, `/loop` limitations
- <https://code.claude.com/docs/en/commands> — commands reference; the `/goal [condition|clear]` row and the built-in-command vs bundled-skill classification
- <https://code.claude.com/docs/en/slash-commands> — commands overview
- <https://code.claude.com/docs/en/env-vars> — `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` default
- <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (retrieved raw from `raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`, 6,475 lines) — introduction version v2.1.139 and the full `/goal` change history
- <https://code.claude.com/docs/en/goal-tracking> — checked; returns HTTP 404 (stale link from the env-vars page)

Referenced from the goal page (not independently fetched): `/docs/en/hooks#prompt-based-hooks`, `/docs/en/hooks-guide#stop-hook-hits-the-block-cap`, `/docs/en/auto-mode-config`, `/docs/en/permission-modes`, `/docs/en/model-config`, `/docs/en/env-vars`, `/docs/en/settings-reference#allowmanagedhooksonly`, `/docs/en/headless`, `/docs/en/sessions`, `/docs/en/remote-control`
