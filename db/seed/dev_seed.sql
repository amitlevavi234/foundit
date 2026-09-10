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
  ('tabsplit',  'Split a holiday''s costs across a group of friends', 0),
  ('tabsplit',  'Work out who owes what after a trip', 1),
  ('tabsplit',  'Keep a running tab with a partner without arguing about it', 2),
  ('tabsplit',  'Settle up in a currency that is not my own', 3),
  ('receiptly', 'Split a restaurant bill when everyone ordered different things', 0),
  ('receiptly', 'Track who paid for what in a shared flat', 1),
  ('receiptly', 'Scan receipts without typing the numbers in by hand', 2),
  ('quietroom', 'Remove background noise from a voice recording', 0),
  ('quietroom', 'Clean up an interview recorded in a noisy cafe', 1),
  ('quietroom', 'Fix a podcast recording with too much room echo', 2),
  ('paperfold', 'Sign a PDF on my phone without paying', 0),
  ('paperfold', 'Fill in a form someone emailed me and send it back', 1),
  ('cupboard',  'Keep a shared grocery list that works offline', 0),
  ('cupboard',  'Stop buying milk twice because nobody checked the list', 1),
  ('cupboard',  'Share chores in a flat without a group chat', 2),
  ('deepwork',  'Block distracting websites during work hours', 0),
  ('deepwork',  'Stop myself opening the same site fifty times a day', 1),
  ('draftbin',  'Take notes that I can still read in ten years', 0),
  ('draftbin',  'Write without my notes living on somebody else''s computer', 1),
  ('draftbin',  'Keep a journal that nobody else can read', 2),
  ('lensbox',   'Back up photos without Google or Apple', 0),
  ('lensbox',   'Get my photos off my phone onto a drive at home', 1),
  ('speakback', 'Turn a long meeting recording into notes', 0),
  ('speakback', 'Remember what was decided in a meeting I half-attended', 1)
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
   'freemium','{web,ios,android}','{en,es,fr,de,pt}','{has_free_tier}'),
  ('tricount','Tricount','https://www.tricount.com',
   'Shared expense tracker for a trip or a flatshare, built around one list per group rather than one per friendship.',
   'freemium','{ios,android,web}','{en,fr,de,es,it,nl}','{has_free_tier}'),
  ('settle-up','Settle Up','https://settleup.io',
   'Group expense splitting with multiple currencies and a running balance per person.',
   'freemium','{ios,android,web}','{en,cs,de,es}','{has_free_tier}'),
  ('splid','Splid','https://splid.app',
   'Splits group costs without anyone having to make an account, which matters when half the group will never install anything.',
   'free','{ios,android,web}','{en,de}','{no_account_needed}'),
  ('ynab','YNAB','https://www.ynab.com',
   'Zero-based budgeting: every unit of money you have gets assigned a job before you spend it.',
   'free_trial','{web,ios,android}','{en}','{exports_data}'),
  ('actual-budget','Actual Budget','https://actualbudget.org',
   'Local-first envelope budgeting you can run on your own machine, with your data staying in a file you hold.',
   'open_source','{web,self_hosted,windows,macos,linux}','{en,de,fr,es,pt}','{works_offline,exports_data,no_ads}'),
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
  ('splitwise','Split expenses with friends and see who owes who at the end',0),
  ('splitwise','Share the cost of a holiday flat between several people',1),
  ('splitwise','Keep track of money lent to a housemate without a spreadsheet',2),
  ('splitwise','Split a restaurant bill with friends who each paid for different things',3),
  ('tricount','Share travel costs in a group where different people paid for different bits',0),
  ('tricount','Work out who owes what after a weekend away',1),
  ('tricount','Keep one shared list of what the trip cost so far',2),
  ('settle-up','Split group costs when people paid in different currencies',0),
  ('settle-up','See a running balance of what each friend owes the group',1),
  ('splid','Split costs with a group where nobody wants to sign up for anything',0),
  ('splid','Track shared holiday spending without making an account',1),
  ('ynab','Stop reaching the end of the month with no idea where the money went',0),
  ('ynab','Give every pound a job before I spend it',1),
  ('ynab','Save up for an annual bill a little each month',2),
  ('actual-budget','Budget my money without handing my bank data to a company',0),
  ('actual-budget','Run my household budget on my own computer',1),
  ('actual-budget','Keep my finances in a file I control rather than someone''s cloud',2),
  ('firefly-iii','Host my own personal finance tracker on a server I run',0),
  ('firefly-iii','See where my salary actually goes each month',1),
  ('gnucash','Keep proper double-entry books for a tiny business',0),
  ('gnucash','Do my accounts on a laptop with no internet',1),
  ('moneymanagerex','Track spending in a simple desktop app with no subscription',0),
  ('moneymanagerex','Keep years of transactions in one local file',1),
  ('monarch-money','See all my bank accounts and cards in one place',0),
  ('monarch-money','Share a household budget with my partner',1),
  ('wise','Send money abroad without losing a chunk to the exchange rate',0),
  ('wise','Hold money in another currency before a trip',1),
  ('revolut','Spend abroad without my bank charging me for every card tap',0),
  ('revolut','Swap currencies on my phone while travelling',1)
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
  ('rome2rio','Work out how to get between two cities without a direct flight',0),
  ('rome2rio','Compare train, bus and plane for the same journey',1),
  ('skyscanner','Find the cheapest month to fly somewhere',0),
  ('skyscanner','Compare flight prices across airlines in one search',1),
  ('skyscanner','Go anywhere cheap next weekend without a fixed destination',2),
  ('google-flights','See which day of the week is cheapest to fly',0),
  ('google-flights','Watch a flight price and get told when it drops',1),
  ('tripit','Keep flight, hotel and train bookings in one itinerary',0),
  ('tripit','Stop digging through email for a booking reference at the airport',1),
  ('wanderlog','Plan a two week trip day by day with a friend',0),
  ('wanderlog','Collect places I want to visit onto one map',1),
  ('organic-maps','Navigate a foreign city with no mobile data',0),
  ('organic-maps','Use maps abroad without paying roaming charges',1),
  ('organic-maps','Find my way around without being tracked',2),
  ('osmand','Download maps before a hike where there is no signal',0),
  ('osmand','Follow a walking route offline in the mountains',1),
  ('polarsteps','Keep a travel diary of a long trip to show people later',0),
  ('polarsteps','Let family follow where I am on a long journey',1),
  ('hostelworld','Find a cheap bed in a city I arrive in tomorrow',0),
  ('hostelworld','Book somewhere to sleep that is not a hotel',1),
  ('airalo','Get mobile data abroad without buying a local SIM card',0),
  ('airalo','Avoid roaming charges on a two week trip',1),
  ('trainline','Book a train across Europe without a separate account per country',0),
  ('trainline','Find out whether the train is cheaper than the flight',1)
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
   'open_source','{windows,macos,linux,ios,android}','{en,zh,fr,de}','{works_offline,no_account_needed,exports_data}'),
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
   'open_source','{windows,macos,linux}','{en,de,fr,es}','{works_offline,no_account_needed,exports_data}'),
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
  ('notion','Keep project notes, tasks and documents in one shared place',0),
  ('notion','Build a small database of things without writing code',1),
  ('notion','Write a team wiki everyone can edit',2),
  ('obsidian','Take notes that stay as files on my own computer',0),
  ('obsidian','Connect ideas from different notes so I can find them later',1),
  ('obsidian','Build a personal knowledge base I still own in ten years',2),
  ('obsidian','Something to help me stop forgetting things I read',3),
  ('logseq','Write a daily note and have the ideas link themselves together',0),
  ('logseq','Keep an outliner of research that lives in local files',1),
  ('joplin','Sync encrypted notes between my phone and laptop',0),
  ('joplin','Move off a notes app that locks my writing in',1),
  ('joplin','Keep notes private even from the company syncing them',2),
  ('standard-notes','Keep a private journal nobody else can read',0),
  ('standard-notes','Write down sensitive things without trusting a company',1),
  ('bear','Write quick notes on my iPhone and find them by tag',0),
  ('bear','Keep a tidy Markdown notebook across Mac and iPhone',1),
  ('ia-writer','Write a long article without the app getting in the way',0),
  ('ia-writer','See which of my sentences are limp before I publish',1),
  ('ulysses','Write a book in one place instead of forty documents',0),
  ('ulysses','Hit a daily word count target while drafting',1),
  ('scrivener','Organise a novel by scene and move chapters around',0),
  ('scrivener','Keep research notes next to the chapter that uses them',1),
  ('google-docs','Write a document with someone else at the same time',0),
  ('google-docs','Leave comments on a colleague''s draft',1),
  ('libreoffice','Open and edit Word documents without paying for Office',0),
  ('libreoffice','Write a letter on a laptop with no internet connection',1),
  ('libreoffice','Do spreadsheets without a subscription',2),
  ('onlyoffice','Edit Office documents on a server my company runs',0),
  ('onlyoffice','Work on a spreadsheet with colleagues in the browser',1),
  ('hemingway-editor','Make my writing simpler and easier to read',0),
  ('hemingway-editor','Find the sentences that are too long in a draft',1),
  ('languagetool','Check my grammar in German and English in the same tool',0),
  ('languagetool','Catch spelling mistakes in a language that is not my first',1),
  ('languagetool','Proofread an email before I send it',2),
  ('grammarly','Fix my English grammar as I write emails',0),
  ('grammarly','Sound less blunt in a work message',1),
  ('zettlr','Write an academic paper with citations from my reference manager',0),
  ('zettlr','Export a thesis chapter to Word without losing formatting',1),
  ('overleaf','Write a LaTeX paper with a co-author who is not in the room',0),
  ('overleaf','Format a scientific paper to a journal template',1),
  ('typst','Typeset a report without fighting LaTeX for an afternoon',0),
  ('typst','Write a CV that looks typeset rather than word-processed',1)
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
  ('photopea','Edit a Photoshop file without owning Photoshop',0),
  ('photopea','Crop and touch up an image on a computer I am not allowed to install things on',1),
  ('photopea','Open a PSD someone sent me',2),
  ('gimp','Remove an object from a photo for free',0),
  ('gimp','Retouch a photo without a monthly subscription',1),
  ('gimp','Cut a person out of a picture and put them on a new background',2),
  ('krita','Draw and paint digitally with a graphics tablet',0),
  ('krita','Make a short hand-drawn animation',1),
  ('inkscape','Draw a logo that stays sharp when it is printed large',0),
  ('inkscape','Turn a sketch into a clean vector file',1),
  ('inkscape','Edit an SVG someone sent me',2),
  ('darktable','Develop raw photos from my camera without Lightroom',0),
  ('darktable','Organise thousands of photos and edit them non-destructively',1),
  ('rawtherapee','Get the most detail out of a raw file',0),
  ('rawtherapee','Fix noise and colour in a badly lit photograph',1),
  ('excalidraw','Sketch a system diagram to explain it to someone',0),
  ('excalidraw','Draw boxes and arrows quickly and share the link',1),
  ('excalidraw','Whiteboard an idea with a colleague on a call',2),
  ('tldraw','Sketch an interface idea on an infinite canvas',0),
  ('tldraw','Draw a rough flow chart in a browser tab',1),
  ('figma','Design an app screen and hand it to a developer',0),
  ('figma','Make a clickable prototype to test with people',1),
  ('penpot','Design interfaces on a tool my company can host itself',0),
  ('penpot','Do interface design without being locked into one vendor',1),
  ('canva','Make a poster look decent without being a designer',0),
  ('canva','Put together slides for a talk quickly',1),
  ('canva','Design a social media post from a template',2),
  ('sketch','Design an interface on a Mac with shared component libraries',0),
  ('sketch','Hand a design to engineers with measurements they can read',1),
  ('pixelmator-pro','Edit photos on a Mac with a one-off purchase instead of a subscription',0),
  ('pixelmator-pro','Retouch a portrait and export it for print',1),
  ('squoosh','Make an image file smaller before uploading it',0),
  ('squoosh','Compress a photo without it looking terrible',1),
  ('imageoptim','Shrink images so my website loads faster',0),
  ('imageoptim','Strip location data out of photos before I publish them',1),
  ('remove-bg','Remove the background from a photo of a product',0),
  ('remove-bg','Get a clean cut-out of a person for a slide',1),
  ('upscayl','Make a small blurry photo bigger without it turning to mush',0),
  ('upscayl','Enlarge an old scanned picture on my own computer',1)
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
  ('audacity','Cut the silence out of a recorded interview',0),
  ('audacity','Remove background hiss from a voice recording for free',1),
  ('audacity','Record a voiceover on my laptop',2),
  ('ocenaudio','Trim a very long audio file without waiting for it to load',0),
  ('ocenaudio','Hear what an effect does before I apply it',1),
  ('reaper','Record a band with several microphones at once',0),
  ('reaper','Mix a multi-track song on a modest computer',1),
  ('ardour','Record and mix music without paying for a studio suite',0),
  ('ardour','Do audio post-production on Linux',1),
  ('lmms','Make electronic music without buying a studio',0),
  ('lmms','Program a drum beat on my computer',1),
  ('ableton-live','Perform electronic music live with loops',0),
  ('ableton-live','Produce a track and arrange it into a finished song',1),
  ('auphonic','Make my podcast episodes all sound the same loudness',0),
  ('auphonic','Clean up a podcast recording without learning audio engineering',1),
  ('otter-ai','Get a written transcript of a meeting I was in',0),
  ('otter-ai','Search back through what was said in a call last week',1),
  ('descript','Edit a podcast by deleting words from the transcript',0),
  ('descript','Cut the ums out of a recording quickly',1),
  ('antennapod','Listen to podcasts offline on a commute with no signal',0),
  ('antennapod','Play podcasts without ads or an account',1),
  ('pocket-casts','Keep my podcast queue in sync between phone and computer',0),
  ('pocket-casts','Speed up podcasts and cut the silences',1),
  ('audiobookshelf','Host my own audiobook library on a home server',0),
  ('audiobookshelf','Keep my place in an audiobook across devices',1),
  ('spotify','Listen to music and make playlists on my phone',0),
  ('spotify','Find new music without buying albums',1)
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
  ('shotcut','Edit a video for free without a watermark',0),
  ('shotcut','Cut together holiday clips into one film',1),
  ('shotcut','Add subtitles to a video I made',2),
  ('kdenlive','Edit video on Linux with a real timeline',0),
  ('kdenlive','Edit large 4K footage on a laptop that struggles',1),
  ('davinci-resolve','Colour grade a short film properly',0),
  ('davinci-resolve','Edit video to a professional standard without paying up front',1),
  ('handbrake','Make a video file small enough to email or upload',0),
  ('handbrake','Convert a video so it plays on my phone',1),
  ('handbrake','Rip a DVD I own to a file',2),
  ('obs-studio','Record my screen to explain something to a colleague',0),
  ('obs-studio','Stream live to Twitch or YouTube from my computer',1),
  ('obs-studio','Record a video call with my webcam and slides together',2),
  ('vlc','Play a video file that nothing else will open',0),
  ('vlc','Watch a film with subtitles from a separate file',1),
  ('mpv','Watch videos with a player that does not phone home',0),
  ('mpv','Play video from the command line with keyboard control',1),
  ('camtasia','Record a software tutorial with zooms and callouts',0),
  ('camtasia','Make a training video for colleagues',1),
  ('capcut','Edit a short vertical video on my phone',0),
  ('capcut','Put automatic subtitles on a clip for social media',1),
  ('losslesscut','Trim the start and end off a video without re-encoding',0),
  ('losslesscut','Cut a huge recording into pieces quickly',1),
  ('ffmpeg','Convert a folder of videos in one command',0),
  ('ffmpeg','Extract the audio track out of a video file',1),
  ('ffmpeg','Automate video conversion in a script',2)
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
  ('anki','Remember vocabulary for an exam without cramming',0),
  ('anki','Something to help me stop forgetting things I read',1),
  ('anki','Revise flashcards on the train with no signal',2),
  ('quizlet','Revise for a test with flashcards someone already made',0),
  ('quizlet','Practise vocabulary before a school exam',1),
  ('duolingo','Learn a new language a few minutes a day',0),
  ('duolingo','Pick up basic Spanish before a holiday',1),
  ('memrise','Learn a language by hearing how people really say it',0),
  ('memrise','Build vocabulary in a language I already half know',1),
  ('zotero','Keep track of the papers I cited in my thesis',0),
  ('zotero','Insert citations into a document in the right style',1),
  ('zotero','Save a paper from the browser with its reference details',2),
  ('mendeley','Organise a pile of research PDFs',0),
  ('mendeley','Generate a bibliography from the papers I read',1),
  ('remnote','Turn my lecture notes into flashcards automatically',0),
  ('remnote','Study from my own notes rather than someone else''s deck',1),
  ('khan-academy','Relearn maths I was taught badly at school',0),
  ('khan-academy','Help my child with homework I no longer understand',1),
  ('wolframalpha','Solve an equation and see the steps',0),
  ('wolframalpha','Convert units and check a calculation quickly',1),
  ('geogebra','See what a function looks like when I change a number',0),
  ('geogebra','Draw a geometric construction for a homework question',1),
  ('kiwix','Read Wikipedia offline where there is no internet',0),
  ('kiwix','Carry a reference library on a laptop with no connection',1)
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
  ('cronometer','Track what I eat accurately including vitamins',0),
  ('cronometer','Find out whether my diet is short of something',1),
  ('myfitnesspal','Count calories by scanning barcodes',0),
  ('myfitnesspal','Keep a food diary to lose weight',1),
  ('strava','Record my runs and see whether I am getting faster',0),
  ('strava','Find cycling routes other people actually ride',1),
  ('insight-timer','Find a guided meditation for getting to sleep',0),
  ('insight-timer','Start meditating without knowing how',1),
  ('medito','Meditate without a subscription or adverts',0),
  ('medito','Calm down before sleep with a free guided session',1),
  ('daylio','Notice what makes my mood better or worse over months',0),
  ('daylio','Keep a diary when I never have time to write one',1),
  ('loop-habit-tracker','Build a daily habit and see the streak',0),
  ('loop-habit-tracker','Track habits privately with nothing leaving my phone',1),
  ('sleep-as-android','Find out why I wake up tired',0),
  ('sleep-as-android','Be woken at a good moment rather than mid-dream',1),
  ('openfoodfacts','Check what is actually in a packaged food',0),
  ('openfoodfacts','Avoid an ingredient I am allergic to when shopping',1)
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
  ('todoist','Keep track of everything I have to do without losing things',0),
  ('todoist','Add a task by typing tomorrow at six and have it understood',1),
  ('todoist','Share a shopping list with my partner',2),
  ('things-3','Organise my tasks on a Mac and iPhone without a subscription',0),
  ('things-3','Plan my day rather than staring at one long list',1),
  ('ticktick','Have my tasks and my calendar in the same view',0),
  ('ticktick','Track habits and tasks in one app',1),
  ('microsoft-todo','Keep a free to-do list that syncs with my work email',0),
  ('microsoft-todo','Turn flagged emails into tasks',1),
  ('super-productivity','Track how long tasks take without a company seeing it',0),
  ('super-productivity','Manage work tasks offline on my own machine',1),
  ('trello','Track a small project on a board with columns',0),
  ('trello','See what everyone on the team is working on',1),
  ('asana','Run a project with deadlines and who owes what to whom',0),
  ('asana','See whether my team is overloaded next week',1),
  ('linear','Track bugs and features for a software team',0),
  ('linear','Plan a two week development cycle',1),
  ('vikunja','Run a to-do app on my own server',0),
  ('vikunja','Manage projects as a board and a list at once',1),
  ('pomofocus','Work in twenty five minute stretches with breaks',0),
  ('pomofocus','Stop drifting and actually start the task',1),
  ('cold-turkey','Block distracting websites during work hours',0),
  ('cold-turkey','Stop myself opening social media when I should be working',1),
  ('cold-turkey','Lock myself out of games until the evening',2),
  ('leechblock','Limit how long I spend on news sites each day',0),
  ('leechblock','Block a site in my browser without installing software',1),
  ('freedom','Block distractions on my phone and laptop at the same time',0),
  ('freedom','Schedule a daily focus block across every device',1),
  ('toggl-track','Find out where my working hours actually go',0),
  ('toggl-track','Bill a client for the hours I really worked',1),
  ('clockify','Track hours for a whole team without paying per seat',0),
  ('clockify','Produce a timesheet at the end of the month',1),
  ('raycast','Open apps and run little commands from the keyboard',0),
  ('raycast','Stop hunting through menus for the same three actions',1),
  ('alfred','Find a file or launch an app without the mouse',0),
  ('alfred','Get back something I copied an hour ago',1),
  ('flameshot','Take a screenshot and draw an arrow on it',0),
  ('flameshot','Blur a password out of a screenshot before sending it',1),
  ('sharex','Capture part of my screen and get a link straight away',0),
  ('sharex','Record a short screen clip as a GIF',1)
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
   'paid','{web,ios,android,windows,macos,linux,browser_extension,cli}','{en,de,fr,es,it,ja}','{e2e_encrypted,exports_data}'),
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
  ('signal','Message someone privately without it being read by a company',0),
  ('signal','Send a photo to family that stays between us',1),
  ('signal','Have a group chat that is actually encrypted',2),
  ('bitwarden','Stop reusing the same password on every site',0),
  ('bitwarden','Store passwords safely for free across my phone and laptop',1),
  ('bitwarden','Share a login with my partner without texting it',2),
  ('keepassxc','Keep my passwords in a file on my own computer',0),
  ('keepassxc','Manage passwords with nothing stored on anyone''s server',1),
  ('1password','Manage passwords for a family with shared vaults',0),
  ('1password','Fill logins on my work and personal machines reliably',1),
  ('proton-mail','Use an email account that cannot read my mail',0),
  ('proton-mail','Move off Gmail without losing calendar and storage',1),
  ('tuta-mail','Get an encrypted mailbox for free',0),
  ('tuta-mail','Send an encrypted email to someone who has no encryption',1),
  ('mullvad-vpn','Use a VPN without handing over my name or email',0),
  ('mullvad-vpn','Stop my internet provider seeing every site I visit',1),
  ('proton-vpn','Use a VPN for free without a data cap',0),
  ('proton-vpn','Connect safely on hotel and airport wifi',1),
  ('ublock-origin','Block adverts and trackers in my browser',0),
  ('ublock-origin','Make news sites readable again',1),
  ('tor-browser','Read the web without my location being visible',0),
  ('tor-browser','Reach a site that is blocked where I live',1),
  ('cryptomator','Encrypt files before they go into Dropbox',0),
  ('cryptomator','Keep documents private even if my cloud account is breached',1),
  ('veracrypt','Encrypt a USB stick so a lost one does not matter',0),
  ('veracrypt','Put sensitive files in a container only I can open',1),
  ('aegis-authenticator','Keep my two-factor codes somewhere I can back up',0),
  ('aegis-authenticator','Move my authenticator codes to a new phone',1),
  ('simplelogin','Give a shop an email address I can switch off later',0),
  ('simplelogin','Find out who sold my email address',1),
  ('duckduckgo','Search the web without being profiled',0),
  ('duckduckgo','Stop search results following me around the internet',1),
  ('kagi','Get search results without adverts or search engine optimisation spam',0),
  ('kagi','Push a site I never want to see down my search results',1)
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
   'free_trial','{windows,macos,linux}','{en,de,fr,zh}','{works_offline}'),
  ('sentry','Sentry','https://sentry.io',
   'Collects errors from a running application with the stack trace and the context around each one.',
   'freemium','{web,api}','{en}','{has_free_tier}')
) as v(slug, name, url, summary, pricing, platforms, languages, flags)
on conflict do nothing;

insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('vscode','Write code with autocomplete and a debugger for free',0),
  ('vscode','Edit a project with syntax highlighting and git built in',1),
  ('neovim','Edit files over ssh on a server with no graphical interface',0),
  ('neovim','Write code entirely from the keyboard',1),
  ('sublime-text','Open an enormous log file without the editor freezing',0),
  ('sublime-text','Rename the same thing in fifty places at once',1),
  ('intellij-idea','Refactor a large Java codebase safely',0),
  ('intellij-idea','Work on a Kotlin project with real code analysis',1),
  ('git','Keep a history of my project and undo a bad change',0),
  ('git','Work on a feature without breaking what already works',1),
  ('git','Collaborate on code without emailing zip files',2),
  ('dbeaver','Look inside a database without writing SQL for every question',0),
  ('dbeaver','Connect to Postgres and MySQL from the same tool',1),
  ('tableplus','Browse and edit database rows quickly on a Mac',0),
  ('tableplus','Run a quick query against a production replica',1),
  ('postman','Test an API endpoint before writing code against it',0),
  ('postman','Share a set of API requests with my team',1),
  ('insomnia','Send a GraphQL query and see the response',0),
  ('insomnia','Try an API with different environments and tokens',1),
  ('httpie','Call an API from the terminal without fighting curl syntax',0),
  ('httpie','Read a JSON response in the terminal without squinting',1),
  ('docker-desktop','Run a database locally without installing it on my machine',0),
  ('docker-desktop','Get a project running the same way on every laptop',1),
  ('regex101','Work out why my regular expression matches the wrong thing',0),
  ('regex101','Test a pattern against real examples before shipping it',1),
  ('jq','Pull one field out of a big JSON response',0),
  ('jq','Reshape JSON in a shell script',1),
  ('wireshark','Find out what a device on my network is actually sending',0),
  ('wireshark','Debug why a connection keeps dropping',1),
  ('beyond-compare','Compare two folders and see exactly what changed',0),
  ('beyond-compare','Merge two versions of a file by hand',1),
  ('sentry','Find out which errors real users are hitting',0),
  ('sentry','Get told when the site starts throwing exceptions',1)
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
  ('syncthing','Sync files between my laptop and desktop without a cloud',0),
  ('syncthing','Keep a folder identical on two computers privately',1),
  ('syncthing','Back up my phone photos to a computer at home',2),
  ('nextcloud','Run my own Dropbox on a server I control',0),
  ('nextcloud','Share files with a team without a subscription per person',1),
  ('nextcloud','Keep calendar and contacts off Google',2),
  ('dropbox','Sync a folder across all my computers',0),
  ('dropbox','Send someone a file too big to email',1),
  ('google-drive','Store documents online and get at them from any machine',0),
  ('google-drive','Share a folder with people who do not have an account',1),
  ('rclone','Copy files between two different cloud providers',0),
  ('rclone','Script a nightly upload to object storage',1),
  ('restic','Back up a server with encryption and deduplication',0),
  ('restic','Make backups I can actually restore and verify',1),
  ('duplicati','Schedule encrypted backups of my laptop to the cloud',0),
  ('duplicati','Back up a home machine without learning a command line',1),
  ('backblaze-backup','Back up my whole computer without thinking about it',0),
  ('backblaze-backup','Get my files back after a laptop is stolen',1),
  ('filezilla','Upload a website to a server over FTP',0),
  ('filezilla','Move files to a remote machine with a window I can see',1),
  ('seven-zip','Open a rar file someone sent me',0),
  ('seven-zip','Compress a folder and put a password on it',1),
  ('czkawka','Find duplicate photos eating my disk space',0),
  ('czkawka','Clear space on a full drive without deleting the wrong thing',1),
  ('localsend','Send a file from my phone to my laptop without the internet',0),
  ('localsend','Move a video between an iPhone and a Windows PC',1),
  ('everything-search','Find a file on Windows when I only remember part of the name',0),
  ('everything-search','Search my whole disk instantly instead of waiting for Windows',1)
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
  ('stirling-pdf','Do PDF jobs without uploading documents to a stranger''s website',0),
  ('stirling-pdf','Merge and OCR PDFs on a server I run myself',1),
  ('pdf24','Merge two PDFs for free without signing up',0),
  ('pdf24','Make a PDF smaller so it fits an upload limit',1),
  ('ilovepdf','Split a PDF into separate pages',0),
  ('ilovepdf','Convert a Word file into a PDF quickly',1),
  ('adobe-acrobat','Edit the text inside a PDF someone sent me',0),
  ('adobe-acrobat','Fill in and sign a PDF form properly',1),
  ('pdfsam-basic','Split a big PDF offline without uploading it anywhere',0),
  ('pdfsam-basic','Take three pages out of a scanned document',1),
  ('docuseal','Get a contract signed without paying per signature',0),
  ('docuseal','Run document signing on my own infrastructure',1),
  ('docusign','Send a contract for signature and see who has signed',0),
  ('docusign','Sign a document legally without printing it',1),
  ('paperless-ngx','Get rid of a filing cabinet by scanning everything',0),
  ('paperless-ngx','Find a bill from three years ago in seconds',1),
  ('tesseract-ocr','Get the text out of a scanned page',0),
  ('tesseract-ocr','Make a photographed document searchable',1)
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
  ('bring','Share a shopping list with the people I live with',0),
  ('bring','Stop buying milk twice because nobody checked the list',1),
  ('anylist','Plan meals for the week and turn them into a shopping list',0),
  ('anylist','Keep a grocery list sorted by supermarket aisle',1),
  ('grocy','Know what food I already have before I go shopping',0),
  ('grocy','Stop throwing away food that went out of date',1),
  ('home-assistant','Control the lights and heating without a company in the middle',0),
  ('home-assistant','Automate my house so it keeps working when the internet is down',1),
  ('paprika','Save recipes from websites without the essay above them',0),
  ('paprika','Turn a recipe into a shopping list automatically',1),
  ('mealie','Keep all my recipes on my own server',0),
  ('mealie','Plan the week''s dinners with my household',1),
  ('tody','Share the cleaning fairly in a flat',0),
  ('tody','Remember when the bathroom was last properly cleaned',1)
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
  ('nvda','Use a Windows computer when I cannot see the screen',0),
  ('nvda','Have my screen read aloud without paying for software',1),
  ('be-my-eyes','Get a sighted person to tell me what this label says',0),
  ('be-my-eyes','Ask someone to check something for me when I cannot see it',1),
  ('seeing-ai','Have my phone read a letter aloud to me',0),
  ('seeing-ai','Find out what is in front of me using the camera',1),
  ('color-oracle','Check whether my design works for colour blind people',0),
  ('color-oracle','See my screen the way a red-green colour blind person does',1),
  ('axe-devtools','Find the accessibility problems on a page I built',0),
  ('axe-devtools','Check a site against accessibility guidelines before launch',1),
  ('wave-webaim','See which parts of my web page fail contrast',0),
  ('wave-webaim','Check whether my headings are in a sensible order',1),
  ('opendyslexic','Make text easier to read when I have dyslexia',0),
  ('opendyslexic','Change the font on websites so reading is less tiring',1),
  ('speechify','Have articles read aloud to me while I walk',0),
  ('speechify','Get through a long PDF by listening instead of reading',1)
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
   'free','{ios,android,web,windows,macos,linux}','{en,es,ru,de,ar,he,fa}','{has_free_tier}'),
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
  ('slack','Keep work conversation out of my email inbox',0),
  ('slack','Organise team discussion into channels',1),
  ('discord','Run a community with voice and text channels',0),
  ('discord','Talk to friends while playing something together',1),
  ('telegram','Send big files to someone without email limits',0),
  ('telegram','Run a group chat with hundreds of people',1),
  ('element','Set up team chat on a server we control',0),
  ('element','Have encrypted group chat that is not owned by one company',1),
  ('jitsi-meet','Have a video call without anyone installing anything',0),
  ('jitsi-meet','Meet online without making an account',1),
  ('zoom','Run a meeting with people outside my company',0),
  ('zoom','Record a call so people who missed it can watch',1),
  ('thunderbird','Read several email accounts in one desktop program',0),
  ('thunderbird','Keep my email on my own computer rather than a website',1),
  ('fastmail','Use email on my own domain without adverts',0),
  ('fastmail','Move away from free email without losing my address',1)
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
  ('wallabag','Save an article to read later and keep it even if the site dies',0),
  ('wallabag','Read saved articles offline on the train',1),
  ('raindrop-io','Organise hundreds of bookmarks so I can find them again',0),
  ('raindrop-io','Collect links on a topic and share the collection',1),
  ('readwise','Remember what I highlighted in a book six months ago',0),
  ('readwise','Something to help me stop forgetting things I read',1),
  ('instapaper','Save a long article for the commute',0),
  ('instapaper','Read web pages without adverts and pop-ups',1),
  ('calibre','Convert an ebook so it opens on my Kindle',0),
  ('calibre','Organise a large collection of ebooks',1),
  ('koreader','Read PDFs comfortably on an e-ink screen',0),
  ('koreader','Look up a word in a foreign language book while reading',1),
  ('freshrss','Follow the blogs I care about without an algorithm',0),
  ('freshrss','Run my own feed reader on a small server',1),
  ('miniflux','Read RSS feeds on a tiny server without a heavy app',0),
  ('miniflux','Follow news sites without an account at a big company',1),
  ('feedly','Keep up with a lot of publications in one place',0),
  ('feedly','Follow industry news without social media',1)
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
  ('deepl','Translate a document into another language without it reading like a robot',0),
  ('deepl','Understand an email written in a language I do not speak',1),
  ('deepl','Traducir un documento a otro idioma sin que suene raro',2),
  ('libretranslate','Translate text without sending it to a big company',0),
  ('libretranslate','Run a translation service on my own server',1),
  ('reverso','See how a phrase is actually used in real sentences',0),
  ('reverso','Conjugate a French verb I keep getting wrong',1),
  ('wordreference','Find the right word when the dictionary translation is wrong',0),
  ('wordreference','Understand an idiom that makes no sense translated literally',1),
  ('morfix','Look up an English word in Hebrew',0),
  ('morfix','מילון עברי אנגלי לתרגום מילים',1),
  ('morfix','Translate a Hebrew word I do not know into English',2),
  ('dicta-nakdan','Add vowel points to a Hebrew text automatically',0),
  ('dicta-nakdan','כלי לניקוד אוטומטי של טקסט בעברית',1),
  ('almaany','Look up the meaning of an Arabic word',0),
  ('almaany','قاموس للبحث عن معنى كلمة عربية',1)
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
-- A few problem statements in other languages.
--
-- Phase 2 has no translation step: full-text search matches the words people
-- actually type. The audience starts in Israel and the United States, so some
-- of what a person types will be Hebrew, Spanish, French, Russian, Arabic or
-- Portuguese, and the catalogue has to contain those words somewhere or the
-- non-English half of the golden set can only ever score zero.
--
-- Every tool here already has one to three English statements, so all of them
-- stay within the two-to-four rule.
-- ===========================================================================
insert into public.tool_problems (tool_id, statement, sort_order)
select t.id, p.statement, p.sort_order
from public.tools t
join (values
  ('tricount','Dividir los gastos de un viaje entre amigos',3),
  ('settle-up','Partager les dépenses d''un voyage entre amis',2),
  ('settle-up','לחלק הוצאות של טיול בין חברים',3),
  ('splid','חלוקת חשבון בין חברים בלי להירשם לאפליקציה',2),
  ('splid','Dividir una cuenta con amigos sin registrarse',3),
  ('signal','אפליקציית מסרים מוצפנת ופרטית',3),
  ('libreoffice','Escribir documentos sin pagar una suscripción',3),
  ('vlc','Reproducir cualquier archivo de vídeo que no se abre',2),
  ('vlc','נגן וידאו שפותח כל סוג של קובץ',3),
  ('organic-maps','Mapas sin conexión para viajar sin datos móviles',3),
  ('duolingo','Aprender un idioma nuevo unos minutos al día',2),
  ('duolingo','Apprendre une langue quelques minutes par jour',3),
  ('gimp','Editar fotos gratis sin pagar Photoshop',3),
  ('bitwarden','Guardar mis contraseñas de forma segura y gratis',3),
  ('handbrake','Reduzir o tamanho de um vídeo grande',3),
  ('photopea','Редактировать изображение прямо в браузере',3),
  ('anki','כרטיסיות לחזרה על חומר ללימודים',3),
  ('audacity','Убрать шум из аудиозаписи бесплатно',3)
) as p(slug, statement, sort_order) on p.slug = t.slug::text
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

insert into public.collections (owner_id, name, slug, description, is_public) values
  ('dev_person', 'Trip to Greece', 'trip-to-greece', 'Everything we used in June.', true),
  ('dev_person', 'Quiet mornings', 'quiet-mornings', null, false)
on conflict do nothing;

insert into public.collection_items (collection_id, tool_id, sort_order)
select c.id, t.id, row_number() over ()
from public.collections c
join public.tools t on t.slug::text in ('tabsplit', 'receiptly', 'splitwise', 'organic-maps')
where c.slug::text = 'trip-to-greece'
on conflict do nothing;

commit;
