-- ===========================================================================
-- Foundit — DEVELOPMENT SEED DATA.
--
-- READ THIS BEFORE QUOTING ANYTHING BELOW.
--
-- This file is development data. It is approximate. It is NOT the catalogue.
-- It exists for one reason: the search evaluation harness cannot measure
-- ranking against ten rows, because every query trivially scores 1.0. So this
-- file fills the database with enough real, varied, widely-known tools that a
-- ranking can actually be wrong, and therefore actually be measured.
--
-- What is true here and what is not:
--
--   * The tool names and https addresses are real and are the ones a person
--     would type. Those we are confident about.
--   * The summaries, pricing model, platforms, languages and flags are a
--     ROUGH, POINT-IN-TIME approximation written from general knowledge. They
--     are good enough to rank against and NOT good enough to show a visitor.
--     Pricing especially: products change their plans, and nothing here was
--     checked against a price page.
--   * The problem statements are written by us in the voice a person would
--     use. They are the thing search matches against, and they are the point
--     of this file. They describe what a tool is FOR, not what it has.
--     They are written from the tool's name and summary and from nothing
--     else. In particular they are NOT written from the evaluation queries:
--     a corpus that echoes the questions it will be asked measures nothing
--     but its own echo. A statement here is a situation somebody is in
--     ("the disk is full of the same photos copied three times"), never a
--     search query somebody typed.
--
--   * Statements in Hebrew, Spanish, French, Arabic, Russian and Portuguese
--     are scattered across roughly a quarter of the catalogue, chosen by
--     which tools plausibly have speakers of those languages using them --
--     a video player and a photo editor as readily as a dictionary. They are
--     deliberately NOT concentrated on the tools a non-English test query
--     happens to want: an earlier version of this file did exactly that, and
--     the non-English half of the evaluation was measuring the planting
--     rather than the search.
--   * The ten invented tools at the top (Tabsplit, Receiptly, ...) are still
--     fiction and are kept because the permission tests reference them.
--
-- ALL OF IT IS REPLACED by the real curated catalogue before launch. Nothing
-- in this file should ever reach a production database, a screenshot shown to
-- anyone outside the team, or a sentence that begins "Foundit says that...".
--
-- Every listing seeded here is `claimable = true` with a null owner: these are
-- the launch listings a maker may claim in one click. Embeddings are left
-- NULL on purpose — Phase 2 is text search only, and the embedding job fills
-- them later.
--
-- The file is idempotent. Every insert carries `on conflict do nothing`, so
-- running it twice is a no-op rather than a unique-violation.
-- ===========================================================================

begin;

-- --- the editorial taxonomy -----------------------------------------------
insert into public.categories (slug, name, description, sort_order) values
  ('money',         'Money',         'Splitting, tracking and sending money',            1),
  ('writing',       'Writing',       'Notes, documents and long-form writing',           2),
  ('photos',        'Photos',        'Storing, editing and sharing images',              3),
  ('audio',         'Audio',         'Recording, cleaning and transcribing sound',       4),
  ('documents',     'Documents',     'PDFs, scanning and signing',                       5),
  ('focus',         'Focus',         'Blocking distractions and tracking habits',        6),
  ('travel',        'Travel',        'Planning trips and sharing costs',                 7),
  ('home',          'Home',          'Lists, chores and shared households',              8),
  ('video',         'Video',         'Editing, converting and recording video',          9),
  ('study',         'Study',         'Learning, revising and keeping references',       10),
  ('health',        'Health',        'Food, movement, sleep and mood',                  11),
  ('privacy',       'Privacy',       'Encryption, passwords and staying unwatched',     12),
  ('developer',     'Developer',     'Code, databases and the things around them',      13),
  ('files',         'Files',         'Syncing, backing up and moving files about',      14),
  ('accessibility', 'Accessibility', 'Reading, hearing and seeing an interface',        15),
  ('communication', 'Communication', 'Messages, mail and meeting people',               16),
  ('reading',       'Reading',       'Articles, books, feeds and saving things to read',17),
  ('language',      'Language',      'Translating, defining and writing another tongue',18),
  ('design',        'Design',        'Drawing, diagramming and interface design',       19)
on conflict do nothing;

insert into public.profiles (id, handle, display_name, bio, is_admin) values
  ('dev_admin',  'amit',   'Amit Levavi',  'Building Foundit.', true),
  ('dev_maker',  'priya',  'Priya Raman',  'I make small tools for shared households.', false),
  ('dev_person', 'tomer',  'Tomer Ben-Ari','Travels a lot, splits a lot of bills.',      false)
on conflict do nothing;

-- ===========================================================================
-- PART ONE — the ten invented tools.
--
-- Fiction, kept deliberately. db/test/rls_test.sql names several of them, and
-- 'halfdraft' is the only unpublished row in the database, which is what the
-- draft-visibility test needs.
-- ===========================================================================
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
values
  ('tabsplit', 'Tabsplit', 'https://tabsplit.example',
   'Splits a shared bill unevenly between named people and settles up at the end of a trip.',
   'free', '{web,ios,android}', '{en,es,he}', '{no_ads,exports_data}', 'published',
   true, 'dev_admin', null, false, now() - interval '30 days'),

  ('receiptly', 'Receiptly', 'https://receiptly.example',
   'Photographs a receipt and splits the line items between the people who ate what.',
   'freemium', '{ios,android}', '{en}', '{has_free_tier}', 'published',
   false, 'dev_maker', 'dev_maker', true, now() - interval '4 days'),

  ('quietroom', 'Quiet Room', 'https://quietroom.example',
   'Removes background hiss and room echo from a voice recording without an account.',
   'free', '{web}', '{en,de}', '{no_account_needed,works_offline}', 'published',
   true, 'dev_admin', null, false, now() - interval '60 days'),

  ('paperfold', 'Paperfold', 'https://paperfold.example',
   'Signs a PDF on a phone by drawing once and reusing the signature everywhere.',
   'freemium', '{ios,android,web}', '{en,fr}', '{has_free_tier}', 'published',
   true, 'dev_admin', null, false, now() - interval '90 days'),

  ('cupboard', 'Cupboard', 'https://cupboard.example',
   'A shared grocery list for a household that keeps working with no signal.',
   'free', '{ios,android}', '{en,he}', '{works_offline,no_account_needed,no_ads}', 'published',
   false, 'dev_maker', 'dev_maker', true, now() - interval '12 days'),

  ('deepwork', 'Deepwork', 'https://deepwork.example',
   'Blocks chosen websites during hours you set, and cannot be switched off early.',
   'paid', '{macos,windows,browser_extension}', '{en}', '{exports_data}', 'published',
   true, 'dev_admin', null, false, now() - interval '45 days'),

  ('draftbin', 'Draftbin', 'https://draftbin.example',
   'A plain notes app that stores everything as files you can read without it.',
   'open_source', '{web,linux,macos,windows}', '{en}',
   '{works_offline,no_account_needed,exports_data,e2e_encrypted}', 'published',
   true, 'dev_admin', null, false, now() - interval '20 days'),

  ('lensbox', 'Lensbox', 'https://lensbox.example',
   'Backs up phone photos to a drive you own rather than to anybody''s cloud.',
   'donation', '{ios,android,self_hosted}', '{en,es}', '{e2e_encrypted,exports_data}', 'published',
   true, 'dev_admin', null, false, now() - interval '15 days'),

  ('speakback', 'Speakback', 'https://speakback.example',
   'Turns a long meeting recording into notes with the decisions pulled out.',
   'free_trial', '{web}', '{en,es,de}', '{}', 'published',
   true, 'dev_admin', null, false, now() - interval '8 days'),

  ('halfdraft', 'Halfdraft', 'https://halfdraft.example',
   'An unfinished tool the maker has not published yet, used to test draft visibility.',
   'free', '{web}', '{en}', '{}', 'draft',
   false, 'dev_maker', 'dev_maker', true, null)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('tabsplit','Four of us shared a house for a week and everyone paid for different things',0),
  ('tabsplit','I keep fronting the taxi fares and losing track of who has paid me back',1),
  ('tabsplit','The group spent money in two currencies and the maths has got away from us',2),
  ('tabsplit','We want one number each at the end instead of ten small transfers',3),
  ('receiptly','One person had the steak, three of us had salad, and the bill came as one number',0),
  ('receiptly','I photograph receipts because typing every line into a spreadsheet is unbearable',1),
  ('receiptly','Our flat argues about the shopping because nobody remembers who paid last',2),
  ('quietroom','There is a fridge humming under every word of the interview I recorded',0),
  ('quietroom','My spare room has a hollow ring that makes everything I record sound cheap',1),
  ('quietroom','I need this tidied up in the next ten minutes and I am not signing up for it',2),
  ('paperfold','A form arrived by email and the only device I have on me is my phone',0),
  ('paperfold','I draw my signature once a year and then spend an hour finding it again',1),
  ('cupboard','We have three cartons of milk because nobody could see the list in the shop',0),
  ('cupboard','The supermarket basement has no signal, which is exactly where I need the list',1),
  ('cupboard','Chores here get decided by whoever complains loudest in the group chat',2),
  ('deepwork','I open the same news site forty times a day without deciding to',0),
  ('deepwork','Whatever I set up to stop me, I switch off again ten minutes later',1),
  ('draftbin','I want to still be able to open my notes when this app no longer exists',0),
  ('draftbin','My writing lives on a company server and I would rather it did not',1),
  ('draftbin','Some of what I write down is nobody''s business but mine',2),
  ('lensbox','Every picture I take ends up on somebody''s server by default',0),
  ('lensbox','There is a drive at home doing nothing and my phone is full',1),
  ('speakback','I was half listening to that call and now I cannot remember what we agreed',0),
  ('speakback','An hour of recorded meeting and I only need the three decisions in it',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('tabsplit','money',true), ('tabsplit','travel',false),
  ('receiptly','money',true), ('receiptly','home',false),
  ('quietroom','audio',true),
  ('paperfold','documents',true),
  ('cupboard','home',true),
  ('deepwork','focus',true),
  ('draftbin','writing',true),
  ('lensbox','photos',true),
  ('speakback','audio',true), ('speakback','writing',false)
) as m(tool_slug, cat_slug, is_primary)
  on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- ===========================================================================
-- PART TWO — the development catalogue of real tools.
--
-- Grouped by problem domain. Each group inserts its tools, then the problems
-- those tools solve, then their categories. Every group deliberately mixes
-- free, open-source and paid tools solving the SAME problem, because the
-- evaluation has to be able to prove that a query saying "free" never returns
-- a paid tool, and that requires a paid tool to be sitting right there.
--
-- published_at is derived from the slug so it is varied but deterministic:
-- re-running this file produces the same dates.
-- ===========================================================================

