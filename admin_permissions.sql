-- Permissions for Editing and Deleting Posts
-- Run this in Supabase SQL Editor

-- 1. Allow Admin to UPDATE posts
create policy "Enable update access for authenticated users only"
on public.posts for update
using ( auth.role() = 'authenticated' )
with check ( auth.role() = 'authenticated' );

-- 2. Allow Admin to DELETE posts
create policy "Enable delete access for authenticated users only"
on public.posts for delete
using ( auth.role() = 'authenticated' );
