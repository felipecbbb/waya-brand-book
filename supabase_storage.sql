-- Storage Policies for 'news-images' bucket

-- 1. Enable Public Access (Read)
-- This allows anyone on the internet (your blog visitors) to see the images.
create policy "Give public access to news-images"
on storage.objects for select
using ( bucket_id = 'news-images' );

-- 2. Enable Authenticated Upload (Insert)
-- This allows only logged-in users (YOU) to upload files.
create policy "Allow authenticated uploads"
on storage.objects for insert
with check (
  bucket_id = 'news-images' and
  auth.role() = 'authenticated'
);

-- Note: You still need to CREATE the bucket named 'news-images' in the Supabase Dashboard first!
-- Go to Storage -> New Bucket -> Name: "news-images" -> Public Bucket: ON.
