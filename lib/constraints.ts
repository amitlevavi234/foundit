import type {
  Platform,
  PricingModel,
  SearchConstraints,
  ToolFlag,
} from './types';

/* ===========================================================================
 * What the sentence plainly said.
 *
 * A deliberately small rules pass: word lists and a few phrases, no model, no
 * network call, no cleverness. It exists because the results screen draws a
 * row of "here's what I understood" chips and the empty state offers to loosen
 * one of them, and neither can be built out of nothing.
 *
 * **Phase 4 owns understanding the sentence and replaces this file.** That
 * phase adds the model pass, the non-English restatement and the inferred
 * constraints the design draws as dashed chips. Until then this reads only
 * what a person actually typed, which is why every chip it produces is drawn
 * as explicit: there is nothing here that guesses.
 *
 * The rule it must not break: a constraint read here becomes a WHERE clause,
 * never a hint. If someone says free, a paid tool does not appear, however
 * similar it looks (docs/product-decisions.md §6). So a rule that is unsure is
 * a rule that is left out — a missed constraint returns too much, a wrong one
 * returns the wrong thing, and only the first of those is recoverable by the
 * person typing another word.
 *
 * The other half of that rule is `readQuery`: a phrase read as a constraint is
 * *removed* from the text full-text search then ranks on. A constraint that is
 * both a WHERE clause and a search term is a hint again — retrieval is any-of,
 * so "free" would match every summary that happens to contain the word, and
 * "a free tool to split expenses … in Spanish" would rank a mail client above
 * anything that splits a bill. Filtering and ranking see different strings on
 * purpose: the typed arguments, and the sentence with those phrases taken out.
 * ======================================================================== */

export type ConstraintKind = 'pricing' | 'flag' | 'platform' | 'language';

export interface ReadConstraint {
  /** Stable, URL-safe, and what `?drop=` names to switch one off. */
  key: string;
  /** The chip's wording. */
  label: string;
  kind: ConstraintKind;
  pricing?: PricingModel[];
  flag?: ToolFlag;
  platforms?: Platform[];
  /** ISO code. The database lower-cases what it compares. */
  language?: string;
}

/** A word list is a rule; a regular expression per rule keeps them readable. */
interface Rule {
  test: RegExp;
  constraint: ReadConstraint;
}

/**
 * "Free" means a person can use it without paying, which includes a tool whose
 * paid tier exists — the artboards show exactly that, a "Free" chip met by a
 * freemium listing. `free_trial` is not in the list: a trial ends.
 */
const FREE_PRICING: PricingModel[] = ['free', 'open_source', 'donation', 'freemium'];

/**
 * The interface language somebody asked for.
 *
 * The name of a language on its own is not a constraint: "learn Spanish
 * vocabulary" is a subject, and reading it as "the interface must be in
 * Spanish" would filter out the flashcard app somebody actually wanted. So the
 * rule asks for the shape a requirement takes — "in Spanish", "Spanish
 * interface", "en español" — and lets the bare noun pass by.
 */
