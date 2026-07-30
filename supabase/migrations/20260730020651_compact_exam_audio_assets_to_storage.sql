begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

do $$
begin
  if to_regclass('public.exam_audio_assets_compact') is not null
     or to_regclass('public.exam_audio_assets_pre_storage_compaction') is not null then
    raise exception 'A previous exam audio compaction table still exists; inspect it before retrying.';
  end if;
end
$$;

create table public.exam_audio_assets_compact
  (like public.exam_audio_assets including defaults including storage including comments);

alter table public.exam_audio_assets_compact
  add constraint exam_audio_assets_compact_pkey primary key (id),
  add constraint exam_audio_assets_compact_content_hash_key unique (content_hash),
  add constraint exam_audio_assets_compact_source_exam_id_fkey
    foreign key (source_exam_id) references public.exams(id) on delete cascade,
  add constraint exam_audio_assets_compact_created_by_fkey
    foreign key (created_by) references public.users(id) on delete set null;

create index exam_audio_assets_compact_exam_idx
  on public.exam_audio_assets_compact (source_exam_id, updated_at desc);
create index exam_audio_assets_compact_status_idx
  on public.exam_audio_assets_compact (status, updated_at desc);

alter table public.exam_audio_assets_compact enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.exam_audio_assets_compact from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.exam_audio_assets_compact from authenticated;
  end if;
end
$$;

insert into public.exam_audio_assets_compact (
  id, source_exam_id, content_hash, provider, provider_model, voice_summary,
  audio_config, mime_type, audio_data, byte_size, duration_seconds, status,
  error_message, created_by, created_at, updated_at
)
select
  id, source_exam_id, content_hash, provider, provider_model, voice_summary,
  audio_config, mime_type,
  case
    when coalesce((audio_config->'storage'->>'verified')::boolean, false) then null
    else audio_data
  end,
  byte_size, duration_seconds, status, error_message, created_by, created_at, updated_at
from public.exam_audio_assets;

lock table public.exam_audio_assets in access exclusive mode;

delete from public.exam_audio_assets_compact compact
where not exists (
  select 1 from public.exam_audio_assets source where source.id = compact.id
);

insert into public.exam_audio_assets_compact (
  id, source_exam_id, content_hash, provider, provider_model, voice_summary,
  audio_config, mime_type, audio_data, byte_size, duration_seconds, status,
  error_message, created_by, created_at, updated_at
)
select
  source.id, source.source_exam_id, source.content_hash, source.provider,
  source.provider_model, source.voice_summary, source.audio_config, source.mime_type,
  case
    when coalesce((source.audio_config->'storage'->>'verified')::boolean, false) then null
    else source.audio_data
  end,
  source.byte_size, source.duration_seconds, source.status, source.error_message,
  source.created_by, source.created_at, source.updated_at
from public.exam_audio_assets source
left join public.exam_audio_assets_compact compact on compact.id = source.id
where compact.id is null or compact.updated_at is distinct from source.updated_at
on conflict (id) do update set
  source_exam_id = excluded.source_exam_id,
  content_hash = excluded.content_hash,
  provider = excluded.provider,
  provider_model = excluded.provider_model,
  voice_summary = excluded.voice_summary,
  audio_config = excluded.audio_config,
  mime_type = excluded.mime_type,
  audio_data = excluded.audio_data,
  byte_size = excluded.byte_size,
  duration_seconds = excluded.duration_seconds,
  status = excluded.status,
  error_message = excluded.error_message,
  created_by = excluded.created_by,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

do $$
declare
  source_count bigint;
  compact_count bigint;
  invalid_storage_rows bigint;
  invalid_historical_rows bigint;
begin
  select count(*) into source_count from public.exam_audio_assets;
  select count(*) into compact_count from public.exam_audio_assets_compact;
  if source_count <> compact_count then
    raise exception 'Audio compaction row-count mismatch: source %, compact %', source_count, compact_count;
  end if;

  select count(*) into invalid_storage_rows
  from public.exam_audio_assets source
  join public.exam_audio_assets_compact compact using (id)
  where coalesce((source.audio_config->'storage'->>'verified')::boolean, false)
    and (
      compact.audio_data is not null
      or compact.audio_config is distinct from source.audio_config
      or compact.byte_size is distinct from source.byte_size
      or compact.content_hash is distinct from source.content_hash
    );
  if invalid_storage_rows <> 0 then
    raise exception 'Audio compaction found % invalid migrated rows', invalid_storage_rows;
  end if;

  select count(*) into invalid_historical_rows
  from public.exam_audio_assets source
  join public.exam_audio_assets_compact compact using (id)
  where not coalesce((source.audio_config->'storage'->>'verified')::boolean, false)
    and (
      compact.audio_config is distinct from source.audio_config
      or compact.byte_size is distinct from source.byte_size
      or compact.content_hash is distinct from source.content_hash
      or octet_length(compact.audio_data) is distinct from octet_length(source.audio_data)
      or md5(compact.audio_data) is distinct from md5(source.audio_data)
    );
  if invalid_historical_rows <> 0 then
    raise exception 'Audio compaction found % invalid historical rows', invalid_historical_rows;
  end if;
end
$$;

alter sequence public.exam_audio_assets_id_seq owned by none;
alter table public.exam_audio_assets rename to exam_audio_assets_pre_storage_compaction;
alter table public.exam_audio_assets_compact rename to exam_audio_assets;

drop table public.exam_audio_assets_pre_storage_compaction;

alter table public.exam_audio_assets
  rename constraint exam_audio_assets_compact_pkey to exam_audio_assets_pkey;
alter table public.exam_audio_assets
  rename constraint exam_audio_assets_compact_content_hash_key to exam_audio_assets_content_hash_key;
alter table public.exam_audio_assets
  rename constraint exam_audio_assets_compact_source_exam_id_fkey to exam_audio_assets_source_exam_id_fkey;
alter table public.exam_audio_assets
  rename constraint exam_audio_assets_compact_created_by_fkey to exam_audio_assets_created_by_fkey;
alter index public.exam_audio_assets_compact_exam_idx rename to exam_audio_assets_exam_idx;
alter index public.exam_audio_assets_compact_status_idx rename to exam_audio_assets_status_idx;

alter sequence public.exam_audio_assets_id_seq owned by public.exam_audio_assets.id;
select setval(
  'public.exam_audio_assets_id_seq',
  greatest(coalesce((select max(id) from public.exam_audio_assets), 1), 1),
  true
);

commit;
