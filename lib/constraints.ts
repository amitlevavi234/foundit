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
 * A word boundary that knows about the rest of the alphabet.
 *
 * `\b` is defined on `[A-Za-z0-9_]`, so it does not sit between a space and a
 * Cyrillic or Hebrew letter: `/\bбесплатн\w*\b/` and `/\bחינם\b/` match nothing
 * at all, and did not, in every Russian and Hebrew sentence this file has ever
 * been given. These two say the same thing about every alphabet.
 */
const OPEN = String.raw`(?<![\p{L}\p{N}])`;
const CLOSE = String.raw`(?![\p{L}\p{N}])`;

/**
 * The shape a platform requirement takes: a preposition, then optionally an
 * article or a possessive.
 *
 * "on windows", "for a mac", "on my pc" name the machine somebody has. The
 * bare nouns do not: "arrange windows", "a PC game launcher", "mac and cheese"
 * are ordinary English, and reading a platform out of them removes every tool
 * that does not run on that platform — which for "a PC game launcher" is the
 * answer.
 *
 * The earlier version of this file asked for that shape from `windows`, `mac`
 * and `phone` only, and let `iphone`, `ipad`, `ios`, `android`, `linux`,
 * `ubuntu`, `macos` and a bare `mobile` through on the argument that no English
 * noun collides with them. That is true of the word and false of the role. Each
 * of these was read as a hard filter and had its subject cut out of the text
 * search:
 *
 *   an app to sell my old iphone            -> ios,     "an app to sell my old"
 *   learn linux commands from the terminal  -> linux,   "learn commands from…"
 *   a tool for android developers …         -> android, "a tool developers …"
 *   generate ios app icons in every size    -> ios,     "generate app icons …"
 *   ubuntu installation guide               -> linux,   "installation guide"
 *   a mobile-first website builder          -> ios+android, "a -first website…"
 *   compare macos and windows file managers -> macos,   "compare and windows…"
 *
 * The last is the worst of them: a sentence comparing two platforms was
 * filtered to one, because `windows` had been gated and `macos` had not. So
 * every platform word now asks for the same shape, and the table below is one
 * table rather than two.
 *
 * The prepositions and determiners are not only English ones. A Spanish or
 * French sentence states the requirement in exactly the same shape — "para el
 * móvil", "pour linux" — and gating on English alone would have made the rule
 * unreachable in every language but one, which is the mistake `OPEN` above
 * exists to remember.
 */
const ON = String.raw`(?:on|for|in|to|from|under|running|para|en|pour|sur|auf|f[uü]r)\s+(?:(?:my|our|your|a|an|the|el|la|mi|un|una)\s+)?`;

/**
 * A possessive with no preposition in front of it: "my mac", "our pc".
 *
 * Only the two desktop rules use it, and only because they already did. It is
 * deliberately *not* extended to the rest of the table: `ON` already covers "on
 * my phone" and "for my ipad", and a bare possessive with nothing in front of
 * it is as often a device in a list as a requirement. eval/golden.jsonl q038 —
 * "password manager that is free and syncs between my laptop and my phone" — is
 * that sentence, and the judgement on it keeps KeePassXC, which is desktop
 * only. Reading a phone out of it deletes the answer somebody judged correct.
 */
const MINE = String.raw`(?:my|our|your)\s+`;

/**
 * The platform word names an audience rather than a machine.
 *
 * "a tool for android developers to test layouts" has the requirement shape and
 * still states nothing about where the tool runs — the layouts are Android's,
 * the tool is a desktop one, and `platforms = {android}` removes every answer.
 * Same for "for windows users", "for mac designers". The subject after the word
 * is what tells them apart, so it is the one thing this guard looks at.
 */
const NOT_AN_AUDIENCE = String.raw`(?!\s+(?:developers?|devs?|engineers?|programmers?|coders?|designers?|users?|owners?|fans?|enthusiasts?|beginners?|students?|admins?|teams?|market|ecosystem)${CLOSE})`;

/**
 * "Free" means a person can use it without paying, which includes a tool whose
 * paid tier exists — the artboards show exactly that, a "Free" chip met by a
 * freemium listing. `free_trial` is not in the list: a trial ends.
 */
