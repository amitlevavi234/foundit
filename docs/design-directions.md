# Foundit — Four Visual Directions

Desktop web, 1440px. Brief: "describe a problem in plain language, get matched tools." The first draft was rejected as generic — calm paper, teal, serif headline. Every direction below is built to avoid that failure mode: each has one loud, non-negotiable idea, and motion is specified rather than implied.

## How this was researched

I fetched and read: linear.app, raycast.com, family.co, cosmos.so, granola.ai, mercury.com, clay.com, superlist.com, posthog.com, warp.dev, vercel.com, framer.com, arc.net, are.na, brand.squarespace.com (Resn, Awwwards SOTD 01 Sep 2026), usavionix.com (basement studio, Awwwards SOTD 09 Sep 2026), plus the Awwwards Site of the Day index and lapa.ninja. Fetches return rendered markdown, so type, copy, colour and structure are directly observed; motion is observed where the page describes or names it (Squarespace Foundations lists "Motion" as one of six pillars; Family's page carries user quotes about scrubbing the price chart and its micro-animations) and otherwise reconstructed from the visible pattern. All Google Fonts named below were verified by requesting them from `fonts.googleapis.com/css2` and confirming valid `@font-face` output; the Hebrew faces were additionally requested through the v1 API with `subset=hebrew`.

---

## Direction 1 — SIGNAL

**Mood.** A precision instrument, not a website. Near-black, high-contrast, dense with small monospaced metadata — coordinates, counts, confidence values — the way a control surface is dense. Foundit is doing retrieval and scoring, and this direction makes the machinery visible instead of hiding it behind reassurance. It feels fast and slightly clinical: you type a messy sentence, and something exacting comes back. For the operator-type user — the person who already knows three tools and wants the fourth, who trusts a number more than a testimonial.

**References.**

- **warp.dev** — observed: monospace as the primary voice, not an accent. Section headers are literally keyed shortcuts (`[S] SDLC`, `[Q] Quality loop`), and figure captions read `>_ [ fig. X ]`. Config files (`factory.yaml`) are used as decorative page furniture. Borrow: the keyed-label system for the constraint chips (`[F] Free`, `[HE] Hebrew`), and mono figure-stamps on every result card.
- **usavionix.com** (basement studio, Awwwards SOTD 09 Sep 2026) — observed: a boot-sequence hero that types out sensor status (`THERMAL / LIDAR / RGB / IR [ONLINE]`), all-caps mono, coordinate stamps, `ALERT` / `LOCKED` status words as visual texture on a black ground. Borrow: the boot sequence, rewritten as the search running — `PARSING INTENT ▸ 412 TOOLS SCANNED ▸ 6 MATCHED`.
- **linear.app** — observed: dark base, split hero (headline stack left, product UI right), and feature content in a bento grid; status pills in teal/blue as the only saturated colour. Borrow: the restraint. Linear earns its dark theme by keeping colour almost entirely inside small UI chips.

**Typography.** Display **Space Grotesk** 500 / 700. Body **Public Sans** 400 / 500. Metadata **Chivo Mono** 400, uppercase, tracked +0.08em, 11–12px. Hebrew **Heebo** 400 / 700 — a Hebrew Grotesk whose skeleton sits comfortably next to Space Grotesk's squared terminals.

**Colour.**

| role | hex |
|---|---|
| background | `#08090A` |
| surface | `#101215` |
| surface raised | `#171A1F` |
| hairline | `#23272E` |
| text | `#E9ECF1` |
| text muted | `#8B93A1` |
| accent (lime) | `#C6F24E` |
| accent 2 (blue) | `#5B8DEF` |

Fit-score scale: `#6B7280` (0–39) → `#5B8DEF` (40–69) → `#8FE33F` (70–89) → `#C6F24E` (90–100). The lime appears on exactly three things per screen: the submit affordance, the highest fit ring, and the active chip's underline. Everything else is grey. If lime is on a fourth element, delete it.

**Layout.** Hero is a single centred column at 720px on a black field, with the input rendered as a terminal line: a `▸` prompt glyph, a 1px lime caret, and above it one mono line reading `FOUNDIT // TOOL RETRIEVAL v1`. The headline sits *below* the input, not above — 56px Space Grotesk, left-aligned to the input's left edge, breaking the expected order. Example prompts cycle inside the placeholder. Behind everything, a 1px `#23272E` grid at 48px, fading out radially.

Results: a two-column split — a sticky 280px left rail holding the parsed constraints (each chip a keyed mono label, removable) and the result count; the right column is a stack of full-width rows, not cards. Each row is a hairline-separated band: fit ring at 64px on the left, tool name in Space Grotesk 24px, one-line "why this matches" in Public Sans 15px, mono metadata strip along the bottom (`FREE · HEB · WEB+IOS · ★4.6 · 218 SAVES`). Rows are numbered `01`–`06` in mono at the far left margin.

**Motion.**

1. **Boot line on load** — the mono status line types at 28ms/char, then the caret blinks at 1.06s. Straight from usavionix.
2. **Input focus** — border `#23272E` → `#C6F24E` at 20% opacity over 180ms `cubic-bezier(0.22,1,0.36,1)`, plus an outer `box-shadow: 0 0 0 6px rgba(198,242,78,0.06)` scaling in over 260ms.
3. **Submit press** — button `scale(0.97)` in 90ms `ease-out`, releases to `scale(1)` in 260ms `cubic-bezier(0.34,1.56,0.64,1)`. On release the lime fill wipes left-to-right in 320ms.
4. **Search transition** — hero column translates up 40px and fades to 0 over 340ms `cubic-bezier(0.16,1,0.3,1)`; the mono progress line replaces it and counts real numbers up.
5. **Row reveal** — rows enter `opacity 0→1, translateY 12px→0` over 420ms `cubic-bezier(0.16,1,0.3,1)`, staggered 55ms. Hairlines draw in via `scaleX(0)→1`, transform-origin left, 300ms, 20ms after the row.
6. **Fit ring** — `stroke-dashoffset` animates from full to target over 900ms `cubic-bezier(0.65,0,0.35,1)`, starting 200ms after its row; the numeral inside counts up on the same curve.

**Fit score.** (a) Mono numeral at 32px with a 1px arc drawn around it. (b) A 10-segment horizontal bar, segments lighting sequentially left to right. (c) Constraint dots — one filled dot per satisfied requirement, hollow for unmet, with a tooltip naming each. **Recommended: (a) the arc + mono numeral**, with (c) as a secondary strip beneath, because it answers both "how well" and "which of my constraints failed."

**Risks.** Terminal aesthetics are now a genre; done lazily this reads as "developer tool template," and Foundit's audience is not only developers. Two guards: the copy must stay in warm plain English inside the mono frame ("Free, works in Hebrew, no account needed" — not `AUTH:NULL`), and the type ramp must go genuinely large (56px+) somewhere so the page is not uniformly small and grey. Avoid green-on-black CRT scanlines entirely.

---

## Direction 2 — BROADSHEET

**Mood.** A loud printed catalogue. Enormous display serif, hairline rules, a ticker, an oxblood ink accent, numbered entries. This is deliberately *not* the rejected draft: that was calm paper and teal with a polite serif; this is ink-black on bone with 120px type, hard rules, and no soft shadows anywhere. It fits the product because a recommendation is fundamentally an editorial act — someone curated this list and is willing to sign their name to it. For the user who wants judgement, not an algorithm.

**References.**

- **are.na** — observed: "Are.na is" followed by two spare value propositions; numbered lists as the structural device; custom typeface (Areal by Dinamo); generous whitespace; explicit anti-algorithm positioning ("no ads, no personalized recommendations"). Borrow: numbered entries and the confidence to let a bare sentence carry a hero.
- **cosmos.so** — observed: light ground, imagery dominant, and a single deep rust accent `#bc361b` used to mark interactive elements; masonry grid; copy "Search the way you think." Borrow: the exact discipline of one saturated warm accent against near-white, and that headline's posture.
- **brand.squarespace.com** (Resn, Awwwards SOTD 01 Sep 2026) — observed: six numbered foundational sections (Logo, Typography, Color, Photography, Campaign, Motion) advanced by directional controls (`←←←` / `→→→`), a load percentage counter, "Tap to Explore." Borrow: numbered progressive disclosure and arrow-glyph navigation as decoration.

**Typography.** Display **Instrument Serif** 400 (and its italic — use the italic for the example prompts, it is the single most characterful move available on Google Fonts). Body **Instrument Sans** 400 / 500 / 600. Hebrew display **Frank Ruhl Libre** 400 / 700; Hebrew body **Assistant** 400 / 600.

**Colour.**

| role | hex |
|---|---|
| background (bone) | `#F2EFE7` |
| surface | `#FBFAF6` |
| ink | `#14130F` |
| ink muted | `#5C594F` |
| rule | `#D8D3C6` |
| accent (vermilion) | `#D2401E` |
| accent 2 (link blue) | `#1B3A8F` |

Fit-score scale: bars in ink `#14130F` at varying widths; only scores ≥ 85 switch to vermilion. Vermilion appears at most twice per viewport — the caret and the top match. The blue is reserved for outbound links to the tool itself, so blue always means "leave the page."

**Layout.** Hero: the headline is set in Instrument Serif at 120px/0.92, ranged left, occupying the top third and allowed to break awkwardly across two lines. Directly beneath it, a full-bleed hairline rule, then the input — which has no box at all: it is a 40px Instrument Serif italic text field sitting on a 2px ink baseline, with a vermilion block caret. Under it, three example prompts as underlined italic links, each preceded by a numeral (`01 —`). A slow marquee ticker runs along the very top edge of the viewport: real tool names from the database, 8px letterspaced caps, moving at ~30s per loop.

Results: a masthead band showing the query set back in serif italic with the constraints as inline chips. Below, results as *catalogue entries*, not cards — a 12-column grid where each entry spans full width and is divided by hairlines: column 1 (2 cols) the numeral and fit bar, columns 2–7 the name in 34px serif and the "why this matches" paragraph, columns 8–12 the metadata table (Price / Platforms / Hebrew / Rating) set as an actual definition list with dotted leaders. No rounded corners anywhere. No shadows anywhere.

**Motion.**

1. **Marquee** — continuous `translateX` at 30s linear, paused on hover of the strip (transition 400ms).
2. **Serif headline reveal** — per-word mask, each word rising 100%→0 inside `overflow:hidden`, 620ms `cubic-bezier(0.16,1,0.3,1)`, staggered 70ms.
3. **Example prompt swap** — the italic placeholder does a character-scramble over 480ms (random glyphs settling left to right at ~24ms/char), then holds 4s. This is the memorable moment; it also teaches the input's grammar.
4. **Input baseline** — on focus the 2px ink rule animates to 3px vermilion via `scaleY`, 160ms `ease-out`, and the block caret blinks at 530ms.
5. **Entry reveal** — hairline rules draw left-to-right 380ms `cubic-bezier(0.22,1,0.36,1)` and the row's text fades up 10px behind them, staggered 80ms — the sense of a page being set.
6. **Row hover** — the whole band shifts `translateX(6px)` in 220ms `cubic-bezier(0.22,1,0.36,1)` and a vermilion `→` fades in at the right edge. Borrowed directly from Squarespace Foundations' arrow-glyph navigation.

**Fit score.** (a) A ranged-left ink bar with the numeral set inline in serif at 28px. (b) A five-notch letterpress-style scale (▮▮▮▯▯) in mono. (c) Big numeral alone at 64px serif with a lowercase label beneath ("strong match" / "partial match"). **Recommended: (c) the big serif numeral with a written label**, because in an editorial frame a number wants a caption, and the label does the work the "why this matches" line cannot do at a glance.

**Risks.** This is the direction closest to the rejected draft and can collapse back into it the moment anyone softens the palette or shrinks the type. Hard rules: display type never below 96px in the hero, no teal, no drop shadows, no rounded corners over 2px, and the ticker stays. If the founder's objection was "calm," the antidote is scale and rules, not a different serif.

---

## Direction 3 — TOYBOX

**Mood.** Chunky, warm, tactile, slightly wonky — software that feels like an object you can press. Saturated coral and violet on cream, thick borders, offset shadows, springy motion, sound optional. It fits because the emotional core of Foundit is relief: someone had a nagging problem and now they have an answer. Relief deserves delight. This is the direction for the broadest audience — the traveller splitting expenses in Hebrew, not the operator.

**References.**

- **family.co** — observed: a minimalist palette punctuated by emoji accents; four-pillar messaging ("Easy," "Secure," "Fast," "Powerful," then "Fun"); modular card sections with phone mockups. Animation is stated as a design priority, with user quotes about spending five minutes scrubbing the price chart to watch numbers animate, and micro-animations "on the whole another level." Borrow: number animation as an attraction in itself, and the willingness to add a fifth pillar called Fun.
- **clay.com** — observed: white ground with vibrant pink/red/blue/orange/green, and custom 3D illustrations — a "colorful playful contraption with tubes, balls, magnets, and funnel on green hills," retro mechanical robots, puzzle cubes, levers. Borrow: the contraption metaphor. Foundit is a machine that takes a sentence in one end and drops tools out the other; illustrate it literally.
- **superlist.com** — observed: "Tasks, notes, and plans. Finally in one app.", personality copy like "Everyday superpowers," and testimonials citing "little details like sounds." Borrow: the sound layer (a soft click on chip toggle, a rising three-note figure on results landing) and the plain-spoken benefit headline.

**Typography.** Display **Bricolage Grotesque** 700 / 800 — variable, with `wdth` and `opsz` axes, so the hero can run wide and the labels narrow from one family. Body **Onest** 400 / 500. Hebrew display **Secular One** 400; Hebrew body **Rubik** 400 / 600.

**Colour.**

| role | hex |
|---|---|
| background (cream) | `#FFFCF5` |
| surface | `#FFFFFF` |
| surface tinted | `#F1ECFF` |
| border (ink) | `#1C1A24` |
| text | `#1C1A24` |
| text muted | `#6B6780` |
| accent (coral) | `#FF5A3C` |
| accent 2 (violet) | `#6E4BF6` |
| tertiary (lime) | `#B8F04A` |

Fit-score scale: a continuous ramp `#6E4BF6` → `#FF5A3C` → `#B8F04A`. Coral is the action colour and appears only on the submit button and the active chip; violet is structural (borders of the fit meter, the illustration); lime is a reward colour reserved for scores above 90 and nothing else.

**Layout.** Hero: an asymmetric split — 58% left holds the headline in Bricolage 76px with one word wrapped in a coral highlighter sweep, and the input as a 96px-tall white slab with a 2px ink border and a 6px offset violet shadow (`box-shadow: 6px 6px 0 #6E4BF6`). 42% right holds the contraption illustration, which reacts to the cursor. Below the input, example prompts as pressable pill chips, each with its own offset shadow. Behind the hero, a soft violet radial at 8% opacity.

Results: a bento grid rather than a list — the top match spans 2×2 with the illustration and full "why this matches"; the rest are 1×1 cards. Every card has the 2px ink border and offset shadow, tilted between −1.5° and +1.5° at rest so the grid is never perfectly aligned. Constraint chips sit in a horizontal scrollable rail above the grid.

**Motion.**

1. **Card press/hover** — offset shadow travels 6px→2px while the card moves `translate(4px,4px)` and untilts to 0°, 180ms `cubic-bezier(0.34,1.56,0.64,1)`. Physical, like a key going down.
2. **Submit button** — magnetic: the button translates up to 8px toward the cursor within a 60px radius, lerped at 0.15 per frame; on release it springs back with `stiffness 420, damping 26`.
3. **Chip toggle** — fill scales from the click point via `clip-path: circle()` 0%→140% in 260ms `cubic-bezier(0.22,1,0.36,1)`, with a 40ms `scale(0.94)` dip first. Optional 12ms click sample (Superlist).
4. **Fit meter fill** — the gradient bar wipes 0→target width in 780ms `cubic-bezier(0.16,1,0.3,1)` with a 1.2s shimmer sweeping across it once on arrival.
5. **Number count-up** — every score counts from 0 with a slight overshoot (target +3, settling back) over 900ms — the Family price-chart trick, which their users explicitly called out.
6. **Staggered bento reveal** — cards scale `0.92→1` and fade in, 380ms `cubic-bezier(0.34,1.56,0.64,1)`, staggered 45ms in reading order, top match first and 120ms ahead of the rest.

**Fit score.** (a) A thick gradient meter across the card top with the numeral in a circular badge riding its end. (b) A stack of coloured constraint dots that fill one by one as the card enters. (c) A segmented "battery" of five chunky blocks with ink borders. **Recommended: (a) the gradient meter with the riding badge**, because the motion is the point in this direction and a travelling badge is the most watchable of the three.

**Risks.** Neo-brutalist offset shadows plus a bright palette is 2023's most copied look; it can read as a Gumroad clone. Differentiators: keep the cream ground rather than white, keep the ink border to exactly 2px (thicker reads as parody), use the illustration system as a genuine commission rather than stock 3D, and hold the tilt under 2° so it feels hand-placed rather than gimmicky. Also: the "why this matches" text must stay serious even when the container is playful.

---

## Direction 4 — SPECTRAL

**Mood.** Luminous and atmospheric — deep indigo-black, glass surfaces, a light source that follows the cursor, and one spectral gradient that only ever means "match quality." It suggests something intelligent looking at your sentence: the page literally lights up around where you are. It is the most obviously premium of the four and the easiest to make feel like an AI-native product without saying the word. For the user who is evaluating whether Foundit is credible in the first three seconds.

**References.**

- **raycast.com** — observed: dark theme with dark glass-effect visuals and subtle gradients (a blue glass backdrop), bento-grid feature sections, extension cards in a card grid, and vibrant CTA accents against the dark. Headline "Your shortcut to everything." Borrow: glass panels over gradient, and the bento density.
- **framer.com** — observed: multiple sections marked "Live" that run real interactive demos in place, a terminal-style panel with progressive status updates, and real-time status indicators — each feature paired with an executable demonstration rather than a static image. Borrow: make the hero input a live component that actually returns two sample results in place before signup.
- **vercel.com** — observed: monochrome black/white foundation, modular card system, hero with dual CTAs and "Recently shipped" cards. Borrow: the near-total absence of colour, which is what makes a single gradient read as meaningful rather than decorative.

**Typography.** Display **Unbounded** 400 / 600 — wide, geometric, unmistakable, and rarely used; set it tight (`letter-spacing: -0.02em`) at large sizes. Body **Hanken Grotesk** 400 / 500. Hebrew **Assistant** 400 / 700, which shares Unbounded's open counters at heading weights.

**Colour.**

| role | hex |
|---|---|
| background | `#0B0A12` |
| surface (glass) | `rgba(24,22,38,0.62)` over blur 24px |
| border | `rgba(255,255,255,0.08)` |
| text | `#F2F0FF` |
| text muted | `#9A96B8` |
| accent (violet) | `#6C5CE7` |
| accent 2 (aqua) | `#4EE0D0` |

Fit-score gradient: conic `#6C5CE7 → #4EE0D0` for the ring, with sub-60 scores desaturating to `#3A3856`. This gradient is the only place either accent appears at full saturation — buttons are white-on-glass, links are `#F2F0FF` with an underline. That restraint is what stops it becoming another purple AI landing page.

**Layout.** Hero: full-viewport, centred, with the input as a floating glass slab 780px wide and 88px tall, its border a 1px gradient stroke. Behind it, a slow-drifting aurora mesh at low opacity; over everything, a 320px radial highlight that follows the cursor and lifts the glass it passes over. The headline sits above at 64px Unbounded, and beneath the input a single line of muted text with three example prompts that swap. Nothing else on the first screen — no logo wall, no nav beyond a wordmark and one button.

Results: an asymmetric two-column layout. Left 62% is the result stack, cards as glass panels with the fit ring at top-right. Right 38% is a sticky panel that stays for the whole scroll, containing the parsed query restated in plain language, the active constraint chips, and a live count. The top match is promoted out of the stack into a wider panel that breaks the column boundary by 48px on the left — the single asymmetry that stops the layout reading as a generic two-column dashboard.

**Motion.**

1. **Cursor light** — a radial gradient div follows the pointer, lerped at 0.08 per frame so it lags noticeably; cards raise their border to `rgba(255,255,255,0.18)` when the light overlaps them, 240ms `ease-out`.
2. **Input focus** — the gradient border stroke animates its angle 0°→360° over 3.2s linear while focused, and the glass blur goes 24px→32px over 300ms `cubic-bezier(0.22,1,0.36,1)`.
3. **Submit** — the button's white fill inverts to a gradient sweep over 280ms; on press, `scale(0.98)` in 80ms then spring back `stiffness 380, damping 28`.
4. **Query → results transition** — the hero glass slab does not disappear; it flies to the top of the results view as the sticky panel's header, a shared-element transform over 520ms `cubic-bezier(0.16,1,0.3,1)`. This is the direction's signature move and the thing people will remember.
5. **Card reveal** — glass panels rise 16px and blur-in (`backdrop-filter` 0→24px, opacity 0→1) over 480ms `cubic-bezier(0.16,1,0.3,1)`, staggered 60ms.
6. **Fit ring draw** — conic-gradient ring revealed by an animated `mask` sweeping 0→360°, 1000ms `cubic-bezier(0.65,0,0.35,1)`, with the numeral cross-fading at 60% progress.

**Fit score.** (a) A conic gradient ring at 72px with the numeral centred. (b) A vertical luminous column on the card's left edge, filling to height. (c) A radial/spider chart across four axes (price, language, platform, popularity) that also explains *why*. **Recommended: (a) the conic ring**, with (c) available on hover as a small expansion — the ring gives the instant read, the radial answers the follow-up question without needing a second page.

**Risks.** Dark + purple gradient + glass is the single most saturated aesthetic in AI products right now, and Perplexity, Raycast and a hundred imitators already own it. Three guards: (1) Unbounded is the escape hatch — almost nobody uses it, and it makes the page unmistakable at a glance; (2) hold saturation to the fit ring only, so the page reads near-monochrome like Vercel; (3) the shared-element hero-to-header transition is a real interaction idea, not a decoration, and must be built properly or the direction has nothing left that the imitators don't have.

---

## Recommendation

Build **Toybox** first and **Signal** second. Toybox is the strongest answer to the actual objection — the rejected draft failed because it was calm, and Toybox is physically incapable of being calm; its offset shadows, springs and count-up numbers give the founder visible motion within a day of building, and its warmth suits the real user, who is a traveller looking for a Hebrew expense splitter rather than an engineer. Signal is the right second because it is maximally distant from Toybox in every axis (dark/light, mono/geometric, dense/spacious), so putting the two side by side gives a genuine decision rather than two shades of the same idea, and its keyed-chip and boot-sequence devices make Foundit's matching feel earned. Broadsheet is the highest-ceiling direction but the riskiest to show next, because at anything less than full commitment it will read as the rejected draft with a new serif. Spectral is the safest to ship and the fastest to look expensive, but it is where every competitor already is, so I would hold it as a fallback rather than lead with it.
