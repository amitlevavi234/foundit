-- ===========================================================================
-- Foundit — the 363 generated problem statements, and the measurement that
-- says they are NOT loaded.
--
-- READ THIS BEFORE RUNNING IT.
--
-- **These rows are not in the development database, and loading them makes the
-- search measurably worse.** They are kept, in full, because the run that
-- produced them is a real result and deleting it would hide what happened —
-- the same reason eval/baselines.md keeps its two withdrawn rows.
--
-- WHAT THEY ARE. Phase 5's first deliverable: `gpt-5-mini` wrote problem
-- statements for the 204 published tools that carried fewer than four, and
-- `gpt-5-nano` checked every candidate against the tool's own name and summary
-- before it was stored. 791 were written; 48 were refused by the mechanical
-- gate in lib/generate.ts (a product word, a tool's name, a rephrasing of the
-- summary, not English); 124 were refused by the verifier; 0 were refused as
-- near-duplicates of a statement the tool already had; 358 were stored, plus
-- five from a three-tool trial run, which is the 363 below.
--
-- WHAT THE MEASUREMENT SAID. With them loaded and embedded, on the shipped
-- path with the reranker off:
--
--   nDCG@10    0.7755 -> 0.7508   (-0.0247)
--   recall@10  0.7636 -> 0.7800   (+0.0164)
--   negatives  13 of 30 -> 13 of 30, but 4.1 -> 4.8 rows leaked on average
--
-- Recall goes UP and nDCG goes DOWN, and the two together say exactly what
-- happened: more statements give more tools a way into a result set, so more
-- judged tools appear somewhere in the top twenty — and more UNJUDGED ones
-- appear above them. A statement that is true about a tool is not the same as
-- a statement that should rank it first, and 363 more true sentences spread
-- across 204 listings made the catalogue easier to reach and harder to order.
--
-- docs/build-phases.md Phase 5: "Anything that does not move the number is
-- reverted, not kept out of politeness." So the rows were deleted and the
-- number was recorded. The TOOLING is kept and is not the thing that failed:
-- the migration, the two prompts, the five gates, the job and its tests all
-- stand, and the day the catalogue is real rather than seeded — where two
-- hand-written statements per tool is a genuine shortage rather than a
-- development convenience — this is the file that re-runs in a minute.
--
-- HOW TO LOAD IT, if you want to reproduce the measurement:
--
--   node db/apply.mjs --file db/seed/generated_statements.sql
--   node --env-file=.env.local scripts/embed.mjs          # NEEDS A KEY
--   node --env-file=.env.local eval/run.mjs --no-rerank
--
-- **The second step needs a key, and it did not for one commit.** The vectors
-- for these 363 statements were recorded into db/seed/embeddings.fixture.json
-- so that the 0.7508 reproduced offline, and the Phase 5 review was right that
-- half a megabyte of vectors for rows nobody loads is dead weight in a file
-- every clone carries: the fixture exists so that CI can measure the SHIPPED
-- search with no key, and these are not part of it. They are pruned, and
-- reproducing the reverted measurement now costs one embedding run — about
-- 5,900 tokens, well under a cent, and the number comes back the same because
-- the statements below are byte for byte what was embedded.
--
-- HOW TO UNDO IT:
--
--   delete from public.tool_problems where source = 'generated';
--
-- It runs as the schema OWNER. `public.store_generated_statement` is granted to
-- foundit_embed and to nobody else; the owner may call it because the owner may
-- call anything it owns, and db/apply.mjs connects as the owner. It is
-- idempotent twice over: the setter refuses a tool that already has
-- public.statements_wanted() statements, and `on conflict do nothing` refuses a
-- statement the tool already carries word for word.
-- ===========================================================================

