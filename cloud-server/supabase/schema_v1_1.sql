-- Lumos Cloud 1.1 — run AFTER schema.sql (SQL Editor → New query → Run). Safe to run repeatedly.
-- Adds: friend codes (directory), friendships, chat messages, shared media bucket, save manifests.

-- 1) public directory: friend code + display name per account (created automatically on sign-up)
create table if not exists public.directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Spieler',
  friend_code text not null unique
);

create or replace function public.lumos_new_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8)
$$;

create or replace function public.lumos_on_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.directory (user_id, display_name, friend_code)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)), public.lumos_new_code())
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists lumos_on_signup on auth.users;
create trigger lumos_on_signup after insert on auth.users for each row execute function public.lumos_on_signup();

-- accounts created before this migration also get a code
insert into public.directory (user_id, display_name, friend_code)
select u.id, coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1)), public.lumos_new_code()
from auth.users u on conflict (user_id) do nothing;

-- 2) friendships (requester → addressee, pending until the addressee accepts)
create table if not exists public.friends (
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

create or replace function public.lumos_are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friends f where f.status = 'accepted' and ((f.requester = a and f.addressee = b) or (f.requester = b and f.addressee = a)))
$$;

-- add by code; if the other side already asked, the friendship is accepted immediately
create or replace function public.lumos_add_friend(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare target uuid; tname text; st text;
begin
  select user_id, display_name into target, tname from public.directory where friend_code = upper(p_code);
  if target is null then raise exception 'Kein Konto mit diesem Freundescode'; end if;
  if target = auth.uid() then raise exception 'Das ist dein eigener Code'; end if;
  if exists (select 1 from public.friends where requester = target and addressee = auth.uid()) then
    update public.friends set status = 'accepted' where requester = target and addressee = auth.uid();
    st := 'accepted';
  else
    insert into public.friends (requester, addressee) values (auth.uid(), target) on conflict do nothing;
    select case when status = 'accepted' then 'accepted' else 'outgoing' end into st from public.friends where requester = auth.uid() and addressee = target;
  end if;
  return jsonb_build_object('status', st, 'id', target, 'name', tname);
end $$;

-- 3) chat messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (length(body) <= 4000),
  attachment jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_pair_idx on public.messages (sender, recipient, created_at);

alter table public.directory enable row level security;
alter table public.friends enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own or friends" on public.directory;
create policy "own or friends" on public.directory for select using (
  user_id = auth.uid() or exists (select 1 from public.friends f where (f.requester = auth.uid() and f.addressee = user_id) or (f.addressee = auth.uid() and f.requester = user_id))
);
drop policy if exists "rename self" on public.directory;
create policy "rename self" on public.directory for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "see own friendships" on public.friends;
create policy "see own friendships" on public.friends for select using (auth.uid() in (requester, addressee));
drop policy if exists "accept requests" on public.friends;
create policy "accept requests" on public.friends for update using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "remove friendships" on public.friends;
create policy "remove friendships" on public.friends for delete using (auth.uid() in (requester, addressee));

drop policy if exists "read own conversations" on public.messages;
create policy "read own conversations" on public.messages for select using (auth.uid() in (sender, recipient));
drop policy if exists "send to friends" on public.messages;
create policy "send to friends" on public.messages for insert with check (sender = auth.uid() and public.lumos_are_friends(sender, recipient));
drop policy if exists "mark read" on public.messages;
create policy "mark read" on public.messages for update using (recipient = auth.uid()) with check (recipient = auth.uid());

grant execute on function public.lumos_add_friend(text) to authenticated;

-- 4) shared media (clips & screenshots): private bucket, shared via signed links in messages
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800) -- 50 MB (Supabase Free-Tier-Grenze)
on conflict (id) do nothing;

drop policy if exists "lumos media own folder" on storage.objects;
create policy "lumos media own folder" on storage.objects for all
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5) save manifests (file lists) for the conflict diff viewer
alter table public.saves add column if not exists manifest jsonb;

drop function if exists public.lumos_put_save(text, text, text, bigint, integer, text);
create or replace function public.lumos_put_save(p_save_id text, p_title text, p_sha256 text, p_size bigint, p_base_version integer, p_device text, p_manifest jsonb default null)
returns jsonb language plpgsql security invoker as $$
declare cur integer; v integer;
begin
  select version into cur from public.saves where user_id = auth.uid() and save_id = p_save_id for update;
  if cur is not null and p_base_version is not null and p_base_version <> cur then
    return jsonb_build_object('conflict', true, 'version', cur);
  end if;
  insert into public.saves (user_id, save_id, title, sha256, size, version, device, manifest, updated_at)
  values (auth.uid(), p_save_id, p_title, p_sha256, p_size, 1, p_device, p_manifest, now())
  on conflict (user_id, save_id) do update
    set title = excluded.title, sha256 = excluded.sha256, size = excluded.size, version = public.saves.version + 1,
        device = excluded.device, manifest = coalesce(excluded.manifest, public.saves.manifest), updated_at = now()
  returning version into v;
  return jsonb_build_object('version', v);
end $$;
grant execute on function public.lumos_put_save(text, text, text, bigint, integer, text, jsonb) to authenticated;
