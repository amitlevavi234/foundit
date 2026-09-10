-- ===========================================================================
-- Development seed data.
--
-- Invented tools, invented people. This never runs against production: it
-- exists so the app has something to render and so the permission tests have
-- rows to fail against.
--
-- The tool names are made up on purpose. Development data that names real
-- products ends up quoted as fact — in a screenshot, in a demo, in a bug
-- report — and every claim here about pricing or features is fiction.
-- ===========================================================================

begin;

insert into public.categories (slug, name, description, sort_order) values
  ('money',     'Money',     'Splitting, tracking and sending money',        1),
  ('writing',   'Writing',   'Notes, documents and long-form writing',       2),
  ('photos',    'Photos',    'Storing, editing and sharing images',          3),
  ('audio',     'Audio',     'Recording, cleaning and transcribing sound',   4),
  ('documents', 'Documents', 'PDFs, scanning and signing',                   5),
  ('focus',     'Focus',     'Blocking distractions and tracking habits',    6),
  ('travel',    'Travel',    'Planning trips and sharing costs',             7),
  ('home',      'Home',      'Lists, chores and shared households',          8);

insert into public.profiles (id, handle, display_name, bio, is_admin) values
  ('dev_admin',  'amit',   'Amit Levavi',  'Building Foundit.', true),
  ('dev_maker',  'priya',  'Priya Raman',  'I make small tools for shared households.', false),
  ('dev_person', 'tomer',  'Tomer Ben-Ari','Travels a lot, splits a lot of bills.',      false);

-- --- tools ----------------------------------------------------------------
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
   false, 'dev_maker', 'dev_maker', true, null);

-- --- what each tool is FOR ------------------------------------------------
-- These sentences are the product. Search matches against them, not against
-- the summaries above, because people describe problems and not features.
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
) as p(slug, statement, sort_order) on p.slug = t.slug::text;

-- --- categories -----------------------------------------------------------
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
join public.categories c on c.slug::text = m.cat_slug;

-- --- a few reviews, likes and a collection --------------------------------
insert into public.reviews (tool_id, author_id, rating, solved_problem, ease_of_use, body)
select t.id, r.author, r.rating, r.solved, r.ease, r.body
from public.tools t
join (values
  ('tabsplit', 'dev_person', 5, true,  5, 'Used it for a week in Greece with six people. Nobody argued once.'),
  ('tabsplit', 'dev_maker',  4, true,  4, 'Fine for recurring bills. The free tier stops at ten people.'),
  ('receiptly','dev_person', 4, true,  3, 'Scanning is quick, the splitting screen takes a moment to learn.'),
  ('quietroom','dev_person', 5, true,  5, 'Saved a recording I thought was ruined.')
) as r(slug, author, rating, solved, ease, body) on r.slug = t.slug::text;

insert into public.tool_likes (user_id, tool_id)
select u.id, t.id
from public.tools t
join (values
  ('tabsplit','dev_person'), ('tabsplit','dev_maker'),
  ('quietroom','dev_person'), ('draftbin','dev_person'), ('cupboard','dev_person')
) as l(slug, user_id) on l.slug = t.slug::text
join public.profiles u on u.id = l.user_id;

insert into public.collections (owner_id, name, slug, description, is_public) values
  ('dev_person', 'Trip to Greece', 'trip-to-greece', 'Everything we used in June.', true),
  ('dev_person', 'Quiet mornings', 'quiet-mornings', null, false);

insert into public.collection_items (collection_id, tool_id, sort_order)
select c.id, t.id, row_number() over ()
from public.collections c
join public.tools t on t.slug::text in ('tabsplit', 'receiptly')
where c.slug::text = 'trip-to-greece';

commit;
