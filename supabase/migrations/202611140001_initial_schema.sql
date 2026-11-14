create extension if not exists "pgcrypto";

create type public.video_status as enum (
  'uploaded',
  'queued',
  'processing',
  'ready',
  'failed'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  original_url text not null,
  pathname text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  status public.video_status not null default 'uploaded',
  progress smallint not null default 0 check (progress between 0 and 100),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  start_time_seconds numeric(10, 3) not null check (start_time_seconds >= 0),
  end_time_seconds numeric(10, 3) not null check (end_time_seconds > start_time_seconds),
  score numeric(5, 2) check (score between 0 and 100),
  output_url text,
  caption text,
  status public.video_status not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index videos_user_id_created_at_idx on public.videos(user_id, created_at desc);
create index clips_video_id_idx on public.clips(video_id);

alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.clips enable row level security;

create policy "Users can view their own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can update their own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can view their own videos"
on public.videos for select
using (auth.uid() = user_id);

create policy "Users can create their own videos"
on public.videos for insert
with check (auth.uid() = user_id);

create policy "Users can update their own videos"
on public.videos for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own videos"
on public.videos for delete
using (auth.uid() = user_id);

create policy "Users can view clips from their videos"
on public.clips for select
using (
  exists (
    select 1 from public.videos
    where videos.id = clips.video_id and videos.user_id = auth.uid()
  )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
