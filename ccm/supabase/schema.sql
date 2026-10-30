-- 수능 기도회 찬양 추천판: Supabase 스키마
-- 누구나(로그인 없이) 목록을 읽고 추천을 올릴 수 있고,
-- 지우기는 그 추천을 올린 브라우저(비밀 토큰을 가진 곳)만 할 수 있습니다.
-- 테이블에는 직접 쓰지 못하게 막고, 쓰기는 아래 함수로만 합니다.

create table if not exists public.ccm_songs (
  id uuid primary key default gen_random_uuid(),
  recommender text not null check (char_length(recommender) between 1 and 20),
  title text not null check (char_length(title) between 1 and 80),
  artist text not null default '' check (char_length(artist) <= 60),
  url text not null default '' check (char_length(url) <= 500 and (url = '' or url ~ '^https?://')),
  part smallint not null default 0 check (part between 0 and 5),
  note text not null default '' check (char_length(note) <= 200),
  picked boolean not null default false,
  created_by text check (char_length(created_by) <= 40),
  created_at timestamptz not null default now()
);

create table if not exists public.ccm_song_tokens (
  song_id uuid primary key references public.ccm_songs(id) on delete cascade,
  token_hash text not null
);

alter table public.ccm_songs enable row level security;
alter table public.ccm_song_tokens enable row level security;

drop policy if exists "anyone can read songs" on public.ccm_songs;
create policy "anyone can read songs" on public.ccm_songs
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.ccm_songs from anon, authenticated;
revoke all on public.ccm_song_tokens from anon, authenticated;

create or replace function public.ccm_add_song(
  p_recommender text, p_title text, p_artist text, p_url text,
  p_part int, p_note text, p_picked boolean, p_client text, p_token text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if char_length(coalesce(p_token, '')) < 16 then
    raise exception '잘못된 요청이에요';
  end if;
  if (select count(*) from public.ccm_songs) >= 2000 then
    raise exception '추천이 너무 많아요. 오래된 추천을 지워 주세요';
  end if;
  insert into public.ccm_songs (recommender, title, artist, url, part, note, picked, created_by)
  values (
    btrim(p_recommender), btrim(p_title), coalesce(btrim(p_artist), ''), coalesce(btrim(p_url), ''),
    coalesce(p_part, 0), coalesce(btrim(p_note), ''), coalesce(p_picked, false), left(p_client, 40)
  )
  returning id into v_id;
  insert into public.ccm_song_tokens (song_id, token_hash)
  values (v_id, encode(extensions.digest(p_token, 'sha256'), 'hex'));
  return v_id;
end $$;

create or replace function public.ccm_set_picked(p_ids uuid[], p_picked boolean)
returns void
language sql security definer set search_path = ''
as $$
  update public.ccm_songs set picked = coalesce(p_picked, false) where id = any(p_ids);
$$;

create or replace function public.ccm_delete_song(p_id uuid, p_token text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.ccm_songs s
  using public.ccm_song_tokens t
  where s.id = p_id and t.song_id = s.id
    and t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return found;
end $$;

revoke execute on function public.ccm_add_song(text, text, text, text, int, text, boolean, text, text) from public;
revoke execute on function public.ccm_set_picked(uuid[], boolean) from public;
revoke execute on function public.ccm_delete_song(uuid, text) from public;
grant execute on function public.ccm_add_song(text, text, text, text, int, text, boolean, text, text) to anon, authenticated;
grant execute on function public.ccm_set_picked(uuid[], boolean) to anon, authenticated;
grant execute on function public.ccm_delete_song(uuid, text) to anon, authenticated;