select public.store_generated_statement(
  (select id from public.tools where slug = '1password'),
  'I keep reusing easy passwords because remembering different ones for everyone is impossible',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = '1password'),
  'I can never tell which accounts my partner can actually access when they need to log in',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ableton-live'),
  'My loops drift out of sync when I try to match recorded audio to a beat',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ableton-live'),
  'I need to improvise with backing parts and rearrange a song during a set',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'actual-budget'),
  'I dread syncing my budget online because I don''t trust cloud backups of my money plans',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'adobe-acrobat'),
  'I printed a multi-page PDF to sign, then realized I should''ve signed it electronically',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'aegis-authenticator'),
  'I worry my auth codes could be read if someone gets past my phone lock',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'aegis-authenticator'),
  'Setting up a new device means manually re-doing two-factor for dozens of accounts',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'airalo'),
  'I keep juggling multiple physical SIMs and never know which one has my travel data',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'airalo'),
  'I dread hunting for a shop that sells SIMs after a late-night landing',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'alfred'),
  'I paste the same complex email response but always forget a line or a link',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'alfred'),
  'My clipboard only holds the last thing so I can''t grab text I copied earlier',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'antennapod'),
  'I keep losing network on flights and wish I could queue up episodes beforehand',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'antennapod'),
  'I want to save data by listening without streaming every morning',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'anylist'),
  'I forget which meals we''ve already planned for the week and buy random ingredients I won''t use',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'anylist'),
  'I keep different lists on paper and phone and none of them match when I''m in the store',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ardour'),
  'I spent all night punching in volume changes across ten tracks and still missed a fade at cue 42',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'asana'),
  'I lost track of who promised to finish which task before the deadline approaches',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'asana'),
  'Everyone updates their own to-do list and nothing reflects the project''s true progress',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'audiobookshelf'),
  'I keep buying audiobooks and then can''t remember which ones I''ve already started',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'audiobookshelf'),
  'I can''t listen to a podcast episode across multiple devices without hunting for where I stopped',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'auphonic'),
  'My recording has hiss and background hum that I can''t fix by ear',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'auphonic'),
  'I spent hours manually matching levels across segments and still don''t sound consistent',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'axe-devtools'),
  'I can’t tell which parts of this page will confuse screen reader users during testing',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'axe-devtools'),
  'I have no idea which interactive elements lack keyboard support on this page',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'backblaze-backup'),
  'I keep postponing manual backups because they take forever and I always forget steps',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'backblaze-backup'),
  'I upgraded my machine and dread moving years of documents and photos without losing anything',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'bear'),
  'I keep writing ideas in different places and dread merging them into a single structure',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'bear'),
  'Searching for notes by multiple themes feels clumsy with strict folder hierarchies',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'be-my-eyes'),
  'I can''t see the colour of the shirt in the laundry basket before going out',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'be-my-eyes'),
  'The label on this prescription bottle is smudged and I need someone to confirm it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'beyond-compare'),
  'Merging changes from two collaborators always creates a mess I can''t sort by eye',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'beyond-compare'),
  'Backing up a project twice and not trusting that both backups are the same',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'calibre'),
  'I bought an ebook in a format my reader can''t display and I don''t know how to make it work',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'calibre'),
  'Every book I download comes without metadata so I spend hours typing titles and authors manually',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'camtasia'),
  'I can’t show where to click clearly when the interface is tiny in the original footage',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'camtasia'),
  'I need to add captions and highlights so teammates watching without sound understand each step',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'canva'),
  'I need a social post that looks professional but I can''t make anything that doesn''t feel amateur',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'capcut'),
  'I fumble with timing and cuts because I only edit during a short commute on my phone',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'capcut'),
  'I dread adding captions by hand after filming a quick vertical clip at a party',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'clockify'),
  'I keep forgetting to log hours and my weekly invoice is a mess',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'clockify'),
  'Half the team estimates their time wildly different and I can''t compare them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'cold-turkey'),
  'I tell myself I’ll only check for five minutes and then end up watching hours of clips',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'color-oracle'),
  'I keep guessing which UI elements are distinguishable for colleagues with colour vision differences',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'color-oracle'),
  'Before we ship the mockups I want to know if any buttons will vanish to some viewers',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'cronometer'),
  'I want to know if my meals actually meet the vitamin targets my dietitian set for me',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'cronometer'),
  'I eat a lot of homemade recipes and can''t estimate the nutrients in each serving',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'cryptomator'),
  'I need to send sensitive files through my usual sync folder but can''t risk exposing their contents',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'cryptomator'),
  'I keep copies of family records in a shared folder and worry coworkers can peek into them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'cupboard'),
  'Guests keep bringing duplicates since no one can access our list when they’re at the store',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'czkawka'),
  'I keep downloading albums and now hundreds of identical MP3s clutter my drive',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'czkawka'),
  'My photo folders are full of resized or slightly edited duplicates consuming space',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'darktable'),
  'I shot an entire wedding in raw and now need consistent edits across hundreds of photos',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'darktable'),
  'My external drive has raw images scattered with no searchable info about camera settings',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'davinci-resolve'),
  'I have an hour of footage and no fast way to sync multiple camera angles and audio takes',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'davinci-resolve'),
  'Exporting final projects in different codecs for delivery eats up an afternoon of fiddling',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'daylio'),
  'I forget what I did last week so I can''t tell if days were different or the same',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'daylio'),
  'I want to spot when I feel better or worse but can''t be bothered to write long entries',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'dbeaver'),
  'I’m tired of juggling different connection settings saved in a dozen places when I switch projects',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'deepl'),
  'I keep getting awkward literal translations that make my message sound robotic',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'deepwork'),
  'I start work and an afternoon evaporates because I check feeds every few minutes',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'deepwork'),
  'I promise myself I''ll focus, then give in to a quick site and lose hours',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'descript'),
  'I want to remove a filler word from a recorded interview without hunting through the track',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'discord'),
  'I need a private spot where friends can drop in for a quick voice call without scheduling it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'discord'),
  'We want a single place to share game streams, reactions, and memes while we coordinate play',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'docker-desktop'),
  'I can''t start the project''s database without installing half the internet first',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'docusign'),
  'I emailed the contract and now can''t tell who still needs to sign it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'docusign'),
  'I keep chasing colleagues for signed approvals and it''s holding up the deal',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'draftbin'),
  'I need simple text files I can edit with any editor, not locked into a weird format',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'dropbox'),
  'I lost track of which folder on my laptop has the latest copy after editing on my phone',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'dropbox'),
  'I deleted a document from one device and now can''t find it on any other',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'duckduckgo'),
  'I keep getting followed around by ads for things I casually looked at once',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'duckduckgo'),
  'I worry my searches and visits are being stitched together into a dossier about me',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'duplicati'),
  'I keep forgetting to run copies of my documents before updating my laptop and fear losing work',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'duplicati'),
  'I need encrypted copies stored offsite but don''t want to babysit the process every week',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'element'),
  'Keeping multiple chat histories in sync across servers is a constant headache',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'element'),
  'We need end-to-end encrypted group conversations that don''t force everyone onto the same vendor',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'everything-search'),
  'I can never find that download I saved last week among all these folders',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'everything-search'),
  'I need to open a file buried in a nested project but Windows keeps timing out',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'excalidraw'),
  'I keep sketching flowcharts on paper and then can''t recreate them for the team',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'fastmail'),
  'My inbox is cluttered and searching through years of messages takes forever',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'fastmail'),
  'I don''t trust big companies scanning my emails for marketing purposes',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'feedly'),
  'I keep losing track of which sites publish the topics I care about each morning',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'feedly'),
  'I want to skim headlines from dozens of blogs without opening ten different tabs',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ffmpeg'),
  'I recorded interviews on different phones and need them all in the same format before editing',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'figma'),
  'I keep emailing updated mockups and nobody knows which is latest',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'figma'),
  'We waste hours merging changes after two designers edit the same file offline',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'filezilla'),
  'My colleague set up the server and only handed me credentials to move files manually',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'filezilla'),
  'I want to download a site''s files to work on them locally without touching the server settings',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'firefly-iii'),
  'Every month I forget which recurring payments have cleared and which still need manual attention',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'flameshot'),
  'I need to show someone exactly which button to click in a long settings window',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'flameshot'),
  'My screenshot shows a password field and I can''t just send it as-is',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'freedom'),
  'I keep opening social feeds during work no matter which device I''m using',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'freedom'),
  'I want to stop doomscrolling but can’t manually lock every device at once',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'freshrss'),
  'My inbox-style feed buries posts from small blogs I actually like reading',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'freshrss'),
  'I keep missing posts because the site only shows me ''popular'' articles instead of all new entries',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'geogebra'),
  'I can’t picture how an equation''s terms affect its shape when it''s just on paper',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'geogebra'),
  'Every time I try to explain a function to students they stare blankly at static formulas',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'git'),
  'I need to see every change we''ve ever made to understand why a bug appeared',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'gnucash'),
  'I need proper ledgers and reconciliations but don''t want my finances hosted by someone else',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'gnucash'),
  'My freelance income and expenses are getting messy and I can''t trust a single-column spreadsheet anymore',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'google-docs'),
  'I keep overwriting each other''s edits because we all open the file at once',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'google-docs'),
  'I need to see live changes so I don''t work on an outdated draft',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'google-drive'),
  'My teammate emailed a link but I don''t know if I have permission to open the file',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'google-drive'),
  'I need to pull up a slide deck on my phone for a meeting without digging through downloads',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'google-flights'),
  'I keep switching dates in my head because I don''t know which day is cheapest to leave',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'google-flights'),
  'I''m trying to plan a trip but every airline shows different prices on different days so I can''t pick dates',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'grammarly'),
  'I scramble to fix wording when a quick message suddenly sounds too harsh',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'grammarly'),
  'I spend ages editing a draft because I can''t tell if sentences flow well together',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'grocy'),
  'I keep buying milk because I can''t remember when I last opened a carton',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'grocy'),
  'I plan meals poorly because I don''t know what leftovers are still usable',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'hemingway-editor'),
  'I keep rewording paragraphs but can''t tell which lines are actually hard to follow',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'hemingway-editor'),
  'I send my drafts to colleagues and they say ''too dense'' without pointing out where',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'home-assistant'),
  'I can’t rely on cloud accounts when I want motion sensors and door locks to keep protecting my home offline',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'hostelworld'),
  'I need a cheap place that’s social so I won’t be stuck eating alone every night',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'hostelworld'),
  'I’m planning a last-minute trip and want a bed I can book tonight without calling around',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'httpie'),
  'I want to poke a JSON API and see the body formatted so I can spot the field names',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'httpie'),
  'I need to try different HTTP methods quickly without crafting raw requests each time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ilovepdf'),
  'I need to shrink a PDF so my email will accept the attachment',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ilovepdf'),
  'Turning a dozen scanned images into a single printable document is taking forever',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'imageoptim'),
  'My web pages load slowly because images are bloated with unnecessary data',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'imageoptim'),
  'I''m sending designers giant PNGs that make emails and uploads take forever',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'inkscape'),
  'The artwork looks jagged when exported and my designer keeps asking for vector paths instead of pixels',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'insight-timer'),
  'I can’t fall asleep and want a short guided practice to calm my racing thoughts',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'insight-timer'),
  'I want to try different teachers to find a meditation style that fits me',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'insomnia'),
  'I waste time retyping headers and auth info for each new API I try',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'instapaper'),
  'I find an interesting long write-up but I don’t have time to read it on my laptop right now',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'instapaper'),
  'Browser tabs with long reads pile up until I forget why I opened them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'intellij-idea'),
  'I''ve inherited a messy codebase and I have to safely rename methods used across dozens of modules',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'intellij-idea'),
  'My project has inconsistent imports and I keep wasting time fixing compilation errors across files',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'jitsi-meet'),
  'I need to run a private group call on our server without forcing attendees to sign up',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'jitsi-meet'),
  'I want to share my screen in a meeting but the other person refuses to download or register for anything',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'joplin'),
  'I keep switching computers and losing track of which checklist version is current',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'jq'),
  'I have nested JSON and I''m manually hunting keys to pull the values I need',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'jq'),
  'Every API response contains extra arrays I don''t care about and clutter my logs',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'kagi'),
  'I don''t trust search results that prioritize companies who pay to be visible',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'kagi'),
  'My research keeps getting buried under repetitive pages from a single domain',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'kdenlive'),
  'I have hours of raw high-res clips and my computer chokes when I try to assemble them into a sequence',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'kdenlive'),
  'Rendering previews takes forever so I avoid trying different cuts and effects',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'keepassxc'),
  'I don''t want my master password tied to some company that could change terms overnight',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'keepassxc'),
  'I need to access my credentials even when my internet is down or flaky',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'khan-academy'),
  'My GCSE science coursework is due and I can''t find clear explanations for the topics I forgot',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'khan-academy'),
  'I want to brush up on calculus concepts before university without paying for lessons',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'kiwix'),
  'I keep losing access to articles when the Wi‑Fi drops during fieldwork',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'kiwix'),
  'I want to read Wikipedia on a long flight with unpredictable onboard internet',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'koreader'),
  'Long reading sessions on my eink device leave me squinting because the default text layout is cramped',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'krita'),
  'I want pressure-sensitive brushes that feel like real paint when I draw on my tablet',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'krita'),
  'I''m trying to animate a simple loop but keep losing track of onion-skin frames',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'languagetool'),
  'I keep sending emails with awkward phrasing and wish someone would catch it before I hit send',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'leechblock'),
  'I open social sites automatically whenever I get a tiny pocket of free time and lose the hour',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'leechblock'),
  'I keep refreshing the same site when I should be working on a deadline',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'lensbox'),
  'I keep deleting photos on my phone because I don''t trust online storage limits',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'lensbox'),
  'I want my photos off the internet but can''t find an easy way to copy them to my home drive',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'libretranslate'),
  'I can''t send sensitive meeting notes to an external site without risking leaks',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'libretranslate'),
  'The contract requires keeping all text on-premises while still supporting multiple languages',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'linear'),
  'When someone asks for status I fumble through dozens of half-finished tickets',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'lmms'),
  'I can hear club rhythms in my head but can''t translate them into polished loops',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'lmms'),
  'I want to build an electronic track but struggle to arrange short ideas into a full song',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'localsend'),
  'I keep losing time emailing large files to myself between home devices',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'localsend'),
  'I want to share photos with a friend on the same Wi‑Fi without uploading them anywhere',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'logseq'),
  'My notes are scattered in random files and I want them to reference each other without losing local copies',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'logseq'),
  'When an idea grows I need it to live inside a hierarchy instead of being a flat file I forget about',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'loop-habit-tracker'),
  'I want a simple way to see how consistent I''ve been without internet access',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'loop-habit-tracker'),
  'I get discouraged when I can''t quantify small wins over time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'losslesscut'),
  'I need the exact shots from a recital but exporting the whole file would take forever',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'losslesscut'),
  'I want to stitch together several long recordings without changing their quality',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mealie'),
  'I can never remember which recipes I saved from different cooking blogs when planning dinner',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mealie'),
  'I spend ages copying ingredients and steps from scattered pages before I can shop',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'medito'),
  'I want a calm guided meditation but don''t want anything that pushes purchases at the end',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'medito'),
  'I need a reliable sleep session I can use for weeks without worrying about trial periods ending',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'memrise'),
  'I forget vocabulary the minute I try to use it in a real conversation',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'memrise'),
  'I can read a sentence in class but can''t recognize it when someone says it at normal speed',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mendeley'),
  'I need to insert an in-text citation in my thesis draft but don''t know the citation details',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mendeley'),
  'I want to organize all my PDFs by topic and access their bibliographic info while writing',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'microsoft-todo'),
  'I forget which work emails I promised to act on and which were just FYI',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'microsoft-todo'),
  'My task list is cluttered with projects and I just need a basic daily checklist',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'miniflux'),
  'My news feed is cluttered with autoplaying widgets and I just want simple articles',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'miniflux'),
  'I need something that works reliably over slow connections and minimal system resources',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'monarch-money'),
  'I dread reconciling our budgets each month because every account is in a different place',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'monarch-money'),
  'We keep missing subscription renewals because no one monitors all cards and banks collectively',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'moneymanagerex'),
  'My budget and transaction list shouldn''t be scattered across spreadsheets and receipts on different folders',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'moneymanagerex'),
  'I want a single file I can back up to a USB so my finances survive a laptop crash',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'morfix'),
  'I want to say something in English but I''m unsure which Hebrew word form matches it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mpv'),
  'I want to play videos without menus popping up every time I press a key',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mpv'),
  'I need to chain small playback tweaks with scripts instead of clicking through settings',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mullvad-vpn'),
  'Every time I travel I end up on networks that seem sketchy and I worry about my banking info',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'mullvad-vpn'),
  'I want a simple monthly bill so I don''t have to hunt for complicated plans or hidden promos',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'myfitnesspal'),
  'I can''t remember if that pasta was lunch or dinner and my calories are a blur',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'myfitnesspal'),
  'I try to track calories but every restaurant dish has no nutrition info',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'neovim'),
  'I waste time reaching for the mouse to do tiny edits I could type faster',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'neovim'),
  'I keep switching between multiple editors and lose muscle memory for common commands',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'nextcloud'),
  'I wish my team''s shared documents and calendars were hosted under our own organisation''s control',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'notion'),
  'I keep rewriting the same project brief because I can''t find the latest version',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'nvda'),
  'Reading dense reports takes forever because I can''t skim visually and remember layout',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'nvda'),
  'I need to know what''s being spoken in a video call but can''t follow visual cues',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'obs-studio'),
  'Quiero grabar un tutorial que combine mi webcam, la ventana del editor y el audio del sistema',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ocenaudio'),
  'My computer chokes or freezes whenever I try to edit a long field recording',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ocenaudio'),
  'I need to trim and audition snippets from a giant interview without waiting ages to load it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'onlyoffice'),
  'I need everyone on the team to access the same live spreadsheet on our own servers',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'onlyoffice'),
  'I worry about coworkers using different editors that scramble tracked changes in contracts',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'opendyslexic'),
  'I avoid long passages because the letters feel like they’re sliding around',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'opendyslexic'),
  'Printed homework looks like a jumble so my child refuses to try it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'openfoodfacts'),
  'I wish I could check if this snack contains allergens before buying it at the checkout',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'openfoodfacts'),
  'I''m trying to compare two cereals for sugar and fat but the labels are a nightmare to read',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'osmand'),
  'I want to follow a GPX trail without using cellular data in the mountains',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'osmand'),
  'I get lost on long rural trips where online maps only show highways',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'otter-ai'),
  'I missed who agreed to follow up during the call and now can''t find that promise',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'otter-ai'),
  'My teammate reviewed the demo verbally and I need the exact wording they used',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'overleaf'),
  'I spend hours waiting for my LaTeX to compile just to find a single missing bracket',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'overleaf'),
  'Collaborators keep sending PDF snapshots so we can''t edit the same source together',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'paperfold'),
  'I’m filling out contracts on the move and don’t have a way to copy my usual signature across them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'paperfold'),
  'I’m asked to sign PDFs repeatedly for different recipients and it’s awkward to redraw each time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'paperless-ngx'),
  'My desk is a mountain of medical forms I keep meaning to sort before the next appointment',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'paperless-ngx'),
  'I can''t find the signed contract because it''s buried among printed invoices',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'paprika'),
  'I copy-paste ingredients from a blog and end up with a messy jumble I can''t use',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'paprika'),
  'My bookmarks are full of recipes I never get around to trying because they''re hard to organize',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pdf24'),
  'I need to join a handful of PDFs into one before I email them tonight',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pdf24'),
  'I just realized half the contract is still locked in a PDF I can''t edit',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pdfsam-basic'),
  'I want to remove blank pages and keep only the chapters I care about in this large PDF',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pdfsam-basic'),
  'I received a merged contract and need to extract just my signature page without uploading it anywhere',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'penpot'),
  'I’m tired of juggling multiple proprietary accounts just to collaborate on mockups with my colleagues',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'penpot'),
  'We need to iterate on UI together but our sensitive project can’t leave our infrastructure',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pixelmator-pro'),
  'I need to remove a stubborn blemish and tweak skin tones without signing up for another monthly plan',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pixelmator-pro'),
  'I want to work with layers and masks for a poster project on my Mac and keep the files locally',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pocket-casts'),
  'I fall asleep listening and wake to find episodes still twenty minutes longer than they should be',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pocket-casts'),
  'I can’t understand interviews because speakers mumble and I wish dialogue moved faster without distorting voices',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'polarsteps'),
  'I sent friends scattered photos but nobody has a sense of the whole journey',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'polarsteps'),
  'I want to show relatives where I went without typing up a long travel log',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pomofocus'),
  'I keep losing track of which task I''m on when I take a quick break and then work drifts off course',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'pomofocus'),
  'My browser is already open and I don''t want to switch away every time I try to focus',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'postman'),
  'I keep copy-pasting curl commands and losing track of which ones worked',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'postman'),
  'I need to replay a sequence of requests I ran yesterday to reproduce a bug',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'proton-mail'),
  'I''m nervous sending sensitive documents because I don''t know who can access my messages',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'proton-mail'),
  'I need an email address that doesn''t tie back to my country for privacy-sensitive contacts',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'proton-vpn'),
  'I want to use public Wi‑Fi without worrying someone can snoop my traffic',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'proton-vpn'),
  'I''m trying to stream a show that''s only available in another country',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'quietroom'),
  'The podcast intro is full of distant traffic and it ruins the whole take',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'quizlet'),
  'I need to cram definitions quickly before tomorrow’s exam and don’t know where to start',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'quizlet'),
  'I want to test myself with different question types so I actually remember facts',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'raindrop-io'),
  'I saved interesting articles over years and now can’t remember which folder I put them in',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'raindrop-io'),
  'I keep re-finding the same recipe links across devices and wish they were organized',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'rawtherapee'),
  'My underexposed RAWs look flat and washed out when I try to recover colour and detail',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'rawtherapee'),
  'The default demosaicing makes edges look smeared on high-resolution RAWs',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'raycast'),
  'I keep switching windows and hunting menus when I just want a quick command',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'raycast'),
  'I forget the keyboard shortcuts for the things I do most and fumble around',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'rclone'),
  'I need to mirror a particular folder across my laptop and an external drive without missing hidden files',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'rclone'),
  'I keep juggling different provider web UIs to fetch a few updated files from each of my cloud accounts',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'readwise'),
  'I have highlights scattered across Kindle, PDFs and web articles with no way to review them later',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'readwise'),
  'I want the important lines I read to resurface so they don’t vanish into my archive',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'reaper'),
  'I need to edit and arrange hours of takes without paying monthly fees',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'reaper'),
  'I want to mix and apply effects to songs I made at home without spending a fortune',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'receiptly'),
  'We keep passing receipts around trying to work out who owes what for dinner last night',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'regex101'),
  'I tweaked a regex and now my tests fail but I can’t see which part is wrong',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'regex101'),
  'I keep copy-pasting patterns from the internet and they behave differently on my data',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'remnote'),
  'I cram with scattered flashcards that aren''t connected to the detailed notes I wrote earlier',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'remnote'),
  'I wish my lecture notes would automatically turn into things I actually remember',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'remove-bg'),
  'I have a stack of portrait photos where the messy backgrounds ruin the layout of my newsletter',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'remove-bg'),
  'I keep getting selfies with cluttered rooms behind me and they look unprofessional on my profile',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'restic'),
  'I keep running out of space because every nightly snapshot stores mostly the same files again',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'restic'),
  'I don''t trust that my backups are safe if a single corrupted block ruins the whole archive',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'reverso'),
  'I can translate a sentence but can''t tell if native speakers would ever say it that way',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'reverso'),
  'I keep choosing the wrong tense because I don''t see how verbs look in real dialogue',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'revolut'),
  'I keep getting hit with awful exchange rates when I use my card abroad',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'revolut'),
  'My wallet is full of foreign notes I never managed to exchange back',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'rome2rio'),
  'I can fly into one city and need to figure out how to continue to a nearby town with public transport',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'rome2rio'),
  'I want to compare whether driving or taking public transit will actually save me time and money for a weekend getaway',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'scrivener'),
  'My novel has dozens of scenes spread across folders and I can''t see the structure at a glance',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'scrivener'),
  'I need to rearrange scenes and compare different versions without copying files everywhere',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'seeing-ai'),
  'I''m holding a menu and can''t decipher the printed items to decide what to order',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sentry'),
  'An intermittent bug only appears for certain users and I have no idea what code path caused it',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sentry'),
  'Users keep reporting vague error messages and I can''t tell which release introduced them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'seven-zip'),
  'I need to shrink a huge folder down before I can fit it on a USB stick',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'seven-zip'),
  'I want to bundle a project with its subfolders and keep the exact folder structure intact',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sharex'),
  'I waste time trimming and copying parts of the screen for messages to coworkers',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sharex'),
  'I want to grab a dialog box error and immediately send it without hunting for where the file went',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'shotcut'),
  'My old editor exported a weird format and I just need to apply color tweaks and transitions',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'simplelogin'),
  'I dread signing up because I’ll get promotional mail from a site I’ll never use again',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'simplelogin'),
  'My main inbox is clogged with newsletters from sites I tried once years ago',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sketch'),
  'I can''t keep different versions of our icon set consistent across projects',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sketch'),
  'Designers email each other images because there’s no single source for components',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'skyscanner'),
  'I need to find the cheapest route to a city I barely know exists',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'slack'),
  'I can''t find the message where someone shared the project spec last month',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'slack'),
  'People keep posting updates in the wrong place and I only see them after the fact',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sleep-as-android'),
  'My partner''s snoring wakes me but I don''t know if I snore too or when it happens',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sleep-as-android'),
  'I want to wake up feeling refreshed but I keep hitting snooze and oversleeping',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'speakback'),
  'The transcript is two hours long and I need to know who committed to which task',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'speakback'),
  'My team sent the recording instead of minutes and I don''t have time to read the whole thing',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'speechify'),
  'I hate struggling through dense reports on the train with no room to open a laptop',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'speechify'),
  'My tired eyes make late-night proofreading impossible but the words still need checking',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'spotify'),
  'I want to play different moods for a party without juggling dozens of CDs',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'spotify'),
  'I keep finding new songs I like but can''t remember their names later',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'squoosh'),
  'I need to email images but my attachments keep getting rejected for being too big',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'squoosh'),
  'My blog images kill load time and I can''t tell which compression level is acceptable',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'standard-notes'),
  'I worry that my shopping list or passwords could be read if my notes sync anywhere',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'standard-notes'),
  'I want to jot down medical details without those entries appearing in cloud previews',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'stirling-pdf'),
  'Every time someone emails a 50-page scan I spend half an hour extracting the few pages we need',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'stirling-pdf'),
  'Our scanner saves huge images so each report is an 80MB PDF that refuses to attach to email',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'strava'),
  'I keep losing motivation because I can''t see if today''s ride was better than last week''s',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'strava'),
  'I do intervals but have no record to see if I''m getting faster over time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sublime-text'),
  'I''m stuck copying text between files because switching windows is slow and clumsy',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'sublime-text'),
  'I can''t quickly jump to a function buried in a hundred-line file when I''m debugging',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'super-productivity'),
  'I lose track of which tasks I actually spent time on across the day and can''t bill accurately',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'super-productivity'),
  'I worry about sensitive project timings being held by a third party I don''t control',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'syncthing'),
  'I want the same project files on two computers but don’t want them uploaded to anyone else’s servers',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tableplus'),
  'I keep hunting through tables to find where a value lives when I could just open the row',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tableplus'),
  'I''m nervous about making a quick tweak because I don''t trust running raw SQL directly',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'telegram'),
  'We need to coordinate hundreds of volunteers at once without missing replies',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'telegram'),
  'I want to broadcast announcements to thousands who subscribe without creating a chaotic reply thread',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tesseract-ocr'),
  'I keep screenshots of error messages and can''t select or translate the text inside them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tesseract-ocr'),
  'My archival photos of old letters are just images and I can''t quote or edit any passages',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'things-3'),
  'I bought an Apple device and want a single place for personal and work tasks that feels native',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'things-3'),
  'My task list is a jumble of errands, big projects and ideas with no way to sort priorities',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'thunderbird'),
  'I dread opening my inbox because messages from different addresses are mixed together',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'thunderbird'),
  'I need to check multiple calendars and emails without switching devices all the time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ticktick'),
  'I lose track of small routines because they''re scattered across different places',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ticktick'),
  'I forget which days I promised to repeat something until it''s already missed',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tldraw'),
  'I get ideas at odd hours and need a place to scribble layouts without setup',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tldraw'),
  'Whiteboarding over video calls is clumsy and I just want to draw together in real time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'todoist'),
  'I type ''next Friday'' into a note and later can''t figure which date I actually meant',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tody'),
  'I keep meaning to dust the vents but can''t remember if it''s been months or weeks',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tody'),
  'I can never tell which chores fell off the radar after a hectic month',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'toggl-track'),
  'I start the week full of plans and by Friday can''t tell which projects ate my time',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'toggl-track'),
  'My calendar shows meetings but not the hours I actually spent on billable work',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tor-browser'),
  'I''m avoiding leaving a digital trail when I research politically risky topics online',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tor-browser'),
  'I worry that my online reading habits could be linked to my home address',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'trainline'),
  'I spent two hours toggling different carrier sites to compare times for the same journey',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'trainline'),
  'I want to travel through several countries but dread buying separate tickets for each leg',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'trello'),
  'We waste hours in meetings asking who picked up which tasks last week',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'trello'),
  'Everyone adds tasks in different places so important to-dos get lost',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tripit'),
  'I keep forwarding booking emails to myself and still can''t tell what''s first and what''s last',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tripit'),
  'I printed scattered confirmations and now I can''t tell which reservation goes with which day',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'tuta-mail'),
  'I avoid emailing certain people because I''m not sure who can read the subject line',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'typst'),
  'I keep making formatting mistakes because the markup is fiddly and verbose',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'typst'),
  'I waste time hunting for obscure commands to get equations and headings to look right',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ublock-origin'),
  'So many scripts start that my browser becomes sluggish after a while',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ublock-origin'),
  'I notice pages tracking me across sites and I don''t want my browsing followed',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ulysses'),
  'Switching between blog posts and book chapters breaks my writing flow because they''re not in one place',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'upscayl'),
  'My old screenshots look jagged when I need to print them larger for a poster',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'upscayl'),
  'I want to make a tiny logo bigger for a presentation without losing sharp edges',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'veracrypt'),
  'I have sensitive files on my home PC and I worry someone could read them if they get physical access',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'veracrypt'),
  'I share a computer with roommates but want some files completely private from them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'vikunja'),
  'I want to see all upcoming deadlines on a timeline without juggling separate spreadsheets',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'vikunja'),
  'I get overwhelmed by too many lists and wish I could rearrange tasks visually depending on the day',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'vscode'),
  'I keep losing track of which snippet I used in different projects and it takes ages to recreate them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'vscode'),
  'I spend more time switching between an editor and a terminal than writing code',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wallabag'),
  'I keep losing articles behind paywalls and want to keep the text I actually read',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wallabag'),
  'I save long reads from different sites and get distracted before I finish them',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wave-webaim'),
  'Our QA found vague accessibility issues and I need a clear annotated screenshot to discuss',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wave-webaim'),
  'I''m reviewing pages and want a quick way to see which controls lack proper semantic structure',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wireshark'),
  'I promised to prove whether a device is speaking the right protocol on the wire',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wireshark'),
  'I need to confirm if traffic is encrypted or being transmitted in plain text',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wise'),
  'I need to pay my contractor in euros but my account only holds pounds and I hate losing money in secret exchange spreads',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wise'),
  'I get paid in one currency and rent is due in another so I end up guessing how much to send each month',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wolframalpha'),
  'I need a numeric result for an odd equation and can''t trust my mental math',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wolframalpha'),
  'I keep mixing units and end up with answers that don''t make sense',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wordreference'),
  'I''m torn between two translations and wish I knew which native speakers actually use',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'wordreference'),
  'A literal dictionary entry exists but friends say it sounds odd in conversation',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'ynab'),
  'I keep saving for things but then dip into those piles without remembering why',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'zettlr'),
  'Turning my messy markdown notes into a submission-ready PDF feels like starting from scratch',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'zettlr'),
  'I keep breaking citations when juggling multiple bibliography files for one project',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'zoom'),
  'I need to show my screen to colleagues across three offices and keep everyone visible',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'zoom'),
  'I’ve got a lecture to deliver to hundreds of students who can’t come in person',
  'gpt-5-mini', 'gpt-5-nano');
select public.store_generated_statement(
  (select id from public.tools where slug = 'zotero'),
  'I bookmark articles I intend to cite but the metadata is scattered and messy',
  'gpt-5-mini', 'gpt-5-nano');
