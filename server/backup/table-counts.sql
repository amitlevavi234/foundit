-- ===========================================================================
-- The query that builds the query that counts every table in `public`.
--
-- ONE COPY, READ BY BOTH BACKUP SCRIPTS. `pg-dump-offsite.sh` runs the result
-- inside the dump's own snapshot and puts the answer in the archive as
-- `counts-<stamp>.txt`; `verify-restore.sh` runs the same result against the
-- RESTORED COPY and compares the two lists. If the two scripts built this
-- differently, a difference in the SQL would read as a difference in the data,
-- which is the worst kind of false alarm — one that looks like a real one.
--
-- TWO ROUND TRIPS, AND THE FIRST ONE WRITES THE SECOND. `count(*)` cannot be
-- taken over a table named by a variable in plain SQL, and `reltuples` is an
-- ESTIMATE — it is what the last ANALYZE saw, which on a freshly restored
-- database is often -1. So the catalogue is asked for a UNION of real counts,
-- and that one statement is then run. A table added by a migration tomorrow is
-- counted tomorrow with nobody editing a script.
--
-- `relkind = 'r'` — ordinary tables only. Not views, not partitions' parents,
-- not sequences: a view's "count" is a query somebody has to be able to
-- explain, and the failure this catches is rows that did not arrive.
select string_agg(
         format('select %L::text as t, count(*)::bigint as n from public.%I',
                c.relname, c.relname),
         ' union all ' order by c.relname)
  from pg_class c
  join pg_namespace s on s.oid = c.relnamespace
 where s.nspname = 'public' and c.relkind = 'r'
