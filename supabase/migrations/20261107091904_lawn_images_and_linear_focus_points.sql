alter table public.lawn_posts add column if not exists image_path text;
alter table public.lawn_posts alter column body set default '';
alter table public.lawn_posts drop constraint if exists lawn_posts_body_check;
alter table public.lawn_posts add constraint lawn_posts_content_check
  check (char_length(trim(body)) <= 500 and (char_length(trim(body)) > 0 or image_path is not null));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lawn-images', 'lawn-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy lawn_images_upload_own_folder on storage.objects for insert to authenticated
with check (bucket_id = 'lawn-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy lawn_images_read_author_or_friends on storage.objects for select to authenticated
using (bucket_id = 'lawn-images' and exists (
  select 1 from public.lawn_posts post where post.image_path = storage.objects.name and (
    post.user_id = (select auth.uid()) or exists (
      select 1 from public.friend_connections connection
      where (connection.user_low_id = (select auth.uid()) and connection.user_high_id = post.user_id)
         or (connection.user_high_id = (select auth.uid()) and connection.user_low_id = post.user_id)
    )
  )
));

create policy lawn_images_delete_own_folder on storage.objects for delete to authenticated
using (bucket_id = 'lawn-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

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
    floor(sum(duration_seconds)::numeric / 60)::integer as grass_points
  from public.focus_sessions group by user_id
)
select t.user_id, t.total_focus_seconds, t.sessions, t.grass_points,
  case when s.latest_day >= (now() at time zone 'UTC')::date - 1 then s.current_streak else 0 end as current_streak
from totals t left join streaks s on s.user_id = t.user_id;
grant select on public.friend_focus_stats to authenticated;