export const FREE_PRICING: PricingModel[] = ['free', 'open_source', 'donation', 'freemium'];

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
        `${OPEN}(?:in|into|only in)\\s+(?:${names})${CLOSE}`,
        `${OPEN}(?:${names})\\s+(?:interface|ui|version|language|localis(?:ation|ed)|localiz(?:ation|ed))${CLOSE}`,
        `${OPEN}(?:speaks?|translated into)\\s+(?:${names})${CLOSE}`,
        ...(native ? [native.source] : []),
      ].join('|'),
      'u',
    ),
  ]);

const RULES: Rule[] = [
  {
    // "free" and its most common translations, in the one sense this rule is
    // allowed to read: without paying.
    //
    //   free trial      a trial ends.
    //   free up         "free up space on my phone" is a verb. It was being
    //                   read as a price and its object was being deleted from
    //                   the search text, leaving "app to up space".
    //   free time,      "free" meaning unoccupied, not unpaid.
    //   free space
    //   ad-free,        the compound adjective: "free" here means "without
    //   hands free,     ads", "without hands", "without a watermark". Every
    //   watermark-free  one of these was being read as a price.
    //   freelance       no boundary after "free", so it never matched.
    //
    // The hyphen is its own case: `\b` sits happily between "-" and "free",
    // which is how "ad-free" became a pricing filter.
    test: new RegExp(
      `${OPEN}(?:` +
        [
          '(?<![-–—])' +
            '(?<!\\b(?:ad|ads|hands|watermark|distraction|risk|spam|drm|sugar|gluten|carbon)\\s)' +
            'free(?!\\s*trial)(?!\\s+up)(?!\\s+(?:time|space|disk|storage))',
          'gratis',
          // Both inflect for gender and number — "una app gratuita", "eine
          // kostenlose App" — and neither matched while the ending had to be
          // nothing at all. Not English "gratuitous".
          'gratuit(?!ous)\\p{L}*',
          'kostenlos\\p{L}*',
          // Turkish builds on the stem: "ücretsiz", "ücretsizdir", "ücretsiz
          // bir uygulama". Same treatment as the two above.
          '[uü]cretsiz\\p{L}*',
          // Cyrillic and Hebrew need `OPEN`/`CLOSE` rather than `\b` to match
          // at all; the stem plus any ending is how both languages inflect it.
          'бесплатн\\p{L}*',
          // Hebrew attaches its prepositions, its article and its conjunction
          // to the front of the word rather than writing them separately, and
          // `OPEN` — which asks for a non-letter before the match — refused
          // every one of them. "בחינם" is not an inflection of "חינם", it is
          // *the* ordinary way to say "for free", and the reader was blind to
          // it: "לחפש אפליקציה בחינם לעריכת וידאו" stated a price and read as
          // stating nothing.
          //
          // ב ל ש ה ו מ כ are the attaching letters. ל is the one with a
          // second sense — "לחינם" can mean "in vain" — which is a subject
          // rather than a price; it is accepted anyway because the phrase is
          // vanishingly rare in a sentence describing a tool, and a missed
          // constraint is the recoverable direction while a wrong one is not.
          '[בלשהומכ]?חינ[מם]\\p{L}*',
          // Arabic, spelled out rather than stemmed: "مجان" is also the first
          // four letters of "مجانين" (mad people), so the endings are listed,
          // longest first, and the article and preposition are allowed in
          // front the way Hebrew's are.
          '(?:بال|ال|ب|و)?(?:مجانية|مجانيًا|مجانيا|مجاني|مجانًا|مجاناً|مجانا)',
        ].join('|') +
        `)${CLOSE}`,
      'u',
    ),
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
    // "anonymous" is gone. It is the subject of "anonymous feedback form for my
    // team" — the thing being collected, not a statement about signing in — and
    // reading it as a filter removed every form builder that has accounts,
    // which is all of them.
    test: /\b(no (account|sign[- ]?up|login|registration)|without (an? )?(account|sign[- ]?up|login)|without signing up|sin cuenta)\b/,
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
    // The flag is `e2e_encrypted`, so the rule may only read the sentences that
    // say end-to-end.
    //
    //   encryption      "how to remove encryption from a PDF" was being
    //                   filtered *to* end-to-end-encrypted tools — the exact
    //                   opposite of the question.
    //   encrypted       on its own it describes a file, not a tool: "open an
    //                   encrypted zip". Kept only in front of the thing the
    //                   encryption is of — "encrypted messaging", "encrypted
    //                   notes" — which is a claim about the tool.
    //   end-to-end,     both are testing jargon before they are anything else:
    //   e2e             "end to end testing framework", "e2e test runner".
    //                   They now have to be followed by the word "encrypted".
    test: /\b(end[- ]?to[- ]?end[- ]encrypt(ed|ion)|e2ee|e2e[- ]?encrypt(ed|ion)|encrypted (messag\w+|chat|messenger|notes?|e-?mail|backups?|storage|cloud|drive|vault|calls?))\b/,
    constraint: {
      key: 'encrypted',
      label: 'End-to-end encrypted',
      kind: 'flag',
      flag: 'e2e_encrypted',
    },
  },
  {
    // "export" and "exports" are gone. "software to export my Kindle
    // highlights" is a person describing the job, not requiring a feature, and
    // the rule was deleting the verb out of the sentence as well as filtering
    // on it. What is left is the two phrasings that are only ever a
    // requirement — a person says "I want to own my data" about a tool and
    // about nothing else.
    test: /\b(take my data|own my data)\b/,
    constraint: { key: 'exports', label: 'Exports my data', kind: 'flag', flag: 'exports_data' },
  },
  {
    // "my own machine" is gone with them: it means a desktop app far more often
    // than it means a server somebody administers, and `self_hosted` as a
    // platform filter removes every desktop app there is — including KeePassXC,
    // which is the answer to "keep my passwords in a file on my own machine".
    test: /\b(self[- ]?host(ed|ing)?|on my own server)\b/,
    constraint: {
      key: 'self-hosted',
      label: 'Self-hosted',
      kind: 'platform',
      platforms: ['self_hosted'],
    },
  },
  {
    // "on my phone", "for a phone", "para el móvil". Not "phone calls", which
    // is a subject rather than a requirement — a wrong constraint filters good
    // answers out, so this rule asks for the preposition.
    //
    // "mobile" carries the same distinction one word further on: "on mobile" is
    // the platform, "no mobile data" is the network, and "maps I can use when I
    // have no mobile data" is a sentence about being offline that was being
    // read as a phone and having the word "mobile" cut out of it. A bare
    // "mobile" was still getting through that lookahead in the commonest
    // adjective there is — "a mobile-first website builder" — so it now asks
    // for the preposition like everything else here.
    test: new RegExp(
      `${OPEN}${ON}(?:phone|smartphone|m[oó]vil|` +
        `mobile(?!\\s+(?:data|network|signal|internet|coverage|number|plan)))` +
        `${NOT_AN_AUDIENCE}${CLOSE}`,
      'u',
    ),
    constraint: {
      key: 'mobile',
      label: 'On a phone',
      kind: 'platform',
      platforms: ['ios', 'android'],
    },
  },
  {
    // No English noun collides with these, and it never mattered: "an app to
    // sell my old iphone" and "generate ios app icons in every size" are a
    // subject and a job, not a machine somebody has. So the preposition or the
    // possessive is required, and consumed with the word — "for iphone" must
    // not leave "for" hanging in the text the ranker sees.
    //
    // "<platform> app" is deliberately absent from all four desktop and mobile
    // rules. An iOS app, a Mac app and a Windows app are as often the thing
    // being built as the thing being asked for, and "generate ios app icons"
    // is the sentence that proves it. "<platform> version" stays: nobody asks
    // for the Mac version of something they are not going to run on a Mac.
    test: new RegExp(
      `${OPEN}(?:${ON}(?:iphone|ipad|ios)|(?:iphone|ipad|ios)\\s+version)` +
        `${NOT_AN_AUDIENCE}${CLOSE}`,
      'u',
    ),
    constraint: { key: 'ios', label: 'iPhone or iPad', kind: 'platform', platforms: ['ios'] },
  },
  {
    test: new RegExp(
      `${OPEN}(?:${ON}android|android\\s+version)${NOT_AN_AUDIENCE}${CLOSE}`,
      'u',
    ),
    constraint: { key: 'android', label: 'Android', kind: 'platform', platforms: ['android'] },
  },
  {
    // "website" is gone. It is the commonest object in the language for the
    // tools this catalogue lists — "a tool to build a website for my bakery",
    // "check whether the website I built is accessible" — and reading it as
    // "the tool must run in a browser" both filtered out every desktop site
    // builder and left "a tool to build a for my bakery" to rank on.
    //
    // "web app" stays, minus the possessive: "a web app to sign a PDF" asks for
    // one, "monitoring for my web app" is talking about the asker's own.
    test: /\b(in (the |a |my )?browser|browser[- ]based|web[- ]based|(?<!\b(my|our|your|their|his|her|its)\s)web app)\b/,
    constraint: { key: 'web', label: 'In a browser', kind: 'platform', platforms: ['web'] },
  },
  {
    // Bare "mac" is a name and half of a sandwich. The preposition, the
    // possessive, or one of the spellings that names a particular machine
    // rather than an ecosystem.
    //
    // Bare "macos" is gone. It is unambiguously the operating system and that
    // was never the question: "compare macos and windows file managers" names
    // two platforms and asks for neither, and reading one of them filtered the
    // comparison down to half of itself. "macbook" and "mac os x" stay bare
    // because both name a machine or a release, the way "windows 11" does.
    test: new RegExp(
      `${OPEN}(?:(?:${ON}|${MINE})(?:mac|macos|macbook)|mac ?os ?x|macbook|mac\\s+version)` +
        `${NOT_AN_AUDIENCE}${CLOSE}`,
      'u',
    ),
    constraint: { key: 'macos', label: 'macOS', kind: 'platform', platforms: ['macos'] },
  },
  {
    // Bare "windows" is a plural noun — "a tool to arrange windows on my
    // desktop" is a window manager, and the Windows filter removed the macOS
    // and Linux ones that were the answer. Bare "pc" is an adjective at least
    // as often as it is a machine: "a PC game launcher".
    test: new RegExp(
      `${OPEN}(?:(?:${ON}|${MINE})(?:windows|pc)(?:\\s+(?:pc|laptop|desktop|machine|computer))?` +
        `|windows ?(?:10|11)|windows\\s+(?:pc|laptop|desktop|machine|computer|version))` +
        `${NOT_AN_AUDIENCE}${CLOSE}`,
      'u',
    ),
    constraint: { key: 'windows', label: 'Windows', kind: 'platform', platforms: ['windows'] },
  },
  {
    // An operating system and a distribution of it — and, bare, the subject of
    // "learn linux commands from the terminal" and "ubuntu installation guide",
    // neither of which says a word about what the answer has to run on. Same
    // shape as the rest.
    test: new RegExp(
      `${OPEN}${ON}(?:linux|ubuntu)${NOT_AN_AUDIENCE}${CLOSE}`,
      'u',
    ),
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

/** Half-open `[start, end)` of the sentence, as typed, that a rule consumed. */
interface Span {
  start: number;
  end: number;
}

/**
 * The lower-cased sentence, and where each character of it came from.
 *
 * Rules match against lower case; the text search ranks on what a person typed.
 * That is only the same string twice as long as lower-casing is
 * length-preserving, and for one letter in daily use it is not: Turkish "İ"
 * lower-cases to "i" plus a combining dot above, two characters for one. Every
 * offset after it in the sentence is then one out.
 *
 * The old code noticed the mismatch and searched, filtered *and returned* the
 * lower-cased copy, which is worse than the arithmetic it was avoiding:
 * "İnternet olmadan çalışan" came back as "i̇nternet …", and `to_tsvector` stems
 * "i" + U+0307 to itself, never to "internet". The word is then unfindable in a
 * catalogue that spells it the ordinary way. Proved against the database:
 * `to_tsvector('simple','İnternet')` is `'internet'`, and the decomposed form
 * is `'i̇nternet'`.
 *
 * So keep the map instead. `startOf[i]` and `endOf[i]` say which characters of
 * the original produced `lower[i]`, and a span that lands part-way through an
 * expansion widens to the whole character rather than splitting it.
 */
interface Folded {
  lower: string;
  startOf: number[];
  endOf: number[];
}

function fold(query: string): Folded {
  const parts: string[] = [];
  const startOf: number[] = [];
  const endOf: number[] = [0];
  let at = 0;

  // By code point: a surrogate pair is one character and lower-cases as one.
  for (const ch of query) {
    const low = ch.toLowerCase();
    parts.push(low);
    for (let k = 0; k < low.length; k += 1) {
      startOf.push(at);
      endOf.push(at + ch.length);
    }
    at += ch.length;
  }
  startOf.push(query.length);

  return { lower: parts.join(''), startOf, endOf };
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
 *
 * **Every constraint the sentence stated is returned, including one a narrower
 * one covers.** "A free open source password manager" states two, and the
 * reader used to keep only "open source" — so no Free chip was ever drawn,
 * `?drop=free` named a chip that did not exist, and dropping "open source" left
 * the search with no pricing filter at all: a paid tool, for a sentence that
 * said free. Narrowing happens where narrowing belongs, in
 * `toSearchConstraints`, which asks for `open_source` while that constraint is
 * still standing and for the whole free list the moment it is not. The two
 * chips are drawn side by side because they are two things a person said and
 * each can be switched off on its own; "Free" looks redundant next to "Open
 * source" precisely until the moment it is the only one left, which is the
 * moment it matters.
 */
export function readQuery(query: string, dropped: readonly string[] = []): QueryReading {
  const folded = fold(query);
  // Whole-string lower-casing is what `to_tsvector` does and is the more
  // faithful of the two where they differ at all (Greek final sigma), so match
  // against it — but only while it lines up with the map, which is what makes
  // the offsets translatable back to the sentence as typed.
  const whole = query.toLowerCase();
  const lower = whole.length === folded.lower.length ? whole : folded.lower;

  const found: ReadConstraint[] = [];
  const spans: Span[] = [];

  const collect = (patterns: ReadonlyArray<readonly [RegExp, ReadConstraint]>) => {
    for (const [pattern, constraint] of patterns) {
      let matched = false;
      for (const match of lower.matchAll(pattern)) {
        matched = true;
        // Back into the original's coordinates before anything is cut. Both
        // ends are in range by construction; the fallback is the offset itself,
        // which is the right answer for every sentence that folded to its own
        // length anyway.
        const from = match.index;
        const to = match.index + match[0].length;
        spans.push({ start: folded.startOf[from] ?? from, end: folded.endOf[to] ?? to });
      }
      if (matched) found.push(constraint);
    }
  };

  collect(RULE_SPANS);
  collect(LANGUAGE_SPANS);

  // Both phrases come out of the text either way — "free" was a constraint word
  // here whether or not it is the one that narrows the search.
  const text = strip(query, spans);

  return {
    constraints: found.filter((c) => !dropped.includes(c.key)),
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
  // asked. So this is the *only* place the narrowing happens — the reader keeps
  // both constraints, and this asks for `open_source` while "open source" is
  // one of them and for the full free list as soon as it is dropped. Losing the
  // broader claim any earlier is how "a free open source password manager",
  // loosened by one chip, came back with paid tools in it.
  //
  // It keys off the constraint that was stated, not off the set — "free" alone
  // expands to four pricing models, one of which is open_source, and reading
  // the set would silently turn every free search into an open-source one.
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
  const said = new Set<string>();
  return chipsFor(tool, constraints).filter((chip) => {
    // "A free open source password manager" states both, and both are kept so
    // that dropping either leaves the other filtering. On an open-source row
    // they say the same word, and a card does not tell a person "Open source ·
    // Open source". The chip row is what was met, not a receipt of the parse.
    if (said.has(chip.label)) return false;
    said.add(chip.label);
    return true;
  });
}

function chipsFor(tool: ToolFacts, constraints: readonly ReadConstraint[]): Satisfaction[] {
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
