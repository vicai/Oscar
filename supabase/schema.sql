create extension if not exists pgcrypto;

create table if not exists public.oscar_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique null,
  email text not null unique,
  is_guest boolean not null default false,
  plan text not null default 'free',
  subscription_status text not null default 'inactive',
  stripe_customer_id text null,
  stripe_subscription_id text null,
  games_used_today integer not null default 0,
  usage_window_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oscar_sessions (
  id uuid primary key,
  account_id uuid not null references public.oscar_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.oscar_profiles (
  id uuid primary key,
  account_id uuid not null references public.oscar_accounts(id) on delete cascade,
  name text not null,
  target_ai_rating integer not null default 100,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oscar_games (
  id uuid primary key,
  user_id uuid not null references public.oscar_profiles(id) on delete cascade,
  mode text not null,
  time_control text not null default '15_0',
  initial_time_ms integer not null default 900000,
  increment_ms integer not null default 0,
  white_time_ms integer not null default 900000,
  black_time_ms integer not null default 900000,
  active_turn_started_at timestamptz null,
  opening_id text null,
  opening_name text null,
  opening_side text null,
  opening_status text not null default 'none',
  human_color text not null,
  ai_color text not null,
  status text not null,
  result text null,
  fen text not null,
  pgn text not null default '',
  move_history jsonb not null default '[]'::jsonb,
  position_history jsonb not null default '[]'::jsonb,
  adaptive_rating integer not null,
  starting_rating integer not null,
  rating_delta integer null,
  engine_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.oscar_accounts enable row level security;
alter table public.oscar_sessions enable row level security;
alter table public.oscar_profiles enable row level security;
alter table public.oscar_games enable row level security;

drop policy if exists "Users can read own account" on public.oscar_accounts;
create policy "Users can read own account"
on public.oscar_accounts
for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists "Users can read own profiles" on public.oscar_profiles;
create policy "Users can read own profiles"
on public.oscar_profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.oscar_accounts accounts
    where accounts.id = account_id
      and accounts.auth_user_id = auth.uid()
  )
);

drop policy if exists "Users can read own games" on public.oscar_games;
create policy "Users can read own games"
on public.oscar_games
for select
to authenticated
using (
  exists (
    select 1
    from public.oscar_profiles profiles
    join public.oscar_accounts accounts on accounts.id = profiles.account_id
    where profiles.id = user_id
      and accounts.auth_user_id = auth.uid()
  )
);
