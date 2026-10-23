-- type-ahead search matches '%text%' in the name: a trigram index turns that full scan (0.4-1.1 s) into an index lookup
create extension if not exists pg_trgm with schema extensions;
create index places_search_trgm_idx on public.places
  using gin ((lower(name || ' ' || coalesce(name_th, ''))) extensions.gin_trgm_ops);
