create type public.processing_status as enum (
  'queued',
  'downloading',
  'extracting_audio',
  'transcribing',
  'analyzing',
  'rendering',
  'uploading',
  'ready',
  'failed'
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.processing_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  stage_message text not null default 'Menunggu worker',
  transcript jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clips
  add column title text,
  add column reason text;

create index processing_jobs_user_created_idx on public.processing_jobs(user_id, created_at desc);
create index processing_jobs_status_created_idx on public.processing_jobs(status, created_at);

create unique index one_active_job_per_video_idx
on public.processing_jobs(video_id)
where status not in ('ready', 'failed');

alter table public.processing_jobs enable row level security;

create policy "Users can view their own processing jobs"
on public.processing_jobs for select
using (auth.uid() = user_id);

create policy "Users can queue jobs for their own videos"
on public.processing_jobs for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.videos
    where videos.id = processing_jobs.video_id and videos.user_id = auth.uid()
  )
);

create policy "Users can cancel queued jobs"
on public.processing_jobs for delete
using (auth.uid() = user_id and status = 'queued');

