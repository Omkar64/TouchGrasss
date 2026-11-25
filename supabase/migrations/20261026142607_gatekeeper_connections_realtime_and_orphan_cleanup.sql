-- Let an open app update pairing state as soon as an invite is accepted.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gatekeeper_connections'
  ) then
    execute 'alter publication supabase_realtime add table public.gatekeeper_connections';
  end if;
end
$$;

-- Permit a requester to remove only their own unlinked proof file if request
-- creation fails after upload. Proofs attached to a request remain protected.
create policy proof_delete_own_orphans
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'unlock-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1
    from public.unlock_requests r
    where r.proof_path = storage.objects.name
  )
);
