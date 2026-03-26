-- =============================================================================
-- WAYA SURF - SECURITY HARDENING (POSTS + STORAGE)
-- Run this in Supabase SQL Editor after replacing the admin emails below.
-- =============================================================================

-- 1) Table guards (validation at DB level)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posts_title_len_chk'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_title_len_chk
      check (char_length(title) between 3 and 140);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posts_excerpt_len_chk'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_excerpt_len_chk
      check (char_length(coalesce(excerpt, '')) <= 320);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posts_category_chk'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_category_chk
      check (category in ('CULTURE', 'PEOPLE', 'GEAR', 'TRAVEL', 'THOUGHTS'));
  end if;
end $$;

alter table public.posts enable row level security;

-- Keep blog/news publicly readable
drop policy if exists "Enable read access for all users" on public.posts;
create policy "Enable read access for all users"
on public.posts for select
using (true);

-- 2) Replace broad write policies with restricted admin-email policies
drop policy if exists "Enable insert access for authenticated users only" on public.posts;
drop policy if exists "Enable update access for authenticated users only" on public.posts;
drop policy if exists "Enable delete access for authenticated users only" on public.posts;
drop policy if exists "Insert only allowed admin emails" on public.posts;
drop policy if exists "Update only allowed admin emails" on public.posts;
drop policy if exists "Delete only allowed admin emails" on public.posts;

create policy "Insert only allowed admin emails"
on public.posts for insert
with check (
  auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
    -- add more admin emails if needed
  )
);

create policy "Update only allowed admin emails"
on public.posts for update
using (
  auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
)
with check (
  auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
);

create policy "Delete only allowed admin emails"
on public.posts for delete
using (
  auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
);

-- 3) Storage hardening for news-images bucket
drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Allow upload only to allowed admin emails" on storage.objects;

create policy "Allow upload only to allowed admin emails"
on storage.objects for insert
with check (
  bucket_id = 'news-images'
  and auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
);

-- Optional: restrict delete/update on storage to admin emails too
drop policy if exists "Allow admin update news-images" on storage.objects;
create policy "Allow admin update news-images"
on storage.objects for update
using (
  bucket_id = 'news-images'
  and auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
)
with check (
  bucket_id = 'news-images'
  and auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
);

drop policy if exists "Allow admin delete news-images" on storage.objects;
create policy "Allow admin delete news-images"
on storage.objects for delete
using (
  bucket_id = 'news-images'
  and auth.role() = 'authenticated'
  and lower(coalesce(auth.jwt()->>'email', '')) in (
    'info@wayasurf.com'
  )
);