const LANGUAGE_NAMES: ReadonlyArray<readonly [code: string, name: string, names: string, native?: RegExp]> = [
  ['en', 'English', 'english'],
  ['es', 'Spanish', 'spanish|espa[nñ]ol|castellano', /\ben espa[nñ]ol\b/],
  ['fr', 'French', 'french|fran[cç]ais', /\ben fran[cç]ais\b/],
  ['de', 'German', 'german|deutsch', /\bauf deutsch\b/],
  ['pt', 'Portuguese', 'portuguese|portugu[eê]s', /\bem portugu[eê]s\b/],
  ['it', 'Italian', 'italian|italiano', /\bin italiano\b/],
  ['nl', 'Dutch', 'dutch|nederlands'],
  ['pl', 'Polish', 'polish|polski'],
  ['ru', 'Russian', 'russian', /на русском/],
  ['ja', 'Japanese', 'japanese', /日本語/],
  ['zh', 'Chinese', 'chinese|mandarin', /中文/],
  ['ar', 'Arabic', 'arabic', /بالعربية/],
  ['he', 'Hebrew', 'hebrew', /בעברית/],
  ['hi', 'Hindi', 'hindi'],
  ['tr', 'Turkish', 'turkish|t[uü]rk[cç]e'],
  ['uk', 'Ukrainian', 'ukrainian'],
  ['is', 'Icelandic', 'icelandic|[ií]slenska'],
  ['sv', 'Swedish', 'swedish|svenska'],
  ['no', 'Norwegian', 'norwegian|norsk'],
  ['da', 'Danish', 'danish|dansk'],
  ['fi', 'Finnish', 'finnish|suomi'],
  ['cs', 'Czech', 'czech|[cč]e[sš]tina'],
  ['el', 'Greek', 'greek'],
  ['ko', 'Korean', 'korean'],
  ['id', 'Indonesian', 'indonesian|bahasa'],
  ['vi', 'Vietnamese', 'vietnamese'],
  ['hu', 'Hungarian', 'hungarian|magyar'],
  ['ro', 'Romanian', 'romanian|rom[aâ]n[aă]'],
];

const LANGUAGES: ReadonlyArray<readonly [code: string, name: string, pattern: RegExp]> =
  LANGUAGE_NAMES.map(([code, name, names, native]) => [
    code,
    name,
    new RegExp(
      [
        `\\b(?:in|into|only in)\\s+(?:${names})\\b`,
        `\\b(?:${names})\\s+(?:interface|ui|version|language|localis(?:ation|ed)|localiz(?:ation|ed))\\b`,
        `\\b(?:speaks?|translated into)\\s+(?:${names})\\b`,
        ...(native ? [native.source] : []),
      ].join('|'),
    ),
  ]);

const RULES: Rule[] = [
  {
    // "free" and its most common translations. Not "freelance", not "free
    // trial" — the boundary and the negative lookahead keep both out.
    test: /\b(free(?!\s*trial)|gratis|gratuito|gratuit|kostenlos|бесплатн\w*|חינם)\b/,
    constraint: { key: 'free', label: 'Free', kind: 'pricing', pricing: FREE_PRICING },
  },
  {
    test: /\b(open[- ]?source|foss|libre software)\b/,
    constraint: {
      key: 'open-source',
      label: 'Open source',
      kind: 'pricing',
      pricing: ['open_source'],
    },
  },
  {
    test: /\b(offline|sin conexi[oó]n|without (an? )?(internet|connection)|no internet)\b/,
    constraint: { key: 'offline', label: 'Works offline', kind: 'flag', flag: 'works_offline' },
  },
  {
    test: /\b(no (account|sign[- ]?up|login|registration)|without (an? )?(account|sign[- ]?up|login)|without signing up|sin cuenta|anonymous)\b/,
    constraint: {
      key: 'no-account',
      label: 'No account',
      kind: 'flag',
      flag: 'no_account_needed',
    },
  },
  {
    test: /\b(no ads|without ads|ad[- ]?free|sin (anuncios|publicidad))\b/,
    constraint: { key: 'no-ads', label: 'No ads', kind: 'flag', flag: 'no_ads' },
  },
  {
    test: /\b(end[- ]to[- ]end|e2ee?|encrypted|encryption)\b/,
    constraint: {
      key: 'encrypted',
      label: 'End-to-end encrypted',
      kind: 'flag',
      flag: 'e2e_encrypted',
    },
  },
  {
    test: /\b(export|exports|take my data|own my data)\b/,
    constraint: { key: 'exports', label: 'Exports my data', kind: 'flag', flag: 'exports_data' },
  },
  {
    test: /\b(self[- ]?host(ed|ing)?|on my own server|my own machine)\b/,
    constraint: {
      key: 'self-hosted',
      label: 'Self-hosted',
      kind: 'platform',
      platforms: ['self_hosted'],
    },
  },
  {
    // "on my phone", "for a phone", "en el móvil". Not "phone calls", which is
    // a subject rather than a requirement — a wrong constraint filters good
    // answers out, so this rule asks for the preposition.
    test: /\b(on|for|from|to)\s+(my\s+|a\s+|the\s+)?phone\b|\b(mobile|smartphone|m[oó]vil)\b/,
    constraint: {
      key: 'mobile',
      label: 'On a phone',
      kind: 'platform',
      platforms: ['ios', 'android'],
    },
  },
  {
    test: /\b(iphone|ipad|ios)\b/,
    constraint: { key: 'ios', label: 'iPhone or iPad', kind: 'platform', platforms: ['ios'] },
  },
  {
    test: /\b(android)\b/,
    constraint: { key: 'android', label: 'Android', kind: 'platform', platforms: ['android'] },
  },
  {
    test: /\b(in (the )?browser|web app|website)\b/,
    constraint: { key: 'web', label: 'In a browser', kind: 'platform', platforms: ['web'] },
  },
  {
    test: /\b(mac|macos|macbook)\b/,
    constraint: { key: 'macos', label: 'macOS', kind: 'platform', platforms: ['macos'] },
  },
  {
    test: /\b(windows|pc)\b/,
    constraint: { key: 'windows', label: 'Windows', kind: 'platform', platforms: ['windows'] },
  },
  {
    test: /\b(linux|ubuntu)\b/,
    constraint: { key: 'linux', label: 'Linux', kind: 'platform', platforms: ['linux'] },
  },
];