-- --- money and bills ------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('splitwise','Splitwise','https://www.splitwise.com',
   'Tracks shared expenses in a group and works out the smallest set of payments that settles everyone up.',
   'freemium','{web,ios,android}','{en}','{has_free_tier}'),
  ('tricount','Tricount','https://www.tricount.com',
   'Shared expense tracker for a trip or a flatshare, built around one list per group rather than one per friendship.',
   'freemium','{ios,android,web}','{en,fr,de,es,it,nl}','{has_free_tier}'),
  ('settle-up','Settle Up','https://settleup.io',
   'Group expense splitting with multiple currencies and a running balance per person.',
   'freemium','{ios,android,web}','{en,cs}','{has_free_tier}'),
  ('splid','Splid','https://splid.app',
   'Splits group costs without anyone having to make an account, which matters when half the group will never install anything.',
   'free','{ios,android,web}','{en,de}','{no_account_needed}'),
  ('ynab','YNAB','https://www.ynab.com',
   'Zero-based budgeting: every unit of money you have gets assigned a job before you spend it.',
   'free_trial','{web,ios,android}','{en}','{exports_data}'),
  ('actual-budget','Actual Budget','https://actualbudget.org',
   'Local-first envelope budgeting you can run on your own machine, with your data staying in a file you hold.',
   'open_source','{web,self_hosted,windows,macos,linux}','{en}','{works_offline,exports_data,no_ads}'),
  ('firefly-iii','Firefly III','https://www.firefly-iii.org',
   'Self-hosted personal finance manager for accounts, budgets, bills and recurring transactions.',
   'open_source','{self_hosted,web}','{en,de,fr,es,it,nl}','{exports_data,no_ads}'),
  ('gnucash','GnuCash','https://www.gnucash.org',
   'Double-entry accounting on your own computer for personal and small-business books.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru}','{works_offline,no_account_needed,exports_data}'),
  ('moneymanagerex','Money Manager EX','https://moneymanagerex.org',
   'A small desktop finance tracker that keeps everything in one local database file.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru}','{works_offline,no_account_needed,exports_data}'),
  ('monarch-money','Monarch Money','https://www.monarchmoney.com',
   'Pulls bank and card accounts into one place with shared budgets for a couple or a household.',
   'free_trial','{web,ios,android}','{en}','{exports_data}'),
  ('wise','Wise','https://wise.com',
   'Sends money between currencies at the mid-market rate with the fee shown before you confirm.',
   'freemium','{web,ios,android}','{en,es,fr,de,pt,ja}','{has_free_tier}'),
  ('revolut','Revolut','https://www.revolut.com',
   'A phone-first account for spending and holding several currencies while travelling.',
   'freemium','{ios,android,web}','{en,fr,es,de,pl,ru}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('splitwise','Six of us went away and now there are twenty small debts flying about',0),
  ('splitwise','Presté dinero a mi compañero de piso y ya perdí la cuenta',1),
  ('splitwise','The holiday flat went on my card and the others have not paid me back',2),
  ('splitwise','We each covered different meals and want the fewest transfers to square it',3),
  ('tricount','Our trip had five people paying for things and nobody keeping score',0),
  ('tricount','Fuimos de viaje entre amigos y nadie apuntó quién pagó qué',1),
  ('tricount','I want one shared ledger for the weekend instead of chasing people privately',2),
  ('tricount','The flatshare buys washing powder in turns and it never comes out even',3),
  ('settle-up','Half the group paid in euros and half in zloty and the maths is a mess',0),
  ('settle-up','Cada uno pagó en una moneda distinta y no sé cómo cuadrar las cuentas',1),
  ('settle-up','I want to see at any moment what each person in the group is owed',2),
  ('settle-up','We square up once a month and need a running total until then',3),
  ('splid','Half the group will never install an app just to pay me eight pounds',0),
  ('splid','We shared costs for a weekend and nobody wants to hand over an email address',1),
  ('splid','The people I travelled with are not the kind to sign up for anything',2),
  ('splid','I need a quick tally of the trip that anyone can open from a link',3),
  ('ynab','The money is gone by the twentieth and I could not tell you where it went',0),
  ('ynab','I want to decide what each payday is for before it disappears',1),
  ('ynab','Bills catch me by surprise even though they arrive every single year',2),
  ('actual-budget','I want envelope budgeting without handing a company my bank login',0),
  ('actual-budget','My finances should sit in a file on my own disk, not in someone''s account',1),
  ('actual-budget','The budgeting service I paid for shut down and took my history with it',2),
  ('firefly-iii','I already run a server at home and would rather my accounts lived on it',0),
  ('firefly-iii','Standing orders, loans and irregular bills need tracking properly somewhere',1),
  ('gnucash','My small business books need real double entry, not a spreadsheet held together with hope',0),
  ('gnucash','Веду домашнюю бухгалтерию на своём компьютере, без облака и без подписки',1),
  ('moneymanagerex','I want something small that opens fast and keeps one file on my laptop',0),
  ('moneymanagerex','No cloud account, no sync, just a record of what came in and what went out',1),
  ('monarch-money','My partner and I have five accounts between us and no shared picture of them',0),
  ('monarch-money','I would like the household spending in one place without exporting statements monthly',1),
  ('wise','The bank called it a free transfer and quietly took thirty pounds on the rate',0),
  ('wise','Recebo em euros e preciso mandar dinheiro para a minha família no Brasil',1),
  ('revolut','I land in a new country every few weeks and hate paying to spend my own money',0),
  ('revolut','Часто езжу за границу и хочу держать деньги в нескольких валютах сразу',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('splitwise','money',true),('splitwise','travel',false),
  ('tricount','money',true),('tricount','travel',false),
  ('settle-up','money',true),('settle-up','travel',false),
  ('splid','money',true),('splid','travel',false),
  ('ynab','money',true),('actual-budget','money',true),
  ('firefly-iii','money',true),('gnucash','money',true),
  ('moneymanagerex','money',true),('monarch-money','money',true),
  ('wise','money',true),('wise','travel',false),
  ('revolut','money',true),('revolut','travel',false)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- travel ---------------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('rome2rio','Rome2Rio','https://www.rome2rio.com',
   'Shows every way to get from one place to another by plane, train, bus, ferry or car, with rough times and prices.',
   'free','{web,ios,android}','{en,es,fr,de,it}','{no_account_needed}'),
  ('skyscanner','Skyscanner','https://www.skyscanner.net',
   'Compares flight prices across airlines and agents, including whole-month and anywhere searches.',
   'free','{web,ios,android}','{en,es,fr,de,it,pt,ru}','{no_account_needed}'),
  ('google-flights','Google Flights','https://www.google.com/travel/flights',
   'Flight search with a price graph and a calendar view for finding the cheapest day to fly.',
   'free','{web}','{en,es,fr,de,pt,ja}','{no_account_needed}'),
  ('tripit','TripIt','https://www.tripit.com',
   'Turns confirmation emails into one ordered itinerary for a trip.',
   'freemium','{web,ios,android}','{en,de,fr,es,ja}','{has_free_tier}'),
  ('wanderlog','Wanderlog','https://wanderlog.com',
   'Plans a trip day by day on a map, with places, bookings and a shared budget in the same document.',
   'freemium','{web,ios,android}','{en}','{has_free_tier}'),
  ('organic-maps','Organic Maps','https://organicmaps.app',
   'Offline maps and walking directions built on OpenStreetMap data, with no account and no tracking.',
   'donation','{ios,android}','{en,ru,uk,es,fr,de,he,ar}','{works_offline,no_account_needed,no_ads}'),
  ('osmand','OsmAnd','https://osmand.net',
   'Downloadable offline maps with turn-by-turn navigation, contour lines and hiking routes.',
   'freemium','{ios,android}','{en,ru,de,fr,es}','{works_offline,has_free_tier}'),
  ('polarsteps','Polarsteps','https://www.polarsteps.com',
   'Records where you went on a long trip and turns it into a map and a diary to share afterwards.',
   'freemium','{ios,android,web}','{en,nl,de}','{has_free_tier}'),
  ('hostelworld','Hostelworld','https://www.hostelworld.com',
   'Finds and books hostel beds, with reviews written by people who stayed in them.',
   'free','{web,ios,android}','{en,es,fr,de,it}','{}'),
  ('airalo','Airalo','https://www.airalo.com',
   'Buys a data plan for the country you are flying to and installs it as an eSIM before you land.',
   'paid','{ios,android,web}','{en,es,fr,de,ar,ja}','{}'),
  ('trainline','Trainline','https://www.thetrainline.com',
   'Searches and books train and coach tickets across a lot of European operators in one place.',
   'freemium','{web,ios,android}','{en,fr,de,es,it}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('rome2rio','I know where I want to end up and no idea whether that is a train, a bus or a ferry',0),
  ('rome2rio','Rejoindre un aéroport depuis une petite ville n''est jamais un trajet direct',1),
  ('skyscanner','I have a week off in March and no particular destination in mind',0),
  ('skyscanner','Quiero ver el precio de los vuelos de todo el mes antes de elegir la fecha',1),
  ('skyscanner','The dates are flexible and I want to know which day is the cheap one',2),
  ('google-flights','Flying on the Tuesday instead of the Friday might save me two hundred pounds',0),
  ('google-flights','I want to watch one route for a few weeks and be told when it drops',1),
  ('tripit','Six confirmation emails for one trip and none of them in the right order',0),
  ('tripit','At the airport I want one screen with the flight, the hotel and the pickup on it',1),
  ('wanderlog','The trip plan is spread over a chat, a map and three different notes',0),
  ('wanderlog','On part à cinq et il faut décider ensemble du programme de chaque journée',1),
  ('organic-maps','My phone has no data abroad and I still need to find the hostel',0),
  ('organic-maps','المنطقة التي أزورها بلا تغطية إنترنت وأحتاج أن أعرف طريقي',1),
  ('organic-maps','I would rather not have a map company logging everywhere I walk',2),
  ('organic-maps','Footpaths and small bridges around here are missing from the big map apps',3),
  ('osmand','I drive through places where the signal disappears for an hour at a time',0),
  ('osmand','Contour lines matter to me because I am walking, not driving',1),
  ('polarsteps','Four months on the road and my family wants to see where I have got to',0),
  ('polarsteps','When the trip ends I want something better than a camera roll to look back on',1),
  ('hostelworld','Travelling alone, and a hotel room is both expensive and lonely',0),
  ('hostelworld','I want to know what the place is actually like before I pay for a bed',1),
  ('airalo','Landing somewhere new with no working data is a bad way to start a trip',0),
  ('airalo','Buying a local SIM at the airport means a queue and a photocopied passport',1),
  ('trainline','Three operators run trains on this route and each one sells tickets separately',0),
  ('trainline','Je traverse l''Europe en train et chaque pays a son propre site de billets',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('rome2rio','travel',true),('skyscanner','travel',true),
  ('google-flights','travel',true),('tripit','travel',true),
  ('wanderlog','travel',true),('organic-maps','travel',true),
  ('osmand','travel',true),('polarsteps','travel',true),
  ('hostelworld','travel',true),('airalo','travel',true),
  ('trainline','travel',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- writing and notes ----------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('notion','Notion','https://www.notion.com',
   'Documents, databases and wikis in one workspace, shared with a team or kept to yourself.',
   'freemium','{web,ios,android,windows,macos}','{en,es,fr,de,ja,ko,pt}','{has_free_tier}'),
  ('obsidian','Obsidian','https://obsidian.md',
   'Notes stored as plain Markdown files on your own disk, linked together into a graph.',
   'freemium','{windows,macos,linux,ios,android}','{en}','{works_offline,no_account_needed,exports_data,has_free_tier}'),
  ('logseq','Logseq','https://logseq.com',
   'An outliner for daily notes and linked ideas that keeps everything in local Markdown files.',
   'open_source','{windows,macos,linux,ios,android}','{en,zh}','{works_offline,no_account_needed,exports_data}'),
  ('joplin','Joplin','https://joplinapp.org',
   'Markdown notes and to-do lists that sync end-to-end encrypted through storage you choose.',
   'open_source','{windows,macos,linux,ios,android,cli}','{en,fr,de,es,ja,ru}','{works_offline,e2e_encrypted,exports_data}'),
  ('standard-notes','Standard Notes','https://standardnotes.com',
   'A notes app where everything is encrypted before it leaves the device, including the titles.',
   'freemium','{web,windows,macos,linux,ios,android}','{en}','{e2e_encrypted,has_free_tier,exports_data}'),
  ('bear','Bear','https://bear.app',
   'A Markdown notes app for Apple devices organised by tags rather than folders.',
   'freemium','{ios,macos}','{en}','{has_free_tier,exports_data}'),
  ('ia-writer','iA Writer','https://ia.net/writer',
   'A deliberately plain Markdown editor with a focus mode and a syntax highlighter for weak prose.',
   'paid','{macos,windows,ios,android}','{en}','{works_offline,exports_data}'),
  ('ulysses','Ulysses','https://ulysses.app',
   'A long-form writing app that keeps a whole book or blog in one library with goals per sheet.',
   'paid','{macos,ios}','{en,de}','{exports_data}'),
  ('scrivener','Scrivener','https://www.literatureandlatte.com/scrivener',
   'A writing environment for book-length work, with a corkboard, research folder and per-scene drafts.',
   'free_trial','{windows,macos,ios}','{en}','{works_offline,exports_data}'),
  ('google-docs','Google Docs','https://docs.google.com',
   'A word processor in the browser where several people can edit the same document at once.',
   'freemium','{web,ios,android}','{en,es,fr,de,pt,ja,he,ar}','{has_free_tier}'),
  ('libreoffice','LibreOffice','https://www.libreoffice.org',
   'A full office suite for documents, spreadsheets and presentations that runs entirely on your machine.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,it,ru,he,ar}','{works_offline,no_account_needed,exports_data,no_ads}'),
  ('onlyoffice','ONLYOFFICE','https://www.onlyoffice.com',
   'An office suite with strong Microsoft format fidelity that can be self-hosted for a team.',
   'freemium','{web,windows,macos,linux,self_hosted}','{en,de,fr,es,ru}','{has_free_tier}'),
  ('hemingway-editor','Hemingway Editor','https://hemingwayapp.com',
   'Marks the sentences in your draft that are too long, too passive or too complicated to read easily.',
   'freemium','{web,windows,macos}','{en}','{has_free_tier}'),
  ('languagetool','LanguageTool','https://languagetool.org',
   'Grammar, spelling and style checking in more than twenty languages, with a self-hostable server.',
   'freemium','{web,browser_extension,windows,macos,api}','{en,de,fr,es,pt,nl,ru,uk}','{has_free_tier}'),
  ('grammarly','Grammarly','https://www.grammarly.com',
   'Checks English writing for grammar, tone and clarity as you type, across the browser and desktop.',
   'freemium','{web,browser_extension,windows,macos,ios,android}','{en}','{has_free_tier}'),
  ('zettlr','Zettlr','https://www.zettlr.com',
   'A Markdown editor built for academic writing, with citations, footnotes and export to Word or PDF.',
   'open_source','{windows,macos,linux}','{en,de}','{works_offline,no_account_needed,exports_data}'),
  ('overleaf','Overleaf','https://www.overleaf.com',
   'A collaborative LaTeX editor in the browser that compiles as you type, with journal templates.',
   'freemium','{web}','{en,es,fr,de,pt,zh}','{has_free_tier}'),
  ('typst','Typst','https://typst.app',
   'A typesetting system for papers and reports with a simpler syntax than LaTeX and instant preview.',
   'freemium','{web,cli,windows,macos,linux}','{en}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('notion','Our team''s knowledge is scattered through chat messages nobody can find again',0),
  ('notion','I need a page that is part document and part table and keeps changing shape',1),
  ('notion','Entra gente nova na equipa e não há um sítio para onde a mandar',2),
  ('obsidian','My notes are full of ideas that connect and I cannot see the connections',0),
  ('obsidian','Quiero que mis apuntes sean archivos míos y no filas en la base de datos de otro',1),
  ('obsidian','Research for a long project needs to live somewhere that still opens in ten years',2),
  ('obsidian','Everything I have written down is in one folder and none of it talks to anything else',3),
  ('logseq','Every day I start a fresh page and the good bits get buried in it',0),
  ('logseq','I think in bullet points that fold into each other, not in documents',1),
  ('joplin','I want my notes on every device without a company being able to read them',0),
  ('joplin','Mes notes sont réparties sur trois appareils et jamais complètes nulle part',1),
  ('joplin','Whatever I put my notes in, I want to be able to take them out again',2),
  ('standard-notes','Some of what I write is genuinely private, including what I called it',0),
  ('standard-notes','I keep a diary about things no support engineer should ever be able to open',1),
  ('bear','Folders never survive contact with how I actually think, but tags do',0),
  ('bear','I want something on the Mac and the phone that is pleasant enough to open daily',1),
  ('ia-writer','Every writing app I open offers me forty things to do instead of writing',0),
  ('ia-writer','My drafts are full of limp adverbs and I have stopped being able to see them',1),
  ('ulysses','A book''s worth of chapters is scattered across dozens of separate documents',0),
  ('ulysses','I need a daily word count that follows whichever piece I am on',1),
  ('scrivener','The chapter order changes weekly and moving text between files is killing me',0),
  ('scrivener','The interviews, the research and the manuscript need to sit side by side',1),
  ('google-docs','Tres personas tenemos que escribir el mismo documento a la vez',0),
  ('google-docs','Someone has to be able to leave comments without installing anything first',1),
  ('libreoffice','I need a word processor and a spreadsheet and I am not renting them by the month',0),
  ('libreoffice','Je veux une suite bureautique gratuite qui ouvre les fichiers Word du bureau',1),
  ('libreoffice','The old computer cannot run the new office suite and does not need to',2),
  ('libreoffice','My documents should open whether or not I am online today',3),
  ('onlyoffice','Files come from work in Microsoft formats and have to go back looking identical',0),
  ('onlyoffice','Our documents are not allowed to leave the servers we run ourselves',1),
  ('hemingway-editor','My sentences run on for four lines and I stopped noticing years ago',0),
  ('hemingway-editor','The report reads like it was written by a committee, because it was',1),
  ('languagetool','I write in a language that is not my first and small mistakes slip past me',0),
  ('languagetool','Escribo en español y en inglés y se me escapan errores en los dos',1),
  ('languagetool','The checker we use sends every sentence we write to somebody else''s server',2),
  ('grammarly','English is my second language and emails to clients need to land right',0),
  ('grammarly','I re-read my own writing and stop seeing the typos entirely',1),
  ('zettlr','A dissertation with two hundred citations cannot be held together by hand',0),
  ('zettlr','The department wants Word at the end and I want to write in plain text',1),
  ('overleaf','My co-author and I keep emailing each other broken LaTeX',0),
  ('overleaf','The journal has a template and I have no idea how to install a LaTeX toolchain',1),
  ('typst','I want a properly typeset report without learning LaTeX first',0),
  ('typst','Waiting twenty seconds to see what a change did breaks my concentration',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('notion','writing',true),('obsidian','writing',true),('obsidian','study',false),
  ('logseq','writing',true),('logseq','study',false),
  ('joplin','writing',true),('joplin','privacy',false),
  ('standard-notes','writing',true),('standard-notes','privacy',false),
  ('bear','writing',true),('ia-writer','writing',true),('ulysses','writing',true),
  ('scrivener','writing',true),('google-docs','writing',true),
  ('libreoffice','writing',true),('libreoffice','documents',false),
  ('onlyoffice','writing',true),('onlyoffice','documents',false),
  ('hemingway-editor','writing',true),('languagetool','writing',true),
  ('languagetool','language',false),('grammarly','writing',true),
  ('zettlr','writing',true),('zettlr','study',false),
  ('overleaf','writing',true),('overleaf','study',false),
  ('typst','writing',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- images, drawing and design -------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('photopea','Photopea','https://www.photopea.com',
   'A layered image editor that runs in a browser tab and opens PSD files without installing anything.',
   'freemium','{web}','{en,es,fr,de,ru,pt}','{no_account_needed,has_free_tier}'),
  ('gimp','GIMP','https://www.gimp.org',
   'A full raster image editor for retouching, compositing and masking, free for any use.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru,ja}','{works_offline,no_account_needed,no_ads}'),
  ('krita','Krita','https://krita.org',
   'A painting program made for digital artists, with brush engines, animation frames and canvas rotation.',
   'open_source','{windows,macos,linux,android}','{en,de,fr,ja,ru}','{works_offline,no_account_needed,no_ads}'),
  ('inkscape','Inkscape','https://inkscape.org',
   'A vector drawing program for logos, diagrams and anything that has to stay sharp at any size.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ja}','{works_offline,no_account_needed}'),
  ('darktable','darktable','https://www.darktable.org',
   'Non-destructive raw photo developing and cataloguing for photographers who shoot in raw.',
   'open_source','{windows,macos,linux}','{en,de,fr,es}','{works_offline,no_account_needed}'),
  ('rawtherapee','RawTherapee','https://www.rawtherapee.com',
   'A raw converter with very fine control over demosaicing, noise and colour, for stills.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru}','{works_offline,no_account_needed}'),
  ('excalidraw','Excalidraw','https://excalidraw.com',
   'A whiteboard that draws boxes and arrows in a hand-drawn style, shareable by link.',
   'freemium','{web}','{en,es,fr,de,he,ar,zh}','{no_account_needed,e2e_encrypted,has_free_tier}'),
  ('tldraw','tldraw','https://www.tldraw.com',
   'An infinite canvas for sketching diagrams and interfaces quickly, alone or with others.',
   'freemium','{web}','{en}','{no_account_needed,has_free_tier}'),
  ('figma','Figma','https://www.figma.com',
   'Interface design and prototyping in the browser, with several designers in the same file.',
   'freemium','{web,windows,macos}','{en,ja,ko,pt,es}','{has_free_tier}'),
  ('penpot','Penpot','https://penpot.app',
   'Open-source interface design and prototyping that a team can run on its own servers.',
   'open_source','{web,self_hosted}','{en,es,fr,de,pt}','{has_free_tier}'),
  ('canva','Canva','https://www.canva.com',
   'Template-driven design for posters, slides and social posts by people who are not designers.',
   'freemium','{web,ios,android,windows,macos}','{en,es,pt,fr,de,ar,he}','{has_free_tier}'),
  ('sketch','Sketch','https://www.sketch.com',
   'A Mac-native interface design tool with symbols, shared libraries and a browser handoff view.',
   'paid','{macos,web}','{en}','{}'),
  ('pixelmator-pro','Pixelmator Pro','https://www.pixelmator.com/pro',
   'A one-off purchase image editor for the Mac covering retouching, layers and colour adjustment.',
   'paid','{macos}','{en}','{works_offline}'),
  ('squoosh','Squoosh','https://squoosh.app',
   'Shrinks an image in the browser and shows the quality loss side by side before you save it.',
   'open_source','{web}','{en}','{works_offline,no_account_needed,no_ads}'),
  ('imageoptim','ImageOptim','https://imageoptim.com',
   'Strips the waste out of PNG and JPEG files on a Mac so pages load faster.',
   'free','{macos}','{en}','{works_offline,no_account_needed,no_ads}'),
  ('remove-bg','remove.bg','https://www.remove.bg',
   'Cuts the background out of a photo of a person or a product automatically.',
   'freemium','{web,windows,macos,api}','{en,de,es,pt}','{has_free_tier}'),
  ('upscayl','Upscayl','https://upscayl.org',
   'Enlarges a small or blurry image on your own machine without sending it anywhere.',
   'open_source','{windows,macos,linux}','{en}','{works_offline,no_account_needed}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('photopea','Someone sent me a layered file and I do not own the program that made it',0),
  ('photopea','Preciso de mexer numa imagem sem instalar nada neste computador',1),
  ('photopea','It is a five minute job on a work laptop I am not allowed to install things on',2),
  ('photopea','One image needs fixing and a two gigabyte download is not worth it',3),
  ('gimp','Taking a lamppost out of a holiday photo should not cost a monthly fee',0),
  ('gimp','الصور التي ألتقطها تحتاج تعديلا وليس لدي ميزانية لبرنامج بالاشتراك',1),
  ('gimp','I want to blend two pictures into one and I am willing to learn how',2),
  ('gimp','The photo is nearly right except the sky came out completely white',3),
  ('krita','Рисую на планшете, и кисти в обычных редакторах никуда не годятся',0),
  ('krita','A short animated sequence, drawn frame by frame, without film software',1),
  ('inkscape','The logo looks fine until somebody prints it on a banner',0),
  ('inkscape','Нужен рисунок, который не рассыпается на пиксели при увеличении',1),
  ('inkscape','I need a diagram that stays crisp at whatever size it ends up',2),
  ('darktable','Two thousand raw files from one weekend and no way to sort the keepers',0),
  ('darktable','I want to change my mind about an edit next year without having ruined the original',1),
  ('rawtherapee','There is detail hiding in the shadows of this file and nothing else will pull it out',0),
  ('rawtherapee','Grain at high ISO is ruining frames that are otherwise good',1),
  ('excalidraw','אני מנסה להסביר מערכת בשיחה ומילים פשוט לא מספיקות',0),
  ('excalidraw','A neat diagram makes people argue about the corners instead of the idea',1),
  ('excalidraw','Somebody needs to scribble on the same board as me right now, with no signup',2),
  ('tldraw','Thinking through a screen layout needs something faster than a design tool',0),
  ('tldraw','An endless sheet of paper is what I actually want, not slides',1),
  ('figma','O designer, o programador e o cliente precisam de ver os mesmos ecrãs',0),
  ('figma','Clicking through a fake version answers questions no still picture can',1),
  ('penpot','Our design files are not allowed to sit on a service we do not control',0),
  ('penpot','Design licences for the whole team come to more than we have',1),
  ('canva','The poster is due tomorrow and nobody here is a designer',0),
  ('canva','Necesito hacer un cartel para mi negocio y no sé diseñar',1),
  ('canva','Slides for the school fundraiser that do not look like school slides',2),
  ('sketch','The whole design team is on Macs and wants something that feels native',0),
  ('sketch','The same button appears on forty screens and changing it is a day''s work',1),
  ('pixelmator-pro','One more monthly subscription for occasional photo edits is one too many',0),
  ('pixelmator-pro','Straightening horizons and fixing colour on a Mac, paid for once',1),
  ('squoosh','The picture at the top of our page is four megabytes and the page crawls',0),
  ('squoosh','I want to see exactly what quality I am giving up before I commit to it',1),
  ('imageoptim','Screenshots I export are twice the size they need to be',0),
  ('imageoptim','Photos going on the website carry camera data I would rather strip out',1),
  ('remove-bg','Product shots for the shop need a plain white background and there are forty of them',0),
  ('remove-bg','Cutting round somebody''s hair by hand takes twenty minutes a picture',1),
  ('upscayl','The only copy of this photo is a small blurry one off an old phone',0),
  ('upscayl','I am not uploading family pictures to a website to make them bigger',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('photopea','photos',true),('gimp','photos',true),('krita','design',true),
  ('krita','photos',false),('inkscape','design',true),('darktable','photos',true),
  ('rawtherapee','photos',true),('excalidraw','design',true),('tldraw','design',true),
  ('figma','design',true),('penpot','design',true),('canva','design',true),
  ('sketch','design',true),('pixelmator-pro','photos',true),('squoosh','photos',true),
  ('imageoptim','photos',true),('remove-bg','photos',true),('upscayl','photos',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- audio ----------------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('audacity','Audacity','https://www.audacityteam.org',
   'A multi-track audio editor for recording, cutting and cleaning up sound on your own machine.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru,ja}','{works_offline,no_account_needed}'),
  ('ocenaudio','Ocenaudio','https://www.ocenaudio.com',
   'A light audio editor that opens very large files quickly and previews effects in real time.',
   'free','{windows,macos,linux}','{en,pt,es}','{works_offline,no_account_needed}'),
  ('reaper','REAPER','https://www.reaper.fm',
   'A complete digital audio workstation in a tiny download, licensed cheaply for individuals.',
   'free_trial','{windows,macos,linux}','{en}','{works_offline}'),
  ('ardour','Ardour','https://ardour.org',
   'An open-source recording studio for multi-track music and post-production with full automation.',
   'open_source','{linux,macos,windows}','{en,de,fr,es}','{works_offline}'),
  ('lmms','LMMS','https://lmms.io',
   'Makes beats and electronic tracks with a pattern editor, synthesisers and a piano roll.',
   'open_source','{windows,macos,linux}','{en,de,fr,es}','{works_offline,no_account_needed}'),
  ('ableton-live','Ableton Live','https://www.ableton.com/en/live',
   'A music production and performance environment built around clips, warping and live looping.',
   'free_trial','{windows,macos}','{en,de,fr,es,ja}','{works_offline}'),
  ('auphonic','Auphonic','https://auphonic.com',
   'Levels, denoises and loudness-normalises a podcast episode automatically after you upload it.',
   'freemium','{web,api}','{en,de}','{has_free_tier}'),
  ('otter-ai','Otter.ai','https://otter.ai',
   'Transcribes a meeting or interview live and lets you search the text afterwards.',
   'freemium','{web,ios,android}','{en}','{has_free_tier}'),
  ('descript','Descript','https://www.descript.com',
   'Edits audio and video by editing the transcript, deleting a word to delete the sound.',
   'freemium','{web,windows,macos}','{en}','{has_free_tier}'),
  ('antennapod','AntennaPod','https://antennapod.org',
   'An open-source podcast player that downloads episodes for offline listening and shows no ads.',
   'open_source','{android}','{en,de,fr,es,pt,ru}','{works_offline,no_account_needed,no_ads}'),
  ('pocket-casts','Pocket Casts','https://pocketcasts.com',
   'A podcast player with trim silence, per-show speed and sync across phone and web.',
   'freemium','{ios,android,web}','{en}','{has_free_tier}'),
  ('audiobookshelf','Audiobookshelf','https://www.audiobookshelf.org',
   'Self-hosted audiobook and podcast server that keeps your position in sync across devices.',
   'open_source','{self_hosted,web,ios,android}','{en,de,fr,es}','{exports_data}'),
  ('spotify','Spotify','https://www.spotify.com',
   'Streams music and podcasts, with playlists, offline downloads on paid plans and a free tier with ads.',
   'freemium','{web,ios,android,windows,macos,linux}','{en,es,pt,fr,de,ja}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('audacity','The voiceover I recorded at home came out thin and uneven',0),
  ('audacity','Записал интервью в кафе, и посуда на записи слышна громче собеседника',1),
  ('audacity','Two hours of tape and I only need the eleven minutes in the middle',2),
  ('audacity','My old cassettes are decaying and I want them on the computer before they go',3),
  ('ocenaudio','A three hour recording takes forever just to open in most editors',0),
  ('ocenaudio','I want to hear what the effect does before I apply it to the whole file',1),
  ('reaper','Studio software costs more than the microphone I am recording with',0),
  ('reaper','I record a band in a spare room and need proper multi-track on no budget',1),
  ('ardour','Making an album at home needs real automation, not a phone app',0),
  ('ardour','The dialogue for this short film has to be mixed against picture',1),
  ('lmms','I want to make beats on a laptop and own nothing but the laptop',0),
  ('lmms','There is a tune stuck in my head and I do not play any instruments',1),
  ('ableton-live','Playing live means triggering loops, not pressing play on a backing track',0),
  ('ableton-live','The samples I have collected are all at different tempos',1),
  ('auphonic','One guest was loud, the other was quiet, and the episode is unlistenable',0),
  ('auphonic','Every platform wants a different loudness and I keep getting it wrong',1),
  ('otter-ai','I cannot take notes and ask questions in the same meeting',0),
  ('otter-ai','Somewhere in nine hours of interviews someone said the thing I need to quote',1),
  ('descript','Cutting a podcast by staring at a waveform is mostly guesswork',0),
  ('descript','Taking one sentence out of a video should not mean scrubbing about for it',1),
  ('antennapod','My commute goes underground and the episodes have to be on the phone already',0),
  ('antennapod','Podcast apps have started putting adverts on top of the adverts',1),
  ('pocket-casts','Some hosts leave four seconds of nothing between every sentence',0),
  ('pocket-casts','I start an episode on the train and want to finish it at my desk',1),
  ('audiobookshelf','I own hundreds of audiobooks and no app will simply play my own files',0),
  ('audiobookshelf','I lose my place every time I move from the phone to the tablet',1),
  ('spotify','أريد الاستماع إلى الموسيقى دون أن أشتري كل ألبوم على حدة',0),
  ('spotify','The flight is eight hours and there is no signal at thirty thousand feet',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('audacity','audio',true),('ocenaudio','audio',true),('reaper','audio',true),
  ('ardour','audio',true),('lmms','audio',true),('ableton-live','audio',true),
  ('auphonic','audio',true),('otter-ai','audio',true),('otter-ai','writing',false),
  ('descript','audio',true),('descript','video',false),('antennapod','audio',true),
  ('pocket-casts','audio',true),('audiobookshelf','audio',true),('spotify','audio',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- video ----------------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('shotcut','Shotcut','https://shotcut.org',
   'A timeline video editor with filters and transitions that runs on any of the three desktops.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru,zh}','{works_offline,no_account_needed}'),
  ('kdenlive','Kdenlive','https://kdenlive.org',
   'A multi-track video editor with proxy editing for large footage on a modest machine.',
   'open_source','{linux,windows,macos}','{en,de,fr,es,it}','{works_offline,no_account_needed}'),
  ('davinci-resolve','DaVinci Resolve','https://www.blackmagicdesign.com/products/davinciresolve',
   'Professional editing, colour grading and audio post in one application, with a capable free version.',
   'freemium','{windows,macos,linux}','{en,es,de,fr,ja,zh}','{works_offline,has_free_tier}'),
  ('handbrake','HandBrake','https://handbrake.fr',
   'Converts video between formats and shrinks large files with presets for phones and web.',
   'open_source','{windows,macos,linux}','{en,de,fr,es}','{works_offline,no_account_needed}'),
  ('obs-studio','OBS Studio','https://obsproject.com',
   'Records the screen and streams live, mixing several sources, cameras and windows into one output.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru,ja}','{works_offline,no_account_needed}'),
  ('vlc','VLC media player','https://www.videolan.org/vlc',
   'Plays essentially any video or audio file, including broken ones, with no codecs to install.',
   'open_source','{windows,macos,linux,ios,android}','{en,de,fr,es,ru,ar,he}','{works_offline,no_account_needed,no_ads}'),
  ('mpv','mpv','https://mpv.io',
   'A minimal, keyboard-driven video player that scripts well and gets out of the way.',
   'open_source','{windows,macos,linux,cli}','{en}','{works_offline,no_account_needed,no_ads}'),
  ('camtasia','Camtasia','https://www.techsmith.com/camtasia',
   'Records the screen and edits it into a tutorial with callouts, zooms and captions.',
   'free_trial','{windows,macos}','{en,de,fr,es,ja}','{works_offline}'),
  ('capcut','CapCut','https://www.capcut.com',
   'Phone-first video editing with automatic captions, templates and effects for short vertical video.',
   'freemium','{ios,android,web,windows,macos}','{en,es,pt,id,ja}','{has_free_tier}'),
  ('losslesscut','LosslessCut','https://mifi.no/losslesscut',
   'Cuts and joins video without re-encoding it, so a trim takes seconds and loses no quality.',
   'open_source','{windows,macos,linux}','{en}','{works_offline,no_account_needed}'),
  ('ffmpeg','FFmpeg','https://ffmpeg.org',
   'The command-line workhorse for converting, trimming and re-muxing audio and video.',
   'open_source','{cli,windows,macos,linux}','{en}','{works_offline,no_account_needed}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('shotcut','Holiday footage needs trimming and I am not subscribing to do it',0),
  ('shotcut','Quero editar os vídeos das férias sem pagar uma assinatura mensal',1),
  ('shotcut','The editor I used only runs on the operating system I stopped using',2),
  ('kdenlive','Four camera angles of the same wedding and one laptop that struggles with one',0),
  ('kdenlive','The footage is 4K and the timeline stutters every time I drag the playhead',1),
  ('davinci-resolve','Straight out of the camera everything looks flat and grey',0),
  ('davinci-resolve','I cut, grade and mix on my own, and switching between three programs eats the day',1),
  ('handbrake','A ten minute clip somehow takes up four gigabytes',0),
  ('handbrake','Los vídeos de la cámara ocupan tanto que ya no caben en el disco',1),
  ('handbrake','The file plays on my computer and the television refuses it',2),
  ('handbrake','My phone will not open the video a relative sent me',3),
  ('obs-studio','Doy clases en línea y necesito que se vean las diapositivas y mi cara a la vez',0),
  ('obs-studio','Showing somebody how the software works means capturing the screen properly',1),
  ('obs-studio','Going live with a camera, a game and a microphone all at once',2),
  ('vlc','Something I downloaded years ago will not play in anything I have',0),
  ('vlc','Un vieux fichier vidéo ne s''ouvre dans aucun lecteur de mon ordinateur',1),
  ('vlc','Every player wants me to install a codec pack of dubious origin first',2),
  ('vlc','The subtitles are two seconds out and nothing will let me nudge them',3),
  ('mpv','I watch with the keyboard and every mainstream player is built for a mouse',0),
  ('mpv','The player should play the file and show me absolutely nothing else',1),
  ('camtasia','New staff keep asking the same question and a written guide is not landing',0),
  ('camtasia','A screen recording needs zooms and arrows before anyone can follow it',1),
  ('capcut','Video without captions gets scrolled past in silence',0),
  ('capcut','I put things together on my phone between other things, not at a desk',1),
  ('losslesscut','I only need the first three minutes and re-encoding an hour is absurd',0),
  ('losslesscut','The dashcam saves fifteen minute chunks that really belong together',1),
  ('ffmpeg','Two hundred clips need the same conversion and I am not clicking through them',0),
  ('ffmpeg','The audio needs pulling out of a video and nothing else about it changing',1),
  ('ffmpeg','This has to run on a server with no screen attached to it',2)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('shotcut','video',true),('kdenlive','video',true),('davinci-resolve','video',true),
  ('handbrake','video',true),('obs-studio','video',true),('vlc','video',true),
  ('mpv','video',true),('camtasia','video',true),('capcut','video',true),
  ('losslesscut','video',true),('ffmpeg','video',true),('ffmpeg','developer',false)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- study and reference --------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('anki','Anki','https://apps.ankiweb.net',
   'Spaced-repetition flashcards that show a card again exactly when you are about to forget it.',
   'freemium','{windows,macos,linux,android,ios,web}','{en,de,fr,es,ja,zh,he,ru}','{works_offline,exports_data,has_free_tier}'),
  ('quizlet','Quizlet','https://quizlet.com',
   'Flashcard sets and practice tests, including millions of sets other students already made.',
   'freemium','{web,ios,android}','{en,es,de,fr,pt}','{has_free_tier}'),
  ('duolingo','Duolingo','https://www.duolingo.com',
   'Short daily language lessons in dozens of languages, built around streaks and small exercises.',
   'freemium','{web,ios,android}','{en,es,fr,de,pt,ja}','{has_free_tier}'),
  ('memrise','Memrise','https://www.memrise.com',
   'Language learning built on spaced repetition and clips of native speakers saying real sentences.',
   'freemium','{web,ios,android}','{en,es,fr,de,ja}','{has_free_tier}'),
  ('zotero','Zotero','https://www.zotero.org',
   'Collects references from the web, stores the PDFs and inserts citations into your word processor.',
   'open_source','{windows,macos,linux,browser_extension}','{en,de,fr,es,it,zh,ja}','{works_offline,exports_data,no_ads}'),
  ('mendeley','Mendeley','https://www.mendeley.com',
   'A reference manager and PDF library with citation plugins for Word and LibreOffice.',
   'freemium','{web,windows,macos,linux}','{en}','{has_free_tier}'),
  ('remnote','RemNote','https://www.remnote.com',
   'Notes and spaced-repetition flashcards in the same document, so revision comes out of your notes.',
   'freemium','{web,windows,macos,ios,android}','{en}','{has_free_tier}'),
  ('khan-academy','Khan Academy','https://www.khanacademy.org',
   'Free lessons and practice in maths and science, from arithmetic to calculus, with no adverts.',
   'free','{web,ios,android}','{en,es,fr,pt,he,ar}','{no_ads}'),
  ('wolframalpha','Wolfram Alpha','https://www.wolframalpha.com',
   'Answers computational questions and shows the steps for equations, integrals and unit conversions.',
   'freemium','{web,ios,android}','{en}','{has_free_tier}'),
  ('geogebra','GeoGebra','https://www.geogebra.org',
   'Interactive geometry, graphing and algebra for seeing what a function or a construction actually does.',
   'free','{web,ios,android,windows,macos,linux}','{en,es,de,fr,he,ar}','{works_offline,no_ads}'),
  ('kiwix','Kiwix','https://kiwix.org',
   'Downloads Wikipedia and other reference libraries to read them with no internet connection at all.',
   'donation','{windows,macos,linux,android,ios}','{en,fr,es,ar,he,ru}','{works_offline,no_account_needed,no_ads}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('anki','I learn a hundred words and forget ninety of them by next month',0),
  ('anki','أحفظ كلمات جديدة كل يوم وأنساها بعد أسبوع',1),
  ('anki','Exams are in eight weeks and re-reading the textbook is not working',2),
  ('anki','Anatomy is thousands of small facts that all have to be there on the day',3),
  ('quizlet','Somebody has already made a deck for this course and I am short on time',0),
  ('quizlet','I revise better when it feels like a game than when I stare at a list',1),
  ('duolingo','I moved country and can only manage ten minutes of study a day',0),
  ('duolingo','יש לי חצי שעה בנסיעה לעבודה ואני רוצה ללמוד שפה חדשה',1),
  ('duolingo','I want to start a language from nothing without booking a class first',2),
  ('duolingo','Good intentions about learning Italian last me about four days',3),
  ('memrise','Textbook sentences sound nothing like the way people actually talk',0),
  ('memrise','I understand the grammar and freeze the moment a native speaker opens their mouth',1),
  ('zotero','My references live in a folder called papers final final',0),
  ('zotero','The journal wants a different citation style and there are ninety references',1),
  ('zotero','I find a paper in the browser and it should reach my library without retyping',2),
  ('mendeley','Hundreds of PDFs and no idea which ones I have already read',0),
  ('mendeley','Citations have to go into Word without me typing a bibliography by hand',1),
  ('remnote','I take notes in lectures and then never turn them into revision',0),
  ('remnote','Reading and remembering are two separate chores and I only ever do the first',1),
  ('khan-academy','ابني متعثر في الرياضيات ولا أعرف كيف أشرح له',0),
  ('khan-academy','I need to relearn the maths I dropped at sixteen, for nothing, at my own pace',1),
  ('wolframalpha','The answer is not the problem, seeing how it got there is',0),
  ('wolframalpha','Unit conversions and a messy integral in the same afternoon',1),
  ('geogebra','Changing a coefficient should visibly change the curve, not just the numbers',0),
  ('geogebra','Geometry made no sense to me until I could drag the points about',1),
  ('kiwix','The school has computers and no connection worth relying on',0),
  ('kiwix','Three weeks somewhere with no signal and I still want a reference library',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('anki','study',true),('quizlet','study',true),
  ('duolingo','study',true),('duolingo','language',false),
  ('memrise','study',true),('memrise','language',false),
  ('zotero','study',true),('mendeley','study',true),('remnote','study',true),
  ('khan-academy','study',true),('wolframalpha','study',true),
  ('geogebra','study',true),('kiwix','study',true),('kiwix','reading',false)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- health and wellbeing -------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('cronometer','Cronometer','https://cronometer.com',
   'Logs what you eat against a carefully curated food database, including micronutrients.',
   'freemium','{web,ios,android}','{en}','{has_free_tier}'),
  ('myfitnesspal','MyFitnessPal','https://www.myfitnesspal.com',
   'Food and exercise diary with barcode scanning and a very large crowd-sourced food database.',
   'freemium','{ios,android,web}','{en,es,fr,de,pt}','{has_free_tier}'),
  ('strava','Strava','https://www.strava.com',
   'Records runs and rides from a phone or watch and compares them with previous efforts.',
   'freemium','{ios,android,web}','{en,es,fr,de,pt,ja}','{has_free_tier}'),
  ('insight-timer','Insight Timer','https://insighttimer.com',
   'A large library of guided meditations and a plain timer for sitting without guidance.',
   'freemium','{ios,android,web}','{en}','{has_free_tier}'),
  ('medito','Medito','https://meditofoundation.org',
   'Guided meditation and sleep sessions from a non-profit, free with no adverts and no subscription.',
   'free','{ios,android}','{en}','{no_ads,no_account_needed}'),
  ('daylio','Daylio','https://daylio.net',
   'A mood and activity journal you fill in with two taps, which then shows patterns over months.',
   'freemium','{ios,android}','{en,de,es,fr,pt,ru}','{has_free_tier,works_offline}'),
  ('loop-habit-tracker','Loop Habit Tracker','https://loophabits.org',
   'A habit tracker with a score that rewards consistency, entirely offline and advert-free.',
   'open_source','{android}','{en,de,es,fr,pt,ru}','{works_offline,no_account_needed,no_ads}'),
  ('sleep-as-android','Sleep as Android','https://sleep.urbandroid.org',
   'Tracks sleep phases and wakes you in a light phase, with snoring detection and smart alarms.',
   'freemium','{android}','{en,de,es,fr,ru}','{has_free_tier}'),
  ('openfoodfacts','Open Food Facts','https://world.openfoodfacts.org',
   'Scan a barcode and see the ingredients, additives and nutrition of a packaged food, from an open database.',
   'open_source','{web,ios,android}','{en,fr,de,es,it,pt}','{no_ads,exports_data}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('cronometer','My doctor asked about iron and B12 and I have no idea what I actually eat',0),
  ('cronometer','Most food trackers guess the numbers and I need them to be right',1),
  ('myfitnesspal','I eat the same six meals and writing them down should take seconds',0),
  ('myfitnesspal','The packet has a barcode and I am not typing the numbers off the back',1),
  ('strava','Corro sempre o mesmo percurso e não sei se estou a melhorar',0),
  ('strava','Training on my own gets dull with nobody to compare notes with',1),
  ('insight-timer','I sit for twenty minutes and want a bell, not an app talking at me',0),
  ('insight-timer','Some evenings I need somebody''s voice to talk me down',1),
  ('medito','Meditation apps want fifteen pounds a month before they will say a word',0),
  ('medito','I lie awake at two in the morning and need something that is not a podcast',1),
  ('daylio','Writing a journal every night is a commitment I will not keep',0),
  ('daylio','I suspect my mood follows something and I have no way to check',1),
  ('loop-habit-tracker','Missing one day makes me abandon the whole thing',0),
  ('loop-habit-tracker','A habit tracker that phones home about my habits rather defeats the point',1),
  ('sleep-as-android','The alarm always goes off in the deepest part of my sleep',0),
  ('sleep-as-android','I wake up tired and cannot tell what happened in the night',1),
  ('openfoodfacts','The ingredients are in six point type and I am standing in the shop',0),
  ('openfoodfacts','Je veux savoir ce qu''il y a vraiment dans les produits que j''achète',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('cronometer','health',true),('myfitnesspal','health',true),('strava','health',true),
  ('insight-timer','health',true),('medito','health',true),('daylio','health',true),
  ('loop-habit-tracker','health',true),('loop-habit-tracker','focus',false),
  ('sleep-as-android','health',true),('openfoodfacts','health',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- tasks, time and focus ------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('todoist','Todoist','https://todoist.com',
   'A to-do list that understands dates typed in plain language and syncs everywhere.',
   'freemium','{web,ios,android,windows,macos,linux,browser_extension}','{en,es,fr,de,pt,ru,ja}','{has_free_tier}'),
  ('things-3','Things 3','https://culturedcode.com/things',
   'A carefully designed task manager for Apple devices, bought once rather than subscribed to.',
   'paid','{macos,ios}','{en,de,es,fr,ja}','{works_offline}'),
  ('ticktick','TickTick','https://ticktick.com',
   'Tasks, a calendar view, habits and a pomodoro timer in one app.',
   'freemium','{web,ios,android,windows,macos,browser_extension}','{en,zh,es,de,ja}','{has_free_tier}'),
  ('microsoft-todo','Microsoft To Do','https://to-do.office.com',
   'A simple free task list that syncs with Outlook and flagged email.',
   'free','{web,ios,android,windows}','{en,es,fr,de,pt,he,ar}','{has_free_tier}'),
  ('super-productivity','Super Productivity','https://super-productivity.com',
   'An open-source task manager with built-in time tracking that keeps data on your own device.',
   'open_source','{web,windows,macos,linux,android}','{en,de,fr,es,zh}','{works_offline,no_account_needed,exports_data,no_ads}'),
  ('trello','Trello','https://trello.com',
   'Cards on a board moved between columns, for tracking work a small group shares.',
   'freemium','{web,ios,android,macos,windows}','{en,es,pt,fr,de}','{has_free_tier}'),
  ('asana','Asana','https://asana.com',
   'Project and task tracking for teams, with dependencies, timelines and workload views.',
   'freemium','{web,ios,android}','{en,es,fr,de,ja,pt}','{has_free_tier}'),
  ('linear','Linear','https://linear.app',
   'Issue tracking for software teams, built around keyboard speed and short cycles.',
   'freemium','{web,macos,windows,ios,android}','{en}','{has_free_tier}'),
  ('vikunja','Vikunja','https://vikunja.io',
   'A self-hosted to-do and project app with list, gantt and kanban views over the same tasks.',
   'open_source','{self_hosted,web,ios,android}','{en,de,fr,ru}','{exports_data,no_ads}'),
  ('pomofocus','Pomofocus','https://pomofocus.io',
   'A pomodoro timer in a browser tab that counts your work sessions against a task list.',
   'freemium','{web}','{en}','{no_account_needed,has_free_tier}'),
  ('cold-turkey','Cold Turkey Blocker','https://getcoldturkey.com',
   'Blocks sites and applications on a schedule, with a locked mode you genuinely cannot cancel.',
   'freemium','{windows,macos}','{en}','{works_offline,has_free_tier}'),
  ('leechblock','LeechBlock NG','https://www.proginosko.com/leechblock',
   'A browser extension that limits how long and when you can look at named sites.',
   'free','{browser_extension}','{en,de,fr,es}','{works_offline,no_account_needed,no_ads}'),
  ('freedom','Freedom','https://freedom.to',
   'Blocks distracting sites and apps across all your devices at once on a schedule.',
   'free_trial','{windows,macos,ios,android,browser_extension}','{en}','{}'),
  ('toggl-track','Toggl Track','https://toggl.com/track',
   'One-click time tracking with reports of where the week actually went, per client or project.',
   'freemium','{web,ios,android,windows,macos,browser_extension}','{en}','{has_free_tier}'),
  ('clockify','Clockify','https://clockify.me',
   'Time tracking and timesheets for a team, free for an unlimited number of users.',
   'freemium','{web,ios,android,windows,macos,linux}','{en}','{has_free_tier}'),
  ('raycast','Raycast','https://www.raycast.com',
   'A keyboard launcher that runs commands, snippets and extensions without touching the mouse.',
   'freemium','{macos,windows}','{en}','{has_free_tier}'),
  ('alfred','Alfred','https://www.alfredapp.com',
   'A Mac launcher with clipboard history, snippets and scripted workflows behind one hotkey.',
   'freemium','{macos}','{en}','{works_offline,has_free_tier}'),
  ('flameshot','Flameshot','https://flameshot.org',
   'Takes a screenshot and lets you annotate it with arrows and blur before it goes anywhere.',
   'open_source','{linux,windows,macos}','{en,de,fr,es,ru}','{works_offline,no_account_needed,no_ads}'),
  ('sharex','ShareX','https://getsharex.com',
   'Screen capture and recording on Windows with a long list of destinations and after-capture actions.',
   'open_source','{windows}','{en,de,fr,es,ru}','{works_offline,no_account_needed,no_ads}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('todoist','חצי מהמשימות שלי בראש והחצי השני בשלוש אפליקציות שונות',0),
  ('todoist','Typing every second Tuesday and having it just work',1),
  ('todoist','I remember what needs doing at the exact moment I cannot write it down',2),
  ('things-3','Renting my own to-do list by the month has started to grate',0),
  ('things-3','Everything on the list is urgent and none of it is actually planned',1),
  ('ticktick','Tasks, my calendar and a timer live in three apps and none of them agree',0),
  ('ticktick','I need to see what I already committed to before I say yes again',1),
  ('microsoft-todo','Flagged email is my to-do list and it is not working',0),
  ('microsoft-todo','A plain list, costing nothing, that works with the account I already have at work',1),
  ('super-productivity','I have to say how long each task took and I keep guessing at it',0),
  ('super-productivity','My work tasks cannot be stored on a service the client never approved',1),
  ('trello','The team cannot tell what is being worked on and what is waiting',0),
  ('trello','We plan the volunteer rota over text messages and things fall through',1),
  ('asana','This project has forty steps and half cannot start until others finish',0),
  ('asana','Two people are drowning, one has nothing to do, and nobody noticed',1),
  ('linear','Our bug tracker takes six clicks to file one issue',0),
  ('linear','Work drags on for months because nothing ever forces us to close it',1),
  ('vikunja','Project software for a small group should not need a company credit card',0),
  ('vikunja','The same tasks need to be a list one day and a board the next',1),
  ('pomofocus','I sit down to work and forty minutes go past with nothing to show for them',0),
  ('pomofocus','I need something that pushes me to start, not another app to configure',1),
  ('cold-turkey','I close the site and my hands open it again before I notice',0),
  ('cold-turkey','Anything I can turn off, I turn off within about a minute',1),
  ('cold-turkey','The deadline is in three days and my afternoons keep vanishing into forums',2),
  ('leechblock','Ten minutes of news at lunch is fine, ninety minutes is not',0),
  ('leechblock','Only certain sites are the problem, and only between nine and five',1),
  ('freedom','I block a site on the laptop and reach for my phone instead',0),
  ('freedom','Mornings need protecting on every device I own, without me remembering to',1),
  ('toggl-track','A client asks what I did for eight hours and I honestly cannot say',0),
  ('toggl-track','Invoicing from memory means I undercharge every single month',1),
  ('clockify','Timesheets for a team of twelve and the budget for the tool is nothing',0),
  ('clockify','We need to know which project ate the month',1),
  ('raycast','Reaching for the mouse to open an app breaks my train of thought',0),
  ('raycast','The same four steps every morning, done by hand, every morning',1),
  ('alfred','I copy something, copy something else, and lose the first one',0),
  ('alfred','There are five phrases I type twenty times a day',1),
  ('flameshot','A bug report needs an arrow pointing at the actual problem',0),
  ('flameshot','The screenshot has a colleague''s email address sitting in the corner',1),
  ('sharex','Every screenshot means a manual save, a rename and an upload',0),
  ('sharex','I need a short recording of the bug happening, not a description of it',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('todoist','focus',true),('things-3','focus',true),('ticktick','focus',true),
  ('microsoft-todo','focus',true),('super-productivity','focus',true),
  ('trello','focus',true),('asana','focus',true),('linear','focus',true),
  ('linear','developer',false),('vikunja','focus',true),('pomofocus','focus',true),
  ('cold-turkey','focus',true),('leechblock','focus',true),('freedom','focus',true),
  ('toggl-track','focus',true),('clockify','focus',true),('raycast','focus',true),
  ('alfred','focus',true),('flameshot','photos',true),('sharex','photos',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- privacy and security -------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('signal','Signal','https://signal.org',
   'Private messaging and calls, end-to-end encrypted by default, run by a non-profit on donations.',
   'donation','{ios,android,windows,macos,linux}','{en,es,fr,de,ar,he,ru}','{e2e_encrypted,no_ads}'),
  ('bitwarden','Bitwarden','https://bitwarden.com',
   'A password manager with a genuinely usable free tier, syncing across every browser and phone.',
   'freemium','{web,ios,android,windows,macos,linux,browser_extension,cli}','{en,de,es,fr,ja,ru}','{e2e_encrypted,has_free_tier,exports_data}'),
  ('keepassxc','KeePassXC','https://keepassxc.org',
   'Keeps passwords in an encrypted file on your own disk, with no server involved at all.',
   'open_source','{windows,macos,linux,browser_extension}','{en,de,fr,es,ru,ja}','{works_offline,no_account_needed,e2e_encrypted,exports_data}'),
  ('1password','1Password','https://1password.com',
   'A polished password manager with shared vaults for a family or a team and hardware key support.',
   'paid','{web,ios,android,windows,macos,linux,browser_extension,cli}','{en,de,fr,es,it,ja,ru}','{e2e_encrypted,exports_data}'),
  ('proton-mail','Proton Mail','https://proton.me/mail',
   'Encrypted email from Switzerland, with a free tier and calendar and drive alongside it.',
   'freemium','{web,ios,android,windows,macos,linux}','{en,de,fr,es,it,ru}','{e2e_encrypted,has_free_tier}'),
  ('tuta-mail','Tuta Mail','https://tuta.com',
   'Encrypted email that encrypts the subject line and address book too, with a free tier.',
   'freemium','{web,ios,android,windows,macos,linux}','{en,de,fr,es,it,ru}','{e2e_encrypted,has_free_tier}'),
  ('mullvad-vpn','Mullvad VPN','https://mullvad.net',
   'A VPN with a flat monthly price and an account number instead of an email address.',
   'paid','{windows,macos,linux,ios,android}','{en,de,fr,sv}','{no_ads}'),
  ('proton-vpn','Proton VPN','https://protonvpn.com',
   'A VPN with a free tier that has no data cap, from the people who run Proton Mail.',
   'freemium','{windows,macos,linux,ios,android}','{en,de,fr,es,ru}','{has_free_tier,no_ads}'),
  ('ublock-origin','uBlock Origin','https://ublockorigin.com',
   'A content blocker that removes adverts and trackers while using very little memory.',
   'open_source','{browser_extension}','{en,de,fr,es,ru,zh}','{works_offline,no_account_needed,no_ads}'),
  ('tor-browser','Tor Browser','https://www.torproject.org',
   'A browser that routes traffic through the Tor network so sites cannot see where you are.',
   'open_source','{windows,macos,linux,android}','{en,ar,fa,ru,es,fr,he}','{no_account_needed,no_ads}'),
  ('cryptomator','Cryptomator','https://cryptomator.org',
   'Encrypts a folder before it syncs to Dropbox or Drive, so the cloud only ever holds ciphertext.',
   'open_source','{windows,macos,linux,ios,android}','{en,de,fr,es}','{e2e_encrypted,works_offline}'),
  ('veracrypt','VeraCrypt','https://www.veracrypt.fr',
   'Creates encrypted volumes and encrypts whole disks, including hidden volumes.',
   'open_source','{windows,macos,linux}','{en,de,fr,ru,es}','{works_offline,no_account_needed,e2e_encrypted}'),
  ('aegis-authenticator','Aegis Authenticator','https://getaegis.app',
   'Holds two-factor codes in an encrypted vault on the phone, with an export you control.',
   'open_source','{android}','{en,de,fr,es,ru}','{works_offline,no_account_needed,exports_data,no_ads}'),
  ('simplelogin','SimpleLogin','https://simplelogin.io',
   'Gives every site a different email alias that forwards to your real inbox and can be switched off.',
   'freemium','{web,ios,android,browser_extension}','{en,fr}','{has_free_tier}'),
  ('duckduckgo','DuckDuckGo','https://duckduckgo.com',
   'A search engine that does not build a profile of you, with a browser and tracker blocker.',
   'free','{web,ios,android,macos,windows,browser_extension}','{en,de,fr,es,ru,ja}','{no_account_needed}'),
  ('kagi','Kagi Search','https://kagi.com',
   'A paid search engine with no adverts, where you can raise or lower whole domains in your results.',
   'paid','{web,browser_extension}','{en}','{no_ads}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('signal','What I send my family should not be readable by the company carrying it',0),
  ('signal','Mi grupo familiar está en una app que vende nuestros datos y quiero mudarlo',1),
  ('signal','I want to talk to friends without an advertising company listening in',2),
  ('signal','Calls with people abroad that nobody in the middle can sit in on',3),
  ('bitwarden','The same password on thirty sites, and one of them has been breached',0),
  ('bitwarden','Uso a mesma palavra-passe em tudo e sei que isso vai acabar mal',1),
  ('bitwarden','I would like to stop paying for this and not lose anything I use',2),
  ('bitwarden','My partner and I need to share the utility logins without texting them',3),
  ('keepassxc','Any password manager with an account is one breach away from being my problem',0),
  ('keepassxc','My logins should be a file I back up the same way I back up everything else',1),
  ('1password','Our family shares a dozen logins and they are all in a note somewhere',0),
  ('1password','Somebody leaves and their access has to be gone by the end of the day',1),
  ('proton-mail','My email provider reads my mail in order to sell me things',0),
  ('proton-mail','I want off a free inbox without paying for a business plan',1),
  ('tuta-mail','Even the subject lines of my mail say more than I would like',0),
  ('tuta-mail','A private inbox that does not cost anything to start with',1),
  ('mullvad-vpn','Signing up for privacy software should not start with handing over my identity',0),
  ('mullvad-vpn','The cafe wifi is wide open and I do not trust a word of it',1),
  ('proton-vpn','Нужен доступ к сайтам, которые заблокированы там, где я живу',0),
  ('proton-vpn','I need this occasionally and every free one throttles me after a day',1),
  ('ublock-origin','Pages take ten seconds to load because of everything loading alongside them',0),
  ('ublock-origin','My laptop fan spins up on a news site and the blocker I had made it worse',1),
  ('tor-browser','Reading about something sensitive should not follow me around afterwards',0),
  ('tor-browser','The people who talk to me need me not to be traceable back to them',1),
  ('cryptomator','My documents sync to a cloud drive I do not entirely trust',0),
  ('cryptomator','If somebody gets into that account I want them to find noise',1),
  ('veracrypt','If this laptop is stolen, everything on it goes with it',0),
  ('veracrypt','A folder of client records on a USB stick is an accident waiting to happen',1),
  ('aegis-authenticator','My two-factor codes are stuck in an app I cannot get them out of',0),
  ('aegis-authenticator','Losing my phone would lock me out of everything at once',1),
  ('simplelogin','Every shop I buy from sells my address on to three more',0),
  ('simplelogin','I want to switch off whoever leaked my email without changing my email',1),
  ('duckduckgo','I searched for a mattress once and the internet has not stopped shouting since',0),
  ('duckduckgo','Results should not be assembled from a profile of me',1),
  ('kagi','The first screen of results is adverts and content farms',0),
  ('kagi','I would rather pay than be the product, and I want the recipe blogs gone',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('signal','communication',true),('signal','privacy',false),
  ('bitwarden','privacy',true),('keepassxc','privacy',true),('1password','privacy',true),
  ('proton-mail','privacy',true),('proton-mail','communication',false),
  ('tuta-mail','privacy',true),('tuta-mail','communication',false),
  ('mullvad-vpn','privacy',true),('proton-vpn','privacy',true),
  ('ublock-origin','privacy',true),('tor-browser','privacy',true),
  ('cryptomator','privacy',true),('cryptomator','files',false),
  ('veracrypt','privacy',true),('aegis-authenticator','privacy',true),
  ('simplelogin','privacy',true),('duckduckgo','privacy',true),('kagi','privacy',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- developer tools ------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('vscode','Visual Studio Code','https://code.visualstudio.com',
   'A free code editor with an enormous extension ecosystem, debugging and integrated terminal.',
   'free','{windows,macos,linux,web}','{en,de,fr,es,ja,zh,ru}','{works_offline,no_account_needed}'),
  ('neovim','Neovim','https://neovim.io',
   'A modal, keyboard-only editor that runs in a terminal and is configured entirely in code.',
   'open_source','{windows,macos,linux,cli}','{en}','{works_offline,no_account_needed}'),
  ('sublime-text','Sublime Text','https://www.sublimetext.com',
   'A very fast native text editor with multiple cursors and a goto-anything palette.',
   'free_trial','{windows,macos,linux}','{en}','{works_offline}'),
  ('intellij-idea','IntelliJ IDEA','https://www.jetbrains.com/idea',
   'A Java and Kotlin development environment with deep refactoring and a free community edition.',
   'freemium','{windows,macos,linux}','{en,ja,zh,ko}','{has_free_tier}'),
  ('git','Git','https://git-scm.com',
   'Distributed version control: the history of a project, branches, and a way back from any mistake.',
   'open_source','{cli,windows,macos,linux}','{en}','{works_offline,no_account_needed}'),
  ('dbeaver','DBeaver','https://dbeaver.io',
   'A database client that talks to Postgres, MySQL, SQLite and dozens of others from one window.',
   'freemium','{windows,macos,linux}','{en,de,fr,ru,zh,ja}','{has_free_tier}'),
  ('tableplus','TablePlus','https://tableplus.com',
   'A native, quick database client for browsing and editing rows without writing SQL for everything.',
   'freemium','{macos,windows,linux,ios}','{en}','{has_free_tier}'),
  ('postman','Postman','https://www.postman.com',
   'Builds, sends and saves HTTP requests, with collections a team can share and run in CI.',
   'freemium','{web,windows,macos,linux}','{en}','{has_free_tier}'),
  ('insomnia','Insomnia','https://insomnia.rest',
   'An API client for REST and GraphQL requests with environments and a lighter footprint.',
   'freemium','{windows,macos,linux}','{en}','{has_free_tier}'),
  ('httpie','HTTPie','https://httpie.io',
   'Makes HTTP requests from the terminal in a syntax you can read, with coloured JSON output.',
   'open_source','{cli,windows,macos,linux,web}','{en}','{works_offline,no_account_needed}'),
  ('docker-desktop','Docker Desktop','https://www.docker.com/products/docker-desktop',
   'Runs containers on a laptop so a project brings its own database and services with it.',
   'freemium','{windows,macos,linux}','{en}','{has_free_tier}'),
  ('regex101','regex101','https://regex101.com',
   'Tests a regular expression against sample text and explains, token by token, what it matches.',
   'free','{web}','{en}','{no_account_needed}'),
  ('jq','jq','https://jqlang.github.io/jq',
   'Filters and reshapes JSON on the command line, so an API response becomes the three fields you wanted.',
   'open_source','{cli,windows,macos,linux}','{en}','{works_offline,no_account_needed}'),
  ('wireshark','Wireshark','https://www.wireshark.org',
   'Captures and dissects network traffic packet by packet to find out what is actually on the wire.',
   'open_source','{windows,macos,linux}','{en,de,fr,ja,zh}','{works_offline,no_account_needed}'),
  ('beyond-compare','Beyond Compare','https://www.scootersoftware.com',
   'Compares and merges files and whole folders, including across a remote server.',
   'free_trial','{windows,macos,linux}','{en}','{works_offline}'),
  ('sentry','Sentry','https://sentry.io',
   'Collects errors from a running application with the stack trace and the context around each one.',
   'freemium','{web,api}','{en}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('vscode','Работаю с четырьмя языками в неделю и не хочу держать четыре редактора',0),
  ('vscode','Debugging by adding print statements has stopped being funny',1),
  ('neovim','I work over ssh on machines with nothing installed on them',0),
  ('neovim','The moment my hands leave the keyboard my thinking stops',1),
  ('sublime-text','The editor takes eight seconds to open a log file I need to read now',0),
  ('sublime-text','Renaming the same thing in forty places, one at a time',1),
  ('intellij-idea','A large Java codebase and I need to move a class without breaking everything',0),
  ('intellij-idea','I am learning Kotlin and cannot afford a professional licence for it',1),
  ('git','Rompí algo y la última versión que funcionaba fue hace dos horas',0),
  ('git','Two of us edited the same file and now there are two versions of it',1),
  ('git','I want to try something risky without ruining what already works',2),
  ('dbeaver','Three projects, three different databases, three different clients open',0),
  ('dbeaver','I need to look at production data without a developer running the query for me',1),
  ('tableplus','Changing one row should not require writing an update statement',0),
  ('tableplus','My database client takes longer to launch than the query takes to run',1),
  ('postman','The API is documented and I still need to see what it actually returns',0),
  ('postman','Every developer on the team rebuilds the same request from scratch',1),
  ('insomnia','Testing a GraphQL query from a terminal is miserable',0),
  ('insomnia','The same requests need to run against staging and production without editing URLs',1),
  ('httpie','The curl command I need has nine flags and I remember two of them',0),
  ('httpie','The response comes back as one long unreadable line',1),
  ('docker-desktop','It works on my machine and nowhere else',0),
  ('docker-desktop','A new person needs a day and a half before they can run the project at all',1),
  ('regex101','My pattern matches almost everything I want and one thing I do not',0),
  ('regex101','Somebody left a regular expression in this codebase and nobody knows what it does',1),
  ('jq','The API returns four hundred lines and I need three fields out of them',0),
  ('jq','Reshaping JSON in a shell script currently involves a lot of grep and regret',1),
  ('wireshark','The client swears it sent the request and the server swears it never arrived',0),
  ('wireshark','Something on this network is chattering constantly and I do not know what',1),
  ('beyond-compare','Two folders that ought to be identical, and they are not',0),
  ('beyond-compare','I need to see what differs between the copy on the server and the copy here',1),
  ('sentry','Users report crashes with no detail and I cannot reproduce any of them',0),
  ('sentry','Something is failing in production and the log file tells me nothing useful',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('vscode','developer',true),('neovim','developer',true),('sublime-text','developer',true),
  ('intellij-idea','developer',true),('git','developer',true),('dbeaver','developer',true),
  ('tableplus','developer',true),('postman','developer',true),('insomnia','developer',true),
  ('httpie','developer',true),('docker-desktop','developer',true),('regex101','developer',true),
  ('jq','developer',true),('wireshark','developer',true),('beyond-compare','developer',true),
  ('beyond-compare','files',false),('sentry','developer',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- files, syncing and backup --------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('syncthing','Syncthing','https://syncthing.net',
   'Syncs folders directly between your own devices, with no server in the middle and nothing in a cloud.',
   'open_source','{windows,macos,linux,android,self_hosted}','{en,de,fr,es,ru,zh}','{works_offline,no_account_needed,e2e_encrypted}'),
  ('nextcloud','Nextcloud','https://nextcloud.com',
   'A file sync, calendar and contacts server you run yourself, with apps for every platform.',
   'open_source','{self_hosted,web,windows,macos,linux,ios,android}','{en,de,fr,es,it,ru}','{exports_data}'),
  ('dropbox','Dropbox','https://www.dropbox.com',
   'Cloud file sync with sharing links and version history, and a small free tier.',
   'freemium','{web,windows,macos,linux,ios,android}','{en,de,fr,es,ja}','{has_free_tier}'),
  ('google-drive','Google Drive','https://drive.google.com',
   'Cloud storage tied into Docs and Gmail, with sharing and search across your files.',
   'freemium','{web,windows,macos,ios,android}','{en,es,fr,de,pt,ja,he,ar}','{has_free_tier}'),
  ('rclone','rclone','https://rclone.org',
   'Copies and syncs files between local disks and about seventy cloud providers from the command line.',
   'open_source','{cli,windows,macos,linux}','{en}','{works_offline,no_account_needed}'),
  ('restic','restic','https://restic.net',
   'Fast, deduplicating, encrypted backups to local disks or object storage, verified on restore.',
   'open_source','{cli,windows,macos,linux}','{en}','{works_offline,e2e_encrypted,no_account_needed}'),
  ('duplicati','Duplicati','https://www.duplicati.com',
   'Scheduled encrypted backups to cloud storage with a web interface instead of a command line.',
   'open_source','{windows,macos,linux}','{en,de,fr,es}','{e2e_encrypted}'),
  ('backblaze-backup','Backblaze Personal Backup','https://www.backblaze.com/cloud-backup',
   'Unlimited continuous backup of a computer for a flat yearly price, with a posted hard drive restore option.',
   'paid','{windows,macos}','{en}','{}'),
  ('filezilla','FileZilla','https://filezilla-project.org',
   'A long-standing FTP, FTPS and SFTP client for moving files to and from a server.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru}','{works_offline,no_account_needed}'),
  ('seven-zip','7-Zip','https://www.7-zip.org',
   'Creates and opens archives in almost every format, with strong encryption on the archive itself.',
   'open_source','{windows,linux}','{en,de,fr,es,ru,he,ar}','{works_offline,no_account_needed,no_ads}'),
  ('czkawka','Czkawka','https://github.com/qarmin/czkawka',
   'Finds duplicate files, similar images and empty folders so you can reclaim disk space.',
   'open_source','{windows,macos,linux}','{en,de,fr,it,pl}','{works_offline,no_account_needed}'),
  ('localsend','LocalSend','https://localsend.org',
   'Sends files between two devices over the local network, with no internet and no account.',
   'open_source','{windows,macos,linux,ios,android}','{en,de,fr,es,ru,zh}','{works_offline,no_account_needed,no_ads}'),
  ('everything-search','Everything','https://www.voidtools.com',
   'Finds any file on a Windows machine by name almost instantly, using the filesystem index directly.',
   'free','{windows}','{en,de,fr,es,ru,zh}','{works_offline,no_account_needed,no_ads}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('syncthing','The same folder needs to be on my laptop and my desktop with nothing in between',0),
  ('syncthing','I pay for cloud storage purely to move files between my own machines',1),
  ('syncthing','Photos should come off the phone automatically onto the computer at home',2),
  ('nextcloud','Our small charity cannot put client files on somebody else''s cloud',0),
  ('nextcloud','Notre association veut ses fichiers et son agenda sur son propre serveur',1),
  ('nextcloud','Calendar, contacts and files all live with three different companies',2),
  ('dropbox','מחקתי גרסה בטעות ושמרתי מעליה לפני שעה',0),
  ('dropbox','Sending a two gigabyte file by email is never going to work',1),
  ('google-drive','I need the document I wrote at home while I am at my mother''s house',0),
  ('google-drive','The attachment I want is in an email from two years ago somewhere',1),
  ('rclone','Moving twenty years of files between two cloud providers by hand is not happening',0),
  ('rclone','A nightly copy to storage has to run without anybody clicking anything',1),
  ('restic','Backups I have never tested are not really backups',0),
  ('restic','The backup drive lives at my brother''s house and I do not want him reading it',1),
  ('duplicati','I want backups on a schedule without learning a command line',0),
  ('duplicati','Backing up to cheap storage, scrambled before it leaves the house',1),
  ('backblaze-backup','A laptop with everything on it and no copy of any of it anywhere',0),
  ('backblaze-backup','If the disk dies I need the files back, not a support ticket',1),
  ('filezilla','The web host gave me an FTP address and nothing else',0),
  ('filezilla','Uploading a folder to a server, one connection, nothing clever',1),
  ('seven-zip','Somebody sent me an archive in a format nothing on this machine will open',0),
  ('seven-zip','Twenty files need to travel as one, with a password on them',1),
  ('czkawka','The disk is full of the same photos copied three times over the years',0),
  ('czkawka','There are near-identical shots of the same thing and only one is worth keeping',1),
  ('localsend','Sending a video from my phone to my laptop should not go round the internet',0),
  ('localsend','Two laptops in the same room and no cable that fits either of them',1),
  ('everything-search','Windows search takes two minutes to find a file whose name I can tell you',0),
  ('everything-search','I know it is called something with invoice in it and that is all I know',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('syncthing','files',true),('syncthing','privacy',false),
  ('nextcloud','files',true),('dropbox','files',true),('google-drive','files',true),
  ('rclone','files',true),('restic','files',true),('duplicati','files',true),
  ('backblaze-backup','files',true),('filezilla','files',true),('seven-zip','files',true),
  ('czkawka','files',true),('localsend','files',true),('everything-search','files',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- documents, PDFs and paperwork ----------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('stirling-pdf','Stirling PDF','https://www.stirlingpdf.com',
   'Dozens of PDF operations - merge, split, rotate, OCR, compress - running on a server you host yourself.',
   'open_source','{self_hosted,web}','{en,de,fr,es,ar}','{exports_data}'),
  ('pdf24','PDF24 Tools','https://tools.pdf24.org',
   'A free set of PDF tools in the browser and a Windows program, with no account required.',
   'free','{web,windows}','{en,de,fr,es,it}','{no_account_needed}'),
  ('ilovepdf','iLovePDF','https://www.ilovepdf.com',
   'Merges, splits, compresses and converts PDFs in the browser, with a limited free tier.',
   'freemium','{web,ios,android,windows}','{en,es,fr,de,pt,ar}','{has_free_tier}'),
  ('adobe-acrobat','Adobe Acrobat','https://www.adobe.com/acrobat.html',
   'The reference PDF editor, for editing text in a PDF, filling forms and signing documents.',
   'freemium','{web,windows,macos,ios,android}','{en,de,fr,es,ja}','{has_free_tier}'),
  ('pdfsam-basic','PDFsam Basic','https://pdfsam.org',
   'Splits, merges, rotates and extracts pages from PDFs entirely on your own machine.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,it}','{works_offline,no_account_needed}'),
  ('docuseal','DocuSeal','https://www.docuseal.com',
   'Open-source document signing with forms and signing links, hostable on your own server.',
   'open_source','{web,self_hosted}','{en,de,fr,es}','{has_free_tier}'),
  ('docusign','DocuSign','https://www.docusign.com',
   'Sends a document for signature and tracks who has signed it, with an audit trail.',
   'freemium','{web,ios,android}','{en,de,fr,es,ja}','{has_free_tier}'),
  ('paperless-ngx','Paperless-ngx','https://docs.paperless-ngx.com',
   'Scans, OCRs and tags paper documents into a searchable archive you run at home.',
   'open_source','{self_hosted,web}','{en,de,fr,es,it,nl}','{exports_data}'),
  ('tesseract-ocr','Tesseract OCR','https://tesseract-ocr.github.io',
   'Turns an image of text into text, on your own machine, in over a hundred languages.',
   'open_source','{cli,windows,macos,linux}','{en,de,fr,es,ru,ar,he}','{works_offline,no_account_needed}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('stirling-pdf','The free PDF sites want my documents uploaded, and these are confidential',0),
  ('stirling-pdf','Merging, rotating and shrinking PDFs comes up weekly across the whole office',1),
  ('pdf24','One PDF job, right now, without registering for anything',0),
  ('pdf24','The scanned pages came out upside down and in the wrong order',1),
  ('ilovepdf','The upload form refuses anything over five megabytes and mine is twelve',0),
  ('ilovepdf','Three documents have to become one before I can send them',1),
  ('adobe-acrobat','There is a typo in a PDF and nobody can find the file it came from',0),
  ('adobe-acrobat','The form has proper fields and only one thing seems to fill them properly',1),
  ('pdfsam-basic','A two hundred page scan needs splitting up and it must not leave this laptop',0),
  ('pdfsam-basic','I need pages four to eleven out of a document and nothing else',1),
  ('docuseal','Sending contracts through a signing service costs us more than the accountant',0),
  ('docuseal','Client agreements have to be signed without their details crossing to a third party',1),
  ('docusign','The lease needs signatures from four people in three countries by Friday',0),
  ('docusign','I need proof of who signed and when, not just a signed file',1),
  ('paperless-ngx','Ten years of bank letters in a drawer and I need exactly one of them',0),
  ('paperless-ngx','The tax return wants a receipt I know I kept somewhere',1),
  ('tesseract-ocr','A scanned book I cannot search or copy a single word out of',0),
  ('tesseract-ocr','لدي مستندات ممسوحة ضوئيا ولا أستطيع البحث في نصها',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('stirling-pdf','documents',true),('pdf24','documents',true),('ilovepdf','documents',true),
  ('adobe-acrobat','documents',true),('pdfsam-basic','documents',true),
  ('docuseal','documents',true),('docusign','documents',true),
  ('paperless-ngx','documents',true),('paperless-ngx','files',false),
  ('tesseract-ocr','documents',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- home and household ---------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('bring','Bring! Shopping List','https://www.getbring.com',
   'A shared shopping list with pictures for each item, so a household adds things without typing.',
   'freemium','{ios,android,web}','{en,de,fr,it,es,nl}','{has_free_tier}'),
  ('anylist','AnyList','https://www.anylist.com',
   'Shared grocery lists organised by aisle, with recipes and a meal plan attached to them.',
   'freemium','{ios,android,web}','{en}','{has_free_tier}'),
  ('grocy','Grocy','https://grocy.info',
   'Tracks what is in your fridge and cupboards, what is about to expire and what to buy.',
   'open_source','{self_hosted,web}','{en,de,fr,nl,es}','{exports_data}'),
  ('home-assistant','Home Assistant','https://www.home-assistant.io',
   'Runs the smart devices in a house locally, so lights and sensors keep working with no internet.',
   'open_source','{self_hosted,web,ios,android}','{en,de,fr,es,nl,ru}','{works_offline,exports_data,no_ads}'),
  ('paprika','Paprika Recipe Manager','https://www.paprikaapp.com',
   'Saves recipes from any website, strips the life story, and builds a shopping list from them.',
   'paid','{ios,android,macos,windows}','{en}','{works_offline}'),
  ('mealie','Mealie','https://mealie.io',
   'A self-hosted recipe book and meal planner that imports recipes from a URL.',
   'open_source','{self_hosted,web}','{en,de,fr,es,it}','{exports_data}'),
  ('tody','Tody','https://todyapp.com',
   'Tracks household cleaning by how long it has been since each job was last done.',
   'freemium','{ios,android}','{en,de,fr,es}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('bring','My partner adds things to the list while I am already standing in the shop',0),
  ('bring','אני אף פעם לא זוכר מה חסר בבית עד שאני חוזר בלי זה',1),
  ('anylist','I walk past the same aisle three times because the list is in the wrong order',0),
  ('anylist','The recipe needs seven things and I am writing them out by hand again',1),
  ('grocy','Half a fridge of food goes in the bin every month',0),
  ('grocy','I buy more pasta because I cannot remember whether we have any',1),
  ('home-assistant','Every smart device I own answers to a different app and a different company',0),
  ('home-assistant','The service behind my thermostat shut down and took the thermostat with it',1),
  ('paprika','The recipe is buried under two thousand words about somebody''s grandmother',0),
  ('paprika','I plan the week''s meals and then write the shopping out all over again',1),
  ('mealie','The recipe sites I rely on keep disappearing behind paywalls',0),
  ('mealie','Our family recipes are on paper, in a chat, and in three bookmarks',1),
  ('tody','Nobody knows when the bathroom was last properly cleaned',0),
  ('tody','A cleaning rota with fixed days collapses in the first busy week',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('bring','home',true),('anylist','home',true),('grocy','home',true),
  ('home-assistant','home',true),('paprika','home',true),('mealie','home',true),
  ('tody','home',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- accessibility --------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('nvda','NVDA','https://www.nvaccess.org',
   'A free screen reader for Windows that speaks what is on screen and drives a braille display.',
   'open_source','{windows}','{en,de,fr,es,ru,ar,he}','{works_offline,no_account_needed,accessible}'),
  ('be-my-eyes','Be My Eyes','https://www.bemyeyes.com',
   'Connects a blind or low-vision person to a sighted volunteer on a video call, free, in minutes.',
   'free','{ios,android}','{en,es,fr,de,ar,he}','{accessible,no_ads}'),
  ('seeing-ai','Seeing AI','https://www.seeingai.com',
   'Describes what the phone camera sees aloud: text, documents, currency, people and scenes.',
   'free','{ios,android}','{en,es,fr,de,ja}','{accessible,no_ads}'),
  ('color-oracle','Color Oracle','https://colororacle.org',
   'Shows your whole screen as someone with colour blindness sees it, in real time.',
   'free','{windows,macos,linux}','{en}','{works_offline,no_account_needed,accessible}'),
  ('axe-devtools','axe DevTools','https://www.deque.com/axe',
   'Finds accessibility problems in a web page from inside the browser developer tools.',
   'freemium','{browser_extension,web}','{en}','{accessible,has_free_tier}'),
  ('wave-webaim','WAVE','https://wave.webaim.org',
   'Marks up a web page with its accessibility errors, contrast failures and heading structure.',
   'free','{web,browser_extension}','{en}','{accessible,no_account_needed}'),
  ('opendyslexic','OpenDyslexic','https://opendyslexic.org',
   'A free typeface with weighted bottoms, made to make letters harder to flip while reading.',
   'open_source','{windows,macos,linux,browser_extension}','{en}','{works_offline,no_account_needed,accessible}'),
  ('speechify','Speechify','https://speechify.com',
   'Reads documents, web pages and PDFs aloud in a natural voice at whatever speed you want.',
   'freemium','{ios,android,web,browser_extension,macos}','{en,es,fr,de,pt}','{accessible,has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('nvda','אני לא רואה את המסך ותוכנת ההקראה עולה יותר מהמחשב עצמו',0),
  ('nvda','A blind colleague has to use the same Windows machine as everybody else',1),
  ('be-my-eyes','I cannot read the date on this tin and there is nobody else in the house',0),
  ('be-my-eyes','Small everyday things need one pair of eyes for about thirty seconds',1),
  ('seeing-ai','The letter that arrived is printed and I cannot read print',0),
  ('seeing-ai','I want to know who just walked in and what that sign says',1),
  ('color-oracle','The chart I made is red and green and I cannot tell how bad that is',0),
  ('color-oracle','Our status colours may be meaningless to a tenth of the people using them',1),
  ('axe-devtools','The site probably breaks accessibility rules and I do not know which ones',0),
  ('axe-devtools','Catching this after launch costs ten times what catching it now would',1),
  ('wave-webaim','Somebody said our headings are wrong and I cannot see what they mean',0),
  ('wave-webaim','The contrast on our buttons may be failing and I need something to point at',1),
  ('opendyslexic','Letters swap places while I read and I keep losing the line',0),
  ('opendyslexic','My son gives up on reading after about two paragraphs',1),
  ('speechify','There are forty pages to get through today and my eyes are done',0),
  ('speechify','I take more in by listening than by reading, and always have',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('nvda','accessibility',true),('be-my-eyes','accessibility',true),
  ('seeing-ai','accessibility',true),('color-oracle','accessibility',true),
  ('axe-devtools','accessibility',true),('axe-devtools','developer',false),
  ('wave-webaim','accessibility',true),('opendyslexic','accessibility',true),
  ('speechify','accessibility',true),('speechify','reading',false)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- communication --------------------------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('slack','Slack','https://slack.com',
   'Team chat in channels with threads, search and a very large set of integrations.',
   'freemium','{web,windows,macos,linux,ios,android}','{en,es,fr,de,ja,pt}','{has_free_tier}'),
  ('discord','Discord','https://discord.com',
   'Voice, video and text servers for communities, originally for gaming and now for everything.',
   'freemium','{web,windows,macos,linux,ios,android}','{en,es,fr,de,ja,ru}','{has_free_tier}'),
  ('telegram','Telegram','https://telegram.org',
   'Messaging with very large groups, channels and file sending, syncing across every device.',
   'free','{ios,android,web,windows,macos,linux}','{en,es,ru,de,ar,fa}','{has_free_tier}'),
  ('element','Element','https://element.io',
   'A Matrix client for encrypted team chat that can run on your own server and federate.',
   'freemium','{web,windows,macos,linux,ios,android}','{en,de,fr,es,ru}','{e2e_encrypted,has_free_tier}'),
  ('jitsi-meet','Jitsi Meet','https://meet.jit.si',
   'Video calls in a browser with no account and no install, hostable on your own server.',
   'open_source','{web,ios,android,self_hosted}','{en,de,fr,es,ru,ar}','{no_account_needed,no_ads}'),
  ('zoom','Zoom','https://zoom.us',
   'Video meetings and webinars with recording, breakout rooms and a forty minute free tier.',
   'freemium','{web,windows,macos,linux,ios,android}','{en,es,fr,de,ja,zh}','{has_free_tier}'),
  ('thunderbird','Thunderbird','https://www.thunderbird.net',
   'A desktop email client for several accounts at once, with calendar, free and donation funded.',
   'donation','{windows,macos,linux,android}','{en,de,fr,es,ru,he,ar}','{works_offline,no_account_needed,exports_data,no_ads}'),
  ('fastmail','Fastmail','https://www.fastmail.com',
   'Paid email with your own domain, strong search and no advertising, with a trial to start.',
   'free_trial','{web,ios,android}','{en}','{exports_data,no_ads}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('slack','Decisions get made in a chat that nobody can search afterwards',0),
  ('slack','Email threads with nine people on them are unmanageable',1),
  ('discord','Our group needs voice and text in the same place, all evening, for nothing',0),
  ('discord','A community of two thousand people cannot live in a group chat',1),
  ('telegram','A group of four hundred parents and most apps will not hold them',0),
  ('telegram','Нужно отправить большой файл, который не проходит по почте',1),
  ('element','Our organisation needs its chat running on its own servers',0),
  ('element','Two teams at different companies need one shared room without joining each other''s tools',1),
  ('jitsi-meet','The person I need to call will not install anything or make an account',0),
  ('jitsi-meet','A quick video call with somebody who has a browser and nothing else',1),
  ('zoom','Thirty people on one call and half of them need to be in small groups',0),
  ('zoom','Le cours doit être enregistré pour ceux qui n''ont pas pu venir',1),
  ('thunderbird','Quatre comptes de messagerie et quatre onglets ouverts toute la journée',0),
  ('thunderbird','My mail should live on my computer, not only on somebody''s web page',1),
  ('fastmail','I want mail at my own domain without running a mail server myself',0),
  ('fastmail','Free email costs nothing and shows me adverts all day long',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('slack','communication',true),('discord','communication',true),
  ('telegram','communication',true),('element','communication',true),
  ('jitsi-meet','communication',true),('zoom','communication',true),
  ('thunderbird','communication',true),('fastmail','communication',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- reading, feeds and saving things -------------------------------------
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('wallabag','wallabag','https://wallabag.org',
   'Saves articles to read later and keeps the text itself, self-hosted or on a small paid instance.',
   'freemium','{self_hosted,web,ios,android}','{en,de,fr,es,it}','{exports_data,has_free_tier}'),
  ('raindrop-io','Raindrop.io','https://raindrop.io',
   'Bookmarks with tags, full-text search and previews, shared into collections with other people.',
   'freemium','{web,ios,android,windows,macos,browser_extension}','{en,ru,de,fr,es}','{has_free_tier}'),
  ('readwise','Readwise','https://readwise.io',
   'Collects highlights from books and articles and shows a few back to you every day.',
   'free_trial','{web,ios,android,browser_extension}','{en}','{exports_data}'),
  ('instapaper','Instapaper','https://www.instapaper.com',
   'Strips a web page down to its text and keeps it for reading later, on a phone or an e-reader.',
   'freemium','{web,ios,android,browser_extension}','{en}','{has_free_tier}'),
  ('calibre','calibre','https://calibre-ebook.com',
   'Manages an ebook library, converts between formats and sends books to an e-reader.',
   'open_source','{windows,macos,linux}','{en,de,fr,es,ru,ja,he}','{works_offline,no_account_needed,exports_data}'),
  ('koreader','KOReader','https://koreader.rocks',
   'A document reader for e-ink devices with fine typography control and dictionary lookup.',
   'open_source','{android,linux}','{en,de,fr,es,ru,he,ar}','{works_offline,no_account_needed,no_ads}'),
  ('freshrss','FreshRSS','https://freshrss.org',
   'A self-hosted feed reader that follows websites without an algorithm deciding what you see.',
   'open_source','{self_hosted,web}','{en,fr,de,es,ru}','{exports_data,no_ads}'),
  ('miniflux','Miniflux','https://miniflux.app',
   'A deliberately minimal self-hosted RSS reader, one binary and a database, no JavaScript needed.',
   'open_source','{self_hosted,web}','{en,fr,de}','{exports_data,no_ads}'),
  ('feedly','Feedly','https://feedly.com',
   'A hosted feed reader for following a lot of publications in one place.',
   'freemium','{web,ios,android}','{en}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('wallabag','The article I saved last year has been taken down',0),
  ('wallabag','Read-it-later services keep shutting and taking my list with them',1),
  ('raindrop-io','Six thousand bookmarks and no way to find one of them',0),
  ('raindrop-io','We are planning a trip and want to collect the links together',1),
  ('readwise','I highlight books and then never look at the highlights again',0),
  ('readwise','Whatever I read carefully is gone from my head within a month',1),
  ('instapaper','Articles I want to read arrive at exactly the wrong moment',0),
  ('instapaper','The page is a wall of pop-ups with an article somewhere behind it',1),
  ('calibre','Мои книги в формате, который читалка отказывается открывать',0),
  ('calibre','Two thousand books with no covers, no authors and no order to them',1),
  ('koreader','The reader''s own software gives me three font sizes and no other control',0),
  ('koreader','I read in a language I am still learning and need a dictionary in the same tap',1),
  ('freshrss','I follow thirty sites and something else decides which ones I see',0),
  ('freshrss','I want to read what I chose to read, in the order it was published',1),
  ('miniflux','Feed readers have become heavy web apps and I only want the headlines',0),
  ('miniflux','One small program on a cheap server is all this should ever take',1),
  ('feedly','News arrives from forty places and I check about nine of them',0),
  ('feedly','I need to follow an industry without living on social media',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('wallabag','reading',true),('raindrop-io','reading',true),('readwise','reading',true),
  ('readwise','study',false),('instapaper','reading',true),('calibre','reading',true),
  ('koreader','reading',true),('freshrss','reading',true),('miniflux','reading',true),
  ('feedly','reading',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- --- language and translation ---------------------------------------------
-- Several of these exist mainly for people who are not reading in English,
-- which is the point: the golden set carries queries in Hebrew, Arabic,
-- Spanish, French, Russian and Portuguese, and they have to have somewhere
-- correct to land.
insert into public.tools
  (slug, name, url, summary, pricing, platforms, languages, flags, status,
   claimable, submitted_by, owner_id, made_by_owner, published_at)
select v.slug, v.name, v.url, v.summary, v.pricing::pricing_model,
       v.platforms::platform[], v.languages::text[], v.flags::tool_flag[],
       'published', true, 'dev_admin', null, false,
       now() - make_interval(days => (('x' || substr(md5(v.slug), 1, 7))::bit(28)::int % 400) + 1)
from (values
  ('deepl','DeepL Translator','https://www.deepl.com',
   'Machine translation that reads more naturally than most, with document translation and a glossary.',
   'freemium','{web,windows,macos,ios,android,browser_extension,api}','{en,de,fr,es,ja,zh,pt,ru}','{has_free_tier}'),
  ('libretranslate','LibreTranslate','https://libretranslate.com',
   'An open-source translation service you can run yourself, so the text never leaves your network.',
   'open_source','{web,self_hosted,api}','{en,es,fr,de,ar,ru}','{no_account_needed}'),
  ('reverso','Reverso','https://www.reverso.net',
   'Translation shown with real example sentences from books and subtitles, plus conjugation tables.',
   'freemium','{web,ios,android,browser_extension}','{en,fr,es,de,it,ru,ar,he}','{has_free_tier}'),
  ('wordreference','WordReference','https://www.wordreference.com',
   'Bilingual dictionaries with forum threads arguing about the awkward cases, which is where the answer usually is.',
   'free','{web,ios,android}','{en,es,fr,it,pt,de}','{no_account_needed}'),
  ('morfix','Morfix','https://www.morfix.co.il',
   'מילון עברי-אנגלי. A Hebrew-English dictionary with inflections, common phrases and pronunciation.',
   'freemium','{web,ios,android}','{he,en}','{has_free_tier}'),
  ('dicta-nakdan','Dicta Nakdan','https://nakdanpro.dicta.org.il',
   'ניקוד אוטומטי לטקסט עברי. Adds Hebrew vowel points to unpointed text automatically, free in the browser.',
   'free','{web}','{he}','{no_account_needed,no_ads}'),
  ('almaany','Almaany','https://www.almaany.com',
   'قاموس عربي. An Arabic dictionary and thesaurus with translations into English and several other languages.',
   'free','{web,ios,android}','{ar,en}','{no_account_needed}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('deepl','The translation is grammatically fine and no human being would say it',0),
  ('deepl','Je dois écrire à un client en allemand et mon niveau n''y suffit pas',1),
  ('deepl','A whole contract needs translating and the layout has to survive it',2),
  ('libretranslate','Our documents cannot be pasted into a public translation site',0),
  ('libretranslate','Translating text inside our own product without paying by the word',1),
  ('reverso','I know the word and not how anybody actually uses it',0),
  ('reverso','Verb endings in French have defeated me for years',1),
  ('wordreference','The dictionary gives me four words and no idea which one fits here',0),
  ('wordreference','Hay expresiones que ningún diccionario explica del todo bien',1),
  ('morfix','אני קורא טקסט בעברית ונתקל במילים שאני לא מכיר',0),
  ('morfix','I read Hebrew slowly and stop at every unfamiliar word',1),
  ('morfix','Hebrew words change shape and I cannot work out the root to look up',2),
  ('dicta-nakdan','אני מכין דף קריאה לילדים והם עדיין צריכים ניקוד',0),
  ('dicta-nakdan','Hebrew without vowel points is hard for a learner to read aloud',1),
  ('almaany','أقرأ نصوصا عربية وأحتاج معنى الكلمات ومرادفاتها',0),
  ('almaany','I am learning Arabic and need more than a one word translation',1)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
on conflict do nothing;

insert into public.tool_categories (tool_id, category_id, is_primary)
select t.id, c.id, m.is_primary
from public.tools t
join (values
  ('deepl','language',true),('libretranslate','language',true),('reverso','language',true),
  ('wordreference','language',true),('morfix','language',true),
  ('dicta-nakdan','language',true),('almaany','language',true)
) as m(tool_slug, cat_slug, is_primary) on m.tool_slug = t.slug::text
join public.categories c on c.slug::text = m.cat_slug
on conflict do nothing;

-- ===========================================================================
-- A few reviews, likes and collections, so the app has something to render.
-- ===========================================================================
insert into public.reviews (tool_id, author_id, rating, solved_problem, ease_of_use, body)
select t.id, r.author, r.rating, r.solved, r.ease, r.body
from public.tools t
join (values
  ('tabsplit', 'dev_person', 5, true,  5, 'Used it for a week in Greece with six people. Nobody argued once.'),
  ('tabsplit', 'dev_maker',  4, true,  4, 'Fine for recurring bills. The free tier stops at ten people.'),
  ('receiptly','dev_person', 4, true,  3, 'Scanning is quick, the splitting screen takes a moment to learn.'),
  ('quietroom','dev_person', 5, true,  5, 'Saved a recording I thought was ruined.'),
  ('splitwise','dev_person', 5, true,  5, 'The default answer for this. Everyone already has it, which is half the battle.'),
  ('obsidian', 'dev_admin',  5, true,  4, 'Files on disk. That is the whole reason, and it is a good one.'),
  ('anki',     'dev_maker',  4, true,  2, 'Works. The interface is from another decade and I do not care.'),
  ('signal',   'dev_admin',  5, true,  5, 'Boring in the way security should be.')
) as r(slug, author, rating, solved, ease, body) on r.slug = t.slug::text
on conflict do nothing;

insert into public.tool_likes (user_id, tool_id)
select u.id, t.id
from public.tools t
join (values
  ('tabsplit','dev_person'), ('tabsplit','dev_maker'),
  ('quietroom','dev_person'), ('draftbin','dev_person'), ('cupboard','dev_person'),
  ('splitwise','dev_person'), ('splitwise','dev_maker'), ('splitwise','dev_admin'),
  ('obsidian','dev_admin'), ('obsidian','dev_person'),
  ('signal','dev_admin'), ('signal','dev_maker'), ('signal','dev_person'),
  ('anki','dev_maker'), ('vlc','dev_person'), ('audacity','dev_admin'),
  ('keepassxc','dev_admin'), ('organic-maps','dev_person'), ('syncthing','dev_admin')
) as l(slug, user_id) on l.slug = t.slug::text
join public.profiles u on u.id = l.user_id
on conflict do nothing;

-- One shared collection and one private one. `is_public` is no longer a
-- permission by itself: 0013_accounts.sql made a shared collection readable
-- only by somebody holding its 128-bit token, and added a CHECK that the flag
-- and the token agree, so a row that says public and carries no token is now
-- refused. The literal below is an invented development value in a tracked
-- file on purpose — it is the address of two made-up collections of real
-- public tools, in a throwaway database, and /c/<token> needs something to
-- render.
insert into public.collections (owner_id, name, slug, description, is_public, share_token) values
  ('dev_person', 'Trip to Greece', 'trip-to-greece', 'Everything we used in June.', true,
   '0f1e2d3c4b5a69788796a5b4c3d2e1f0'),
  ('dev_person', 'Quiet mornings', 'quiet-mornings', null, false, null)
on conflict do nothing;

insert into public.collection_items (collection_id, tool_id, sort_order)
select c.id, t.id, row_number() over ()
from public.collections c
join public.tools t on t.slug::text in ('tabsplit', 'receiptly', 'splitwise', 'organic-maps')
where c.slug::text = 'trip-to-greece'
on conflict do nothing;

commit;
