-- Lumos One 1.1 (Social Hub) — rich presence + Realtime for the Universal Social Hub.
-- Run AFTER schema.sql and schema_v1_1.sql in the Supabase SQL editor. Idempotent.

-- 1) presence (one row per user, visible to the user and their accepted friends)
create table if not exists public.presence (
  user_id    uuid primary key references auth.users on delete cascade,
  status     text not null default 'online' check (status in ('online','away','busy','offline')),
  game       text,
  cover      text,
  since      timestamptz,
  party      jsonb,
  updated_at timestamptz not null default now()
);
alter table public.presence enable row level security;

drop policy if exists "presence own or friends" on public.presence;
create policy "presence own or friends" on public.presence for select
  using (user_id = auth.uid() or public.lumos_are_friends(auth.uid(), user_id));
drop policy if exists "presence write own" on public.presence;
create policy "presence write own" on public.presence for insert with check (user_id = auth.uid());
drop policy if exists "presence update own" on public.presence;
create policy "presence update own" on public.presence for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Realtime: new messages / read receipts / presence are pushed to subscribed clients
--    (RLS still decides who receives which row).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'presence') then
    alter publication supabase_realtime add table public.presence;
  end if;
end $$;
alter table public.messages replica identity full;

-- 3) username search for the Smart Friend Finder (min. 3 characters, max. 10 hits, never exposes e-mail)
create or replace function public.lumos_search_users(p_q text)
returns table (user_id uuid, display_name text, friend_code text, is_friend boolean)
language sql stable security definer set search_path = public as $$
  select d.user_id, d.display_name, d.friend_code, public.lumos_are_friends(auth.uid(), d.user_id)
  from public.directory d
  where length(trim(p_q)) >= 3 and d.user_id <> auth.uid() and d.display_name ilike '%' || replace(replace(trim(p_q), '%', ''), '_', '') || '%'
  order by d.display_name limit 10;
$$;
grant execute on function public.lumos_search_users(text) to authenticated;
