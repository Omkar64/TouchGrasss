create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.gatekeeper_invites (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique, expires_at timestamptz not null default (now()+interval '24 hours'),
  redeemed_by uuid references auth.users(id) on delete set null, redeemed_at timestamptz, created_at timestamptz not null default now()
);
create table public.gatekeeper_connections (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null unique references auth.users(id) on delete cascade,
  gatekeeper_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  check (requester_id <> gatekeeper_id)
);
create index gatekeeper_connections_gatekeeper_idx on public.gatekeeper_connections(gatekeeper_id);
create table public.unlock_requests (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references auth.users(id) on delete cascade,
  gatekeeper_id uuid not null references auth.users(id) on delete cascade,
  target_key text not null check (target_key in ('instagram','tiktok','x','reddit','snapchat','facebook','youtube')),
  proof_type text not null check (proof_type in ('voice','video')), proof_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','expired')),
  created_at timestamptz not null default now(), expires_at timestamptz not null default (now()+interval '24 hours'),
  decided_at timestamptz, proof_delete_after timestamptz, decision_note text
);
create index unlock_requests_requester_idx on public.unlock_requests(requester_id,created_at desc);
create index unlock_requests_gatekeeper_idx on public.unlock_requests(gatekeeper_id,created_at desc);
create unique index one_pending_request_per_requester on public.unlock_requests(requester_id) where status='pending';
create table public.unlock_grants (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.unlock_requests(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  target_key text not null check (target_key in ('instagram','tiktok','x','reddit','snapchat','facebook','youtube')),
  duration_minutes int not null check (duration_minutes in (5,15,30)),
  approved_at timestamptz not null default now(), usable_at timestamptz not null, expires_at timestamptz not null,
  check (usable_at=approved_at+interval '60 seconds'), check (expires_at>usable_at)
);
create index unlock_grants_requester_expiry_idx on public.unlock_grants(requester_id,expires_at desc);

alter table public.profiles enable row level security;
alter table public.gatekeeper_invites enable row level security;
alter table public.gatekeeper_connections enable row level security;
alter table public.unlock_requests enable row level security;
alter table public.unlock_grants enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy connections_read_participants on public.gatekeeper_connections for select to authenticated using (requester_id=(select auth.uid()) or gatekeeper_id=(select auth.uid()));
create policy requests_read_participants on public.unlock_requests for select to authenticated using (requester_id=(select auth.uid()) or gatekeeper_id=(select auth.uid()));
create policy grants_read_requester on public.unlock_grants for select to authenticated using (requester_id=(select auth.uid()));

create or replace function private.create_profile_for_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name) values (new.id,coalesce(new.raw_user_meta_data->>'name',split_part(coalesce(new.email,''),'@',1))) on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function private.create_profile_for_auth_user() from public,anon,authenticated;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function private.create_profile_for_auth_user();

create or replace function private.redeem_invite(p_code_hash text,p_gatekeeper uuid) returns table(requester_id uuid,gatekeeper_id uuid) language plpgsql security definer set search_path='' as $$
declare v_requester uuid;
begin
 select i.requester_id into v_requester from public.gatekeeper_invites i where i.code_hash=p_code_hash and i.redeemed_at is null and i.expires_at>now() for update;
 if v_requester is null then raise exception 'Invite is invalid, expired, or already used'; end if;
 if v_requester=p_gatekeeper then raise exception 'Cannot be your own Gatekeeper'; end if;
 insert into public.gatekeeper_connections(requester_id,gatekeeper_id) values(v_requester,p_gatekeeper);
 update public.gatekeeper_invites set redeemed_by=p_gatekeeper,redeemed_at=now() where code_hash=p_code_hash;
 return query select v_requester,p_gatekeeper;
end;
$$;
revoke all on function private.redeem_invite(text,uuid) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.redeem_invite(text,uuid) to service_role;

create or replace function private.review_unlock_request(p_request uuid,p_gatekeeper uuid,p_approve_minutes int) returns public.unlock_requests language plpgsql security definer set search_path='' as $$
declare v_req public.unlock_requests;
begin
 select * into v_req from public.unlock_requests where id=p_request for update;
 if not found or v_req.gatekeeper_id<>p_gatekeeper or v_req.status<>'pending' or v_req.expires_at<=now() then raise exception 'Request is unavailable'; end if;
 if p_approve_minutes is null then
   update public.unlock_requests set status='rejected',decided_at=now(),proof_delete_after=now()+interval '24 hours' where id=p_request returning * into v_req;
 elsif p_approve_minutes in (5,15,30) then
   update public.unlock_requests set status='approved',decided_at=now(),proof_delete_after=now()+interval '24 hours' where id=p_request returning * into v_req;
   insert into public.unlock_grants(request_id,requester_id,target_key,duration_minutes,approved_at,usable_at,expires_at)
   values(v_req.id,v_req.requester_id,v_req.target_key,p_approve_minutes,now(),now()+interval '60 seconds',now()+interval '60 seconds'+make_interval(mins=>p_approve_minutes));
 else raise exception 'Unsupported approval duration'; end if;
 return v_req;
end;
$$;
revoke all on function private.review_unlock_request(uuid,uuid,int) from public,anon,authenticated;
grant execute on function private.review_unlock_request(uuid,uuid,int) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('unlock-proofs','unlock-proofs',false,8388608,array['audio/mp4','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['audio/mp4','video/mp4'];
create policy proof_upload_own_folder on storage.objects for insert to authenticated with check(bucket_id='unlock-proofs' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy proof_read_participants on storage.objects for select to authenticated using(bucket_id='unlock-proofs' and exists(select 1 from public.unlock_requests r where r.proof_path=name and (r.requester_id=(select auth.uid()) or r.gatekeeper_id=(select auth.uid()))));
alter publication supabase_realtime add table public.unlock_requests;
