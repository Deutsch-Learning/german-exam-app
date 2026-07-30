begin;

-- Fail before recording readiness if the production baseline is incomplete.
do $$
declare
  missing_tables text[];
  missing_columns text[];
begin
  select array_agg(required_table order by required_table)
    into missing_tables
    from unnest(array[
      'users', 'simulations', 'subscription_plans', 'user_subscriptions',
      'writing_simulator_usage', 'payment_transactions',
      'industrial_subscription_offers', 'subscription_admin_events',
      'affiliate_settings', 'affiliate_partners', 'affiliate_codes',
      'affiliate_referrals', 'affiliate_payouts', 'affiliate_commissions',
      'affiliate_events', 'affiliate_admin_events', 'refresh_tokens',
      'revoked_tokens', 'api_usage_logs', 'testimonials', 'email_events',
      'admin_audit_logs', 'exams', 'exam_questions', 'results',
      'copies_ecrites', 'statistiques', 'logs', 'exam_content',
      'exam_document_imports', 'exam_import_preferences', 'exam_sections',
      'exam_listening_audio_items', 'tts_voice_profiles', 'exam_audio_assets',
      'writing_corrections', 'writing_correction_tasks', 'ai_correction_logs',
      'speaking_provider_profiles', 'speaking_content_packs',
      'speaking_recordings', 'speaking_evaluations', 'content_style_templates'
    ]) as expected(required_table)
   where to_regclass(format('public.%I', required_table)) is null;

  if missing_tables is not null then
    raise exception 'Application schema is incomplete. Missing tables: %', array_to_string(missing_tables, ', ');
  end if;

  with expected(table_name, column_name) as (
    values
      ('users', 'auth_provider'),
      ('users', 'role'),
      ('users', 'status'),
      ('simulations', 'result_details'),
      ('simulations', 'duration_seconds'),
      ('exams', 'provider'),
      ('exams', 'section_type'),
      ('exams', 'series_number'),
      ('exams', 'metadata'),
      ('exam_questions', 'section_id'),
      ('exam_questions', 'question_type'),
      ('exam_questions', 'transcript'),
      ('exam_questions', 'audio'),
      ('exam_questions', 'scoring'),
      ('exam_questions', 'source_metadata'),
      ('exam_sections', 'global_duration_minutes'),
      ('exam_sections', 'listening_count'),
      ('exam_sections', 'audio_generation_status'),
      ('exam_listening_audio_items', 'voice_profile_map'),
      ('exam_listening_audio_items', 'published_at'),
      ('exam_listening_audio_items', 'approved_at'),
      ('exam_listening_audio_items', 'generation_log'),
      ('exam_audio_assets', 'audio_config'),
      ('exam_audio_assets', 'audio_data')
  )
  select array_agg(format('%I.%I', expected.table_name, expected.column_name)
                   order by expected.table_name, expected.column_name)
    into missing_columns
    from expected
   where not exists (
     select 1
       from information_schema.columns columns
      where columns.table_schema = 'public'
        and columns.table_name = expected.table_name
        and columns.column_name = expected.column_name
   );

  if missing_columns is not null then
    raise exception 'Application schema is incomplete. Missing columns: %', array_to_string(missing_columns, ', ');
  end if;
end
$$;

create schema if not exists app_private;
revoke all on schema app_private from public;

create table if not exists app_private.schema_versions (
  version text primary key,
  description text not null,
  applied_at timestamptz not null default now()
);

alter table app_private.schema_versions enable row level security;
revoke all on table app_private.schema_versions from public;

insert into app_private.schema_versions (version, description)
values ('20260730025449', 'Runtime schema initializers moved to versioned migrations')
on conflict (version) do update set description = excluded.description;

commit;
