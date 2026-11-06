-- Lumos Cloud on Supabase — run in the SQL editor of a new project.
-- Tables are protected by Row Level Security: every user only ever sees their own rows.
-- The client (src/services/cloud/supabaseAdapter.js) uses the public anon key + user JWT.

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  version    integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  version    integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.saves (
  user_id    uuid not null references auth.users(id) on delete cascade,
  save_id    text not null check (save_id ~ '^[A-Za-z0-9_.-]{1,96}$'),
  title      text not null,
  sha256     text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size       bigint not null,
  version    integer not null default 1,
  device     text,
  updated_at timestamptz not null default now(),
  primary key (user_id, save_id)
);

create table if not exists public.entitlements (
  user_id    uuid not null references auth.users(id) on delete cascade,
  sku        text not null,
  title      text not null,
  kind       text not null default 'free',
  granted_at timestamptz not null default now(),
  primary key (user_id, sku)
);

create table if not exists public.devices (
  user_id   uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  name      text not null,
  model     text,
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.profiles     enable row level security;
alter table public.settings     enable row level security;
alter table public.saves        enable row level security;
alter table public.entitlements enable row level security;
alter table public.devices      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'settings', 'saves', 'devices'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- entitlements: users may read their own and claim only free items; purchases are inserted by the
-- store backend with the service-role key (which bypasses RLS).
drop policy if exists "read own" on public.entitlements;
create policy "read own" on public.entitlements for select using (auth.uid() = user_id);
drop policy if exists "claim free" on public.entitlements;
create policy "claim free" on public.entitlements for insert with check (auth.uid() = user_id and kind = 'free');
drop policy if exists "refresh free" on public.entitlements;
create policy "refresh free" on public.entitlements for update using (auth.uid() = user_id and kind = 'free') with check (auth.uid() = user_id and kind = 'free');

-- Optimistic-concurrency write for profile/settings documents.
create or replace function public.lumos_put_doc(p_table text, p_data jsonb, p_version integer)
returns jsonb language plpgsql security invoker as $$
declare cur integer; v integer; ts timestamptz;
begin
  if p_table not in ('profiles', 'settings') then raise exception 'invalid table'; end if;
  execute format('select version from public.%I where user_id = auth.uid() for update', p_table) into cur;
  if cur is null then
    if coalesce(p_version, 0) <> 0 then return jsonb_build_object('conflict', true, 'version', 0); end if;
    execute format('insert into public.%I (user_id, data, version) values (auth.uid(), $1, 1) returning version, updated_at', p_table) into v, ts using p_data;
  else
    if p_version is distinct from cur then return jsonb_build_object('conflict', true, 'version', cur); end if;
    execute format('update public.%I set data = $1, version = version + 1, updated_at = now() where user_id = auth.uid() returning version, updated_at', p_table) into v, ts using p_data;
  end if;
  return jsonb_build_object('version', v, 'updated_at', ts);
end $$;

create or replace function public.lumos_put_save(p_save_id text, p_title text, p_sha256 text, p_size bigint, p_base_version integer, p_device text)
returns jsonb language plpgsql security invoker as $$
declare cur integer; v integer;
begin
  select version into cur from public.saves where user_id = auth.uid() and save_id = p_save_id for update;
  if cur is not null and p_base_version is not null and p_base_version <> cur then
    return jsonb_build_object('conflict', true, 'version', cur);
  end if;
  insert into public.saves (user_id, save_id, title, sha256, size, version, device, updated_at)
  values (auth.uid(), p_save_id, p_title, p_sha256, p_size, 1, p_device, now())
  on conflict (user_id, save_id) do update
    set title = excluded.title, sha256 = excluded.sha256, size = excluded.size, version = public.saves.version + 1, device = excluded.device, updated_at = now()
  returning version into v;
  return jsonb_build_object('version', v);
end $$;

grant execute on function public.lumos_put_doc(text, jsonb, integer) to authenticated;
grant execute on function public.lumos_put_save(text, text, text, bigint, integer, text) to authenticated;

-- Storage bucket for save archives: objects live under "<user id>/<save id>.tar.gz".
insert into storage.buckets (id, name, public, file_size_limit)
values ('saves', 'saves', false, 268435456)
on conflict (id) do nothing;

drop policy if exists "lumos saves own folder" on storage.objects;
create policy "lumos saves own folder" on storage.objects for all
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text);
