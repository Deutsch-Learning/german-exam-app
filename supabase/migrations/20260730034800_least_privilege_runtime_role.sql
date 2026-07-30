-- The application login is created separately with a generated password. This
-- group role carries only runtime DML privileges and can never own schema objects.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'german_exam_app_runtime') then
    create role german_exam_app_runtime
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$$;

alter role german_exam_app_runtime
  nologin
  nocreatedb
  nocreaterole
  noinherit;

do $$
begin
  if exists (
    select 1
      from pg_roles
     where rolname = 'german_exam_app_runtime'
       and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolcanlogin)
  ) then
    raise exception 'german_exam_app_runtime has unsafe role attributes';
  end if;
end
$$;

grant connect on database postgres to german_exam_app_runtime;
grant usage on schema public, app_private to german_exam_app_runtime;
revoke create on schema public, app_private from german_exam_app_runtime;

grant select, insert, update, delete on all tables in schema public to german_exam_app_runtime;
grant usage, select on all sequences in schema public to german_exam_app_runtime;
grant execute on all functions in schema public to german_exam_app_runtime;
grant select on app_private.schema_versions to german_exam_app_runtime;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to german_exam_app_runtime;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to german_exam_app_runtime;
alter default privileges for role postgres in schema public
  grant execute on functions to german_exam_app_runtime;

do $$
declare
  runtime_table record;
begin
  for runtime_table in
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    if not exists (
      select 1
        from pg_policy p
       where p.polrelid = format('public.%I', runtime_table.table_name)::regclass
         and p.polname = 'german_exam_app_runtime_all'
    ) then
      execute format(
        'create policy german_exam_app_runtime_all on public.%I for all to german_exam_app_runtime using (true) with check (true)',
        runtime_table.table_name
      );
    end if;
  end loop;
end
$$;

drop policy if exists german_exam_app_runtime_read on app_private.schema_versions;
create policy german_exam_app_runtime_read
  on app_private.schema_versions
  for select
  to german_exam_app_runtime
  using (true);

insert into app_private.schema_versions (version, description)
values ('20260730034800', 'Least-privilege server runtime role and explicit RLS policies')
on conflict (version) do update
set description = excluded.description,
    applied_at = now();
