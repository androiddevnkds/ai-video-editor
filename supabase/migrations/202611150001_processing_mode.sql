create type public.processing_mode as enum ('vlog', 'tennis', 'cinematic');

alter table public.processing_jobs
  add column mode public.processing_mode not null default 'vlog';

create index processing_jobs_mode_status_idx
on public.processing_jobs(mode, status, created_at);
