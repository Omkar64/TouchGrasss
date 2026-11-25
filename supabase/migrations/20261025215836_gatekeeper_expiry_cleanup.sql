alter table public.unlock_requests alter column proof_path drop not null;
create index gatekeeper_invites_requester_idx on public.gatekeeper_invites(requester_id,created_at desc);
create index gatekeeper_invites_expiry_idx on public.gatekeeper_invites(expires_at);
create index gatekeeper_invites_redeemed_by_idx on public.gatekeeper_invites(redeemed_by);
create extension if not exists pg_cron with schema extensions;
select cron.schedule('touchgrass-expire-unanswered','*/15 * * * *',$job$update public.unlock_requests set status='expired', decided_at=now(), proof_delete_after=now() where status='pending' and expires_at<=now()$job$);
