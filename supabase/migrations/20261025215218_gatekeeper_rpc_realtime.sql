create or replace function public.redeem_gatekeeper_invite(p_code_hash text,p_gatekeeper uuid) returns table(requester_id uuid,gatekeeper_id uuid) language sql security definer set search_path='' as $$ select * from private.redeem_invite(p_code_hash,p_gatekeeper) $$;
revoke all on function public.redeem_gatekeeper_invite(text,uuid) from public,anon,authenticated;
grant execute on function public.redeem_gatekeeper_invite(text,uuid) to service_role;
create or replace function public.review_gatekeeper_request(p_request uuid,p_gatekeeper uuid,p_approve_minutes int) returns public.unlock_requests language sql security definer set search_path='' as $$ select private.review_unlock_request(p_request,p_gatekeeper,p_approve_minutes) $$;
revoke all on function public.review_gatekeeper_request(uuid,uuid,int) from public,anon,authenticated;
grant execute on function public.review_gatekeeper_request(uuid,uuid,int) to service_role;
alter publication supabase_realtime add table public.unlock_grants;
