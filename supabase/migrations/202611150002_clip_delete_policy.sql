create policy "Users can delete clips from their own videos"
on public.clips for delete
using (
  exists (
    select 1 from public.videos
    where videos.id = clips.video_id and videos.user_id = auth.uid()
  )
);
