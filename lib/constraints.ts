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

/**
 * Read the constraints a sentence states outright.
 *
 * `dropped` is the set of keys the person has switched off on the results
 * screen; a dropped constraint is read and then discarded rather than never
 * read, so the chip can still be drawn as removed and the count of what was
 * understood stays honest.
 */
export function readConstraints(query: string, dropped: readonly string[] = []): ReadConstraint[] {
  const text = query.toLowerCase();
  const found: ReadConstraint[] = [];

  for (const rule of RULES) {
    if (rule.test.test(text)) found.push(rule.constraint);
  }

  for (const [code, name, pattern] of LANGUAGES) {
    if (pattern.test(text)) {
      found.push({ key: `lang-${code}`, label: name, kind: 'language', language: code });
    }
  }

  // "Open source" already says everything "free" would, and two pricing
  // constraints cannot both be true of one row: the narrower one wins.
  const openSource = found.some((c) => c.key === 'open-source');
  const kept = openSource ? found.filter((c) => c.key !== 'free') : found;

  return kept.filter((c) => !dropped.includes(c.key));
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