/** Every rule's pattern again, global, so a match reports where it matched. */
const RULE_SPANS: ReadonlyArray<readonly [RegExp, ReadConstraint]> = RULES.map((rule) => [
  new RegExp(rule.test.source, rule.test.flags.includes('g') ? rule.test.flags : `${rule.test.flags}g`),
  rule.constraint,
]);

const LANGUAGE_SPANS: ReadonlyArray<readonly [RegExp, ReadConstraint]> = LANGUAGES.map(
  ([code, name, pattern]) => [
    new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`),
    { key: `lang-${code}`, label: name, kind: 'language', language: code } as ReadConstraint,
  ],
);

/** Half-open `[start, end)` of the lower-cased sentence that a rule consumed. */
interface Span {
  start: number;
  end: number;
}

/** What a sentence said, and what is left of it once that has been taken out. */
export interface QueryReading {
  /** The constraints, minus anything in `dropped`. The chips are drawn from this. */
  constraints: ReadConstraint[];
  /**
   * The sentence with every phrase a rule consumed removed: the text — and the
   * only text — full-text search should rank on.
   *
   * Empty when the sentence was nothing but constraints ("free", "open source
   * and offline"). Empty is a real answer, not a failure: `search_tools` reads
   * an empty query as browse — the catalogue in editorial order with the hard
   * constraints still applied — and every row it returns says `match_source =
   * 'browse'`, so no card claims to have matched anything. See `emptyText`.
   */
  text: string;
  /**
   * True when stripping emptied the sentence. The caller does not need it to
   * search — an empty `text` is already the right thing to send — but the
   * screen may want to word itself differently for a browse.
   */
  emptyText: boolean;
}

/** A letter or a digit anywhere: the difference between a query and punctuation. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/** Junk a removed phrase can leave hanging at either end. */
const EDGE_JUNK = /^[\s,;:.!?/\-–—]+|[\s,;:.!?/\-–—]+$/gu;

/**
 * Read a sentence: the constraints it states, and the text that is left.
 *
 * Removal is by span, not by word. A rule that matched reports the exact
 * characters it matched and only those are taken out — "free" in "free tool"
 * goes because the pricing rule matched it there; "free" in "Freedom
 * Scientific" stays because no rule ever matched it. The same rule matching
 * twice removes both, and nothing else.
 *
 * A dropped constraint is still stripped from the text. Dropping is the person
 * saying "stop filtering on that", not "rank on that word": putting "free"
 * back into the query would hand the ranker the exact word this function
 * exists to keep out of it, and would make a loosened search noisier than the
 * one it loosened.
 *
 * `dropped` is the set of keys switched off on the results screen; a dropped
 * constraint is read and then discarded rather than never read, so the chip can
 * still be drawn as removed and the count of what was understood stays honest.
 */
export function readQuery(query: string, dropped: readonly string[] = []): QueryReading {
  const lower = query.toLowerCase();
  // Lower-casing is length-preserving for nearly everything, but not for all of
  // Unicode ("İ" grows a character). Slice the original when the offsets line
  // up — a person's capitals are theirs — and the lower-cased copy when they do
  // not, which costs nothing: to_tsvector lower-cases anyway.
  const source = lower.length === query.length ? query : lower;

  const found: ReadConstraint[] = [];
  const spans: Span[] = [];

  const collect = (patterns: ReadonlyArray<readonly [RegExp, ReadConstraint]>) => {
    for (const [pattern, constraint] of patterns) {
      let matched = false;
      for (const match of lower.matchAll(pattern)) {
        matched = true;
        spans.push({ start: match.index, end: match.index + match[0].length });
      }
      if (matched) found.push(constraint);
    }
  };

  collect(RULE_SPANS);
  collect(LANGUAGE_SPANS);

  // "Open source" already says everything "free" would, and two pricing
  // constraints cannot both be true of one row: the narrower one wins. Both
  // phrases still come out of the text — "free" was a constraint word here
  // whether or not it survived as a constraint.
  const openSource = found.some((c) => c.key === 'open-source');
  const kept = openSource ? found.filter((c) => c.key !== 'free') : found;

  const text = strip(source, spans);

  return {
    constraints: kept.filter((c) => !dropped.includes(c.key)),
    text,
    emptyText: text === '',
  };
}

/** The sentence with the matched spans cut out, tidied but not rewritten. */
function strip(source: string, spans: readonly Span[]): string {
  if (spans.length === 0) return source.trim();

  const ordered = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const pieces: string[] = [];
  let cursor = 0;

  for (const span of ordered) {
    // Two rules can match overlapping phrases ("open source" and "source").
    // Merging as we go keeps the span arithmetic honest.
    if (span.start > cursor) pieces.push(source.slice(cursor, span.start));
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < source.length) pieces.push(source.slice(cursor));

  const rest = pieces
    .join(' ')
    .replace(/\s+/gu, ' ')
    .replace(EDGE_JUNK, '')
    .trim();

  // "a free app in Spanish" minus its constraints is "a app" — words, but no
  // subject. That is still a query and is left alone; only a residue with no
  // letter or digit left in it counts as nothing to search on.
  return HAS_WORD.test(rest) ? rest : '';
}

/**
 * Read the constraints a sentence states outright.
 *
 * The chips, the empty state's offer to loosen one, and `?drop=` are all drawn
 * from this. What search ranks on is `readQuery(...).text`, which is this
 * sentence with these phrases taken back out.
 */
export function readConstraints(query: string, dropped: readonly string[] = []): ReadConstraint[] {
  return readQuery(query, dropped).constraints;
}

/**
 * Turn what was read into the arguments `public.search_tools` takes.
 *
 * Pricing is any-of and platforms are any-of — alternatives a person would
 * accept. Flags are all-of, because a flag is a requirement someone stated.
 * That asymmetry is the SQL function's, not ours; see 0002_search.sql.
 */
export function toSearchConstraints(constraints: readonly ReadConstraint[]): SearchConstraints {
  const pricing = new Set<PricingModel>();
  const platforms = new Set<Platform>();
  const flags = new Set<ToolFlag>();
  const languages = new Set<string>();

  for (const c of constraints) {
    c.pricing?.forEach((p) => pricing.add(p));
    c.platforms?.forEach((p) => platforms.add(p));
    if (c.flag) flags.add(c.flag);
    if (c.language) languages.add(c.language);
  }

  // A narrower pricing rule and a broader one cannot both apply: any-of would
  // widen "open source" back out to "anything free", which is not what was
  // asked. `readConstraints` already drops the broader one; this is the second
  // half of that rule, for a caller assembling constraints by hand. It keys off
  // the constraint that was stated, not off the set — "free" alone expands to
  // four pricing models, one of which is open_source, and reading the set
  // would silently turn every free search into an open-source one.
  const saidOpenSource = constraints.some((c) => c.key === 'open-source');
  const pricingList: PricingModel[] = saidOpenSource ? ['open_source'] : [...pricing];

  return {
    pricing: pricingList.length ? pricingList : null,
    platforms: platforms.size ? [...platforms] : null,
    flags: flags.size ? [...flags] : null,
    languages: languages.size ? [...languages] : null,
  };
}

/** The facts a result carries that a satisfaction chip is drawn from. */
export interface ToolFacts {
  pricing: PricingModel;
  platforms: readonly Platform[];
  languages: readonly string[];
  flags: readonly ToolFlag[];
}

export interface Satisfaction {
  label: string;
  met: boolean;
}

const LANGUAGE_NAME = new Map(LANGUAGE_NAMES.map(([code, name]) => [code, name]));

/** English for a pricing model, as the chips and tags say it. */
export function pricingLabel(pricing: PricingModel): string {
  switch (pricing) {
    case 'free':
      return 'Free';
    case 'freemium':
      return 'Free tier';
    case 'free_trial':
      return 'Free trial';
    case 'open_source':
      return 'Open source';
    case 'donation':
      return 'Free, donation funded';
    default:
      return 'Paid';
  }
}

const FLAG_LABEL: Record<ToolFlag, string> = {
  works_offline: 'Works offline',
  no_account_needed: 'No account needed',
  no_ads: 'No ads',
  has_free_tier: 'Has a free tier',
  exports_data: 'Exports your data',
  e2e_encrypted: 'End-to-end encrypted',
  accessible: 'Accessible',
};

export function flagLabel(flag: ToolFlag): string {
  return FLAG_LABEL[flag] ?? flag;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  browser_extension: 'Browser extension',
  cli: 'Command line',
  api: 'API',
  self_hosted: 'Self-hosted',
};

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

export function languageName(code: string): string {
  return LANGUAGE_NAME.get(code) ?? code.toUpperCase();
}

/**
 * Whether one tool meets each constraint that was asked for.
 *
 * Constraints filter, so a result that came back meets all of them and every
 * chip here is met. That is not a reason to leave the chips off: the person
 * asked for four things and the card says, in four words, that it has all
 * four. Unmet chips exist in the component and will start appearing the moment
 * a constraint is soft — which is Phase 4's business, not this file's.
 */
export function satisfactionsFor(
  tool: ToolFacts,
  constraints: readonly ReadConstraint[],
): Satisfaction[] {
  return constraints.map((c) => {
    switch (c.kind) {
      case 'pricing':
        return {
          label: c.key === 'free' ? pricingLabel(tool.pricing) : c.label,
          met: (c.pricing ?? []).includes(tool.pricing),
        };
      case 'flag':
        return { label: c.label, met: c.flag ? tool.flags.includes(c.flag) : false };
      case 'platform': {
        const wanted = c.platforms ?? [];
        const met = wanted.some((p) => tool.platforms.includes(p));
        return { label: c.label, met };
      }
      case 'language':
        return {
          label: `${c.label} interface`,
          met: c.language ? tool.languages.includes(c.language) : false,
        };
      default:
        return { label: c.label, met: false };
    }
  });
}
