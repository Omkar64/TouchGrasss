-- Keep privilege-elevated logic outside the exposed public API schema.
drop function public.create_friend_invite(text);
drop function public.redeem_friend_invite(text);
drop function public.record_focus_session(integer);

create or replace function private.create_friend_invite(p_code_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invite code'; end if;
  insert into public.friend_invites(owner_id, code_hash) values (v_user, p_code_hash);
end;
$$;

create or replace function private.redeem_friend_invite(p_code_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_owner uuid; v_low uuid; v_high uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invite code'; end if;
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

create or replace function private.record_focus_session(p_duration_seconds integer)
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

revoke all on function private.create_friend_invite(text) from public, anon, authenticated;
revoke all on function private.redeem_friend_invite(text) from public, anon, authenticated;
revoke all on function private.record_focus_session(integer) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.create_friend_invite(text) to authenticated;
grant execute on function private.redeem_friend_invite(text) to authenticated;
grant execute on function private.record_focus_session(integer) to authenticated;

create or replace function public.create_friend_invite(p_code_hash text)
returns void language sql security invoker set search_path = '' as $$
  select private.create_friend_invite(p_code_hash);
$$;
create or replace function public.redeem_friend_invite(p_code_hash text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.redeem_friend_invite(p_code_hash);
$$;
create or replace function public.record_focus_session(p_duration_seconds integer)
returns uuid language sql security invoker set search_path = '' as $$
  select private.record_focus_session(p_duration_seconds);
$$;
revoke all on function public.create_friend_invite(text) from public, anon;
revoke all on function public.redeem_friend_invite(text) from public, anon;
revoke all on function public.record_focus_session(integer) from public, anon;
grant execute on function public.create_friend_invite(text) to authenticated;
grant execute on function public.redeem_friend_invite(text) to authenticated;
grant execute on function public.record_focus_session(integer) to authenticated;

create or replace view public.friend_focus_stats with (security_invoker = true) as
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
    floor(sum(duration_seconds)::numeric / 3600)::integer * 100 as grass_points
  from public.focus_sessions group by user_id
)
select t.user_id, t.total_focus_seconds, t.sessions, t.grass_points,
  case when s.latest_day >= (now() at time zone 'UTC')::date - 1 then s.current_streak else 0 end as current_streak
from totals t left join streaks s on s.user_id = t.user_id;
grant select on public.friend_focus_stats to authenticated;
