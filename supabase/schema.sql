-- Run once in the Supabase SQL editor. Use a dedicated project for this app.
grant usage on schema public to authenticated;
create table if not exists public.workbench_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"schemaVersion":1,"basic":{},"preferences":{},"items":[]}',
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint bounded_account_payload check (
    coalesce((pg_column_size(payload) < 2000000
    and jsonb_typeof(payload) = 'object'
    and payload->>'schemaVersion' = '1'
    and jsonb_typeof(payload->'basic') = 'object'
    and jsonb_typeof(payload->'preferences') = 'object'
    and jsonb_typeof(payload->'items') = 'array'
    and jsonb_array_length(payload->'items') <= 1000
    and payload ?& array['schemaVersion','basic','preferences','items']
    and (payload - array['schemaVersion','basic','preferences','items']::text[]) = '{}'::jsonb
    and ((payload->'basic') - array['name','school','degree','graduation','targetRole','email']::text[]) = '{}'::jsonb
    and ((payload->'preferences') - array['roles','skills','cities']::text[]) = '{}'::jsonb),false)
  )
);
alter table public.workbench_accounts enable row level security;
revoke all on public.workbench_accounts from anon;
revoke all on public.workbench_accounts from authenticated;
grant select on public.workbench_accounts to authenticated;
drop policy if exists account_read_own on public.workbench_accounts;
create policy account_read_own on public.workbench_accounts for select to authenticated using ((select auth.uid()) = user_id);

-- Writes go through one compare-and-swap function. A stale tab cannot silently overwrite another device.
create or replace function public.save_workbench_account(expected_user_id uuid, expected_revision bigint, new_payload jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_revision bigint;
  next_revision bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if expected_user_id is distinct from uid then raise exception 'Account changed' using errcode = '28000'; end if;
  if expected_revision < 0 or expected_revision is null then raise exception 'Invalid revision'; end if;
  -- Lock by account even when no row exists yet. This also serializes concurrent first saves.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select revision into current_revision from public.workbench_accounts where user_id = uid for update;
  if coalesce(current_revision, 0) <> expected_revision then
    raise exception 'Cloud revision changed; preserve local copy and reload cloud' using errcode = '40001';
  end if;
  next_revision := coalesce(current_revision, 0) + 1;
  insert into public.workbench_accounts(user_id,payload,revision,updated_at)
  values(uid,new_payload,next_revision,now())
  on conflict(user_id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at;
  return next_revision;
end;
$$;
revoke all on function public.save_workbench_account(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_workbench_account(uuid,bigint,jsonb) to authenticated;

-- No public catalog, GitHub token, resume blob, attachment or repository credential belongs in this table.
