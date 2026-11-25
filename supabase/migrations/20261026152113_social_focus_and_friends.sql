-- Friendship, user-owned focus history, and a friend-only text feed.
create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index friend_invites_owner_idx on public.friend_invites(owner_id, created_at desc);

create table public.friend_connections (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references auth.users(id) on delete cascade,
  user_high_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_low_id < user_high_id),
  unique (user_low_id, user_high_id)
);
create index friend_connections_high_idx on public.friend_connections(user_high_id);

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  completed_at timestamptz not null default now()
);
create index focus_sessions_user_date_idx on public.focus_sessions(user_id, completed_at desc);

create table public.lawn_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index lawn_posts_created_idx on public.lawn_posts(created_at desc);

alter table public.friend_invites enable row level security;
alter table public.friend_connections enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.lawn_posts enable row level security;

create policy friend_invites_read_owner on public.friend_invites for select to authenticated using (owner_id = (select auth.uid()));
create policy friend_connections_read_participants on public.friend_connections for select to authenticated using ((select auth.uid()) in (user_low_id, user_high_id));
create policy focus_sessions_read_self_and_friends on public.focus_sessions for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.friend_connections f
    where (f.user_low_id = (select auth.uid()) and f.user_high_id = focus_sessions.user_id)
       or (f.user_high_id = (select auth.uid()) and f.user_low_id = focus_sessions.user_id)
  )
);
create policy lawn_posts_read_self_and_friends on public.lawn_posts for select to authenticated using (
  user_id = (select auth.uid()) or exists (
    select 1 from public.friend_connections f
    where (f.user_low_id = (select auth.uid()) and f.user_high_id = lawn_posts.user_id)
       or (f.user_high_id = (select auth.uid()) and f.user_low_id = lawn_posts.user_id)
  )
);
create policy lawn_posts_insert_own on public.lawn_posts for insert to authenticated with check (user_id = (select auth.uid()));
create policy lawn_posts_delete_own on public.lawn_posts for delete to authenticated using (user_id = (select auth.uid()));
grant select on public.friend_invites, public.friend_connections, public.focus_sessions, public.lawn_posts to authenticated;
grant insert, delete on public.lawn_posts to authenticated;

create policy profiles_read_friends on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.friend_connections f
    where (f.user_low_id = (select auth.uid()) and f.user_high_id = profiles.id)
       or (f.user_high_id = (select auth.uid()) and f.user_low_id = profiles.id)
  )
);

create or replace function public.create_friend_invite(p_code_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invite code'; end if;
  insert into public.friend_invites(owner_id, code_hash) values (v_user, p_code_hash);
end;
$$;
revoke all on function public.create_friend_invite(text) from public, anon;
grant execute on function public.create_friend_invite(text) to authenticated;

create or replace function public.redeem_friend_invite(p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_low uuid; v_high uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select owner_id into v_owner from public.friend_invites
    where code_hash = p_code_hash and redeemed_at is null and expires_at > now() for update;
  if v_owner is null then raise exception 'Invite is invalid, expired, or already used'; end if;
  if v_owner = v_user then raise exception 'Cannot add yourself as a friend'; end if;
  v_low := least(v_owner, v_user); v_high := greatest(v_owner, v_user);
  insert into public.friend_connections(user_low_id, user_high_id) values (v_low, v_high)
    on conflict (user_low_id, user_high_id) do nothing;
  update public.friend_invites set redeemed_by = v_user, redeemed_at = now() where code_hash = p_code_hash;
  return v_owner;
end;
$$;
revoke all on function public.redeem_friend_invite(text) from public, anon;
grant execute on function public.redeem_friend_invite(text) to authenticated;

create or replace function public.record_focus_session(p_duration_seconds integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_duration_seconds is null or p_duration_seconds < 1 or p_duration_seconds > 86400 then
    raise exception 'Focus session duration is invalid';
  end if;
  insert into public.focus_sessions(user_id, duration_seconds) values (v_user, p_duration_seconds) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_focus_session(integer) from public, anon;
grant execute on function public.record_focus_session(integer) to authenticated;
revoke insert, update, delete on public.focus_sessions from authenticated;

create view public.friend_focus_stats with (security_invoker = true) as
with daily as (
  select user_id, (completed_at at time zone 'UTC')::date as focus_day
  from public.focus_sessions group by user_id, (completed_at at time zone 'UTC')::date
), numbered as (
  select user_id, focus_day, focus_day - row_number() over (partition by user_id order by focus_day)::integer as streak_group
  from daily
), streaks as (
  select user_id, count(*)::integer as current_streak, max(focus_day) as latest_day
  from numbered group by user_id, streak_group
), totals as (
  select user_id, sum(duration_seconds)::bigint as total_focus_seconds, count(*)::integer as sessions,
    floor(sum(duration_seconds)::numeric / 3600 * 100)::integer as grass_points
  from public.focus_sessions group by user_id
)
select t.user_id, t.total_focus_seconds, t.sessions, t.grass_points,
  case when s.latest_day >= (now() at time zone 'UTC')::date - 1 then s.current_streak else 0 end as current_streak
from totals t left join streaks s on s.user_id = t.user_id;
grant select on public.friend_focus_stats to authenticated;

do $$ declare v_table text; begin
  foreach v_table in array array['lawn_posts','friend_connections','focus_sessions'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', v_table);
    exception when duplicate_object then null; end;
  end loop;
end $$;
