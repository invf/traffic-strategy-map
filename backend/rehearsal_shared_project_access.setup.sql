-- ADV-002B native-Postgres rehearsal setup - replicates, verbatim, the
-- CONFIRMED real Production schema shape (per ADV-002B's own ticket) plus
-- this milestone's new, not-yet-applied migrations, against a disposable
-- PostgreSQL 18 instance. No Docker, no Supabase, no PostgREST needed for
-- the parts this rehearsal covers (direct-pg, GUC-based RLS) - see the
-- rehearsal script's own header for what this intentionally does NOT
-- cover (PostgREST/auth.uid()-based behavior on public.strategies, which
-- stays structurally unchanged by this milestone and is proven via a
-- before/after pg_policies snapshot instead of a live PostgREST call).

create extension if not exists pgcrypto;

create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());

create schema if not exists adveser_core;
create schema if not exists launch_studio;

-- Roles created early, before any CREATE POLICY ... TO <role> below
-- references them by name. Roles are CLUSTER-wide (not dropped by
-- `DROP DATABASE`), so this script drops them first for repeatability
-- across reruns against a fresh database in the same cluster.
drop role if exists traffic_strategy_map_app;
drop role if exists launch_studio_app;
create role traffic_strategy_map_app login;
create role launch_studio_app login;

-- ============================================================
-- Confirmed-existing shared schema (0003, already in Production)
-- ============================================================
create table adveser_core.projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table adveser_core.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references adveser_core.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','collaborator')),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id),
  unique (project_id, user_id)
);
create unique index project_members_one_owner on adveser_core.project_members (project_id) where role = 'owner';

create table adveser_core.project_products (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references adveser_core.projects(id) on delete cascade,
  product text not null check (product in ('launch_studio','traffic_strategy_map','earn_studio')),
  linked_by uuid not null references auth.users(id),
  linked_at timestamptz not null default now(),
  unique (project_id, product)
);

create table adveser_core.user_product_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (product in ('launch_studio','traffic_strategy_map','earn_studio')),
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  unique (user_id, product)
);

create function adveser_core.is_project_member(p_project_id uuid, p_user_id uuid)
returns boolean language sql security definer set search_path = adveser_core, pg_catalog stable as $$
  select exists (select 1 from adveser_core.project_members where project_id = p_project_id and user_id = p_user_id);
$$;

create function adveser_core.is_project_owner(p_project_id uuid, p_user_id uuid)
returns boolean language sql security definer set search_path = adveser_core, pg_catalog stable as $$
  select exists (select 1 from adveser_core.projects where id = p_project_id and owner_user_id = p_user_id);
$$;

alter table adveser_core.projects enable row level security;
alter table adveser_core.project_members enable row level security;
alter table adveser_core.project_products enable row level security;
alter table adveser_core.user_product_entitlements enable row level security;

create policy projects_select on adveser_core.projects for select using (
  owner_user_id = current_setting('app.current_user_id', true)::uuid
  or adveser_core.is_project_member(id, current_setting('app.current_user_id', true)::uuid)
);
create policy projects_insert on adveser_core.projects for insert with check (owner_user_id = current_setting('app.current_user_id', true)::uuid);
create policy projects_update on adveser_core.projects for update
  using (adveser_core.is_project_member(id, current_setting('app.current_user_id', true)::uuid))
  with check (adveser_core.is_project_member(id, current_setting('app.current_user_id', true)::uuid));

create policy project_members_select on adveser_core.project_members for select using (adveser_core.is_project_member(project_id, current_setting('app.current_user_id', true)::uuid));
create policy project_members_insert on adveser_core.project_members for insert with check (adveser_core.is_project_owner(project_id, current_setting('app.current_user_id', true)::uuid));
create policy project_members_update on adveser_core.project_members for update
  using (adveser_core.is_project_owner(project_id, current_setting('app.current_user_id', true)::uuid))
  with check (adveser_core.is_project_owner(project_id, current_setting('app.current_user_id', true)::uuid));
create policy project_members_delete on adveser_core.project_members for delete using (adveser_core.is_project_owner(project_id, current_setting('app.current_user_id', true)::uuid));

create policy project_products_member on adveser_core.project_products for all
  using (adveser_core.is_project_member(project_id, current_setting('app.current_user_id', true)::uuid))
  with check (adveser_core.is_project_member(project_id, current_setting('app.current_user_id', true)::uuid));

-- BOTH entitlement policies, exactly as confirmed to coexist in real
-- Production (ADV-002A-R1's reconciliation) - this is the crux of
-- requirement 6's empirical proof below.
create policy user_product_entitlements_self on adveser_core.user_product_entitlements for select
  using (user_id = current_setting('app.current_user_id', true)::uuid);
create policy traffic_strategy_map_app_entitlement_read on adveser_core.user_product_entitlements for select
  to traffic_strategy_map_app
  using (product = 'traffic_strategy_map');

-- ============================================================
-- Confirmed-existing launch_studio.workspace_revisions (0004) - minimal
-- shape, just enough to be a valid FK target for approved_analysis_exports
-- ============================================================
create table launch_studio.workspace_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references adveser_core.projects(id) on delete cascade,
  revision bigint not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  unique (project_id, revision)
);

-- ============================================================
-- NEW (ADV-002B, this rehearsal's actual subject): 0007
-- ============================================================
create table launch_studio.approved_analysis_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references adveser_core.projects(id) on delete cascade,
  source_revision_id uuid not null references launch_studio.workspace_revisions(id),
  schema_version integer not null default 1,
  product_intelligence jsonb not null,
  promotion_intelligence jsonb,
  approved_at timestamptz not null default now(),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, source_revision_id)
);
alter table launch_studio.approved_analysis_exports enable row level security;
create policy approved_analysis_exports_member on launch_studio.approved_analysis_exports for all
  using (adveser_core.is_project_member(project_id, current_setting('app.current_user_id', true)::uuid))
  with check (adveser_core.is_project_member(project_id, current_setting('app.current_user_id', true)::uuid));

-- ============================================================
-- Confirmed-existing public.strategies (AUTH-003C/AUTH-004, already in
-- Production) + NEW (ADV-002B) project_id/source_launch_analysis_id +
-- the idempotency index
-- ============================================================
-- auth.uid() stub - reads the SAME GUC shape Supabase/PostgREST really
-- uses (a JWT claim relayed via a GUC); not exercised by this rehearsal's
-- own tests (which go through traffic_strategy_map_app/launch_studio_app
-- directly, never as `authenticated`), defined only so public.strategies'
-- existing policies are syntactically valid in this disposable database.
-- Defined BEFORE the policies below that reference it.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nodes jsonb, edges jsonb, product_info jsonb, ai_suggestions jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  is_demo boolean not null default false
);
alter table public.strategies enable row level security;
create policy "read own or approved demo" on public.strategies for select using (is_demo = true or (user_id is not null and user_id = auth.uid()));
create policy "insert own" on public.strategies for insert with check (user_id = auth.uid() and is_demo = false);
create policy "update own" on public.strategies for update using (user_id = auth.uid() and is_demo = false) with check (user_id = auth.uid() and is_demo = false);
create policy "delete own" on public.strategies for delete using (user_id = auth.uid() and is_demo = false);

-- The NEW ADV-002B columns/index on public.strategies are applied
-- SEPARATELY by apply_linkage_migration.sql, run by the rehearsal script
-- itself AFTER it snapshots pg_policies here - this is what makes the
-- "no changes to existing strategy RLS" proof a real before/after
-- comparison, not just an assertion.

-- ============================================================
-- Grants - traffic_strategy_map_app's EXISTING entitlement/quota grants
-- PLUS this milestone's new grants; launch_studio_app with just enough
-- to prove the export table's immutability. (Both roles were already
-- created earlier, before the policies above that reference them by name.)
-- ============================================================
grant usage on schema adveser_core to traffic_strategy_map_app;
grant select on adveser_core.user_product_entitlements to traffic_strategy_map_app; -- pre-existing
-- NEW (ADV-002B migration 1):
grant select on adveser_core.projects to traffic_strategy_map_app;
grant select on adveser_core.project_members to traffic_strategy_map_app;
grant select on adveser_core.project_products to traffic_strategy_map_app;
grant execute on function adveser_core.is_project_member(uuid,uuid) to traffic_strategy_map_app;
grant execute on function adveser_core.is_project_owner(uuid,uuid) to traffic_strategy_map_app;
grant execute on function pg_catalog.set_config(text,text,boolean) to traffic_strategy_map_app;
-- NEW (ADV-002B migration 3):
grant usage on schema launch_studio to traffic_strategy_map_app;
grant select on launch_studio.approved_analysis_exports to traffic_strategy_map_app;
-- Pre-existing public-schema grants (for the strategies concurrency test
-- below, via direct pg rather than PostgREST - sufficient to prove the
-- unique index's mechanics, which are a property of the table, not of
-- which role/path writes to it):
grant usage on schema public to traffic_strategy_map_app;
grant select, insert on public.strategies to traffic_strategy_map_app;

grant usage on schema launch_studio to launch_studio_app;
grant select, insert on launch_studio.approved_analysis_exports to launch_studio_app; -- no update/delete, by design
grant usage on schema adveser_core to launch_studio_app;
grant execute on function adveser_core.is_project_member(uuid,uuid) to launch_studio_app;
grant execute on function pg_catalog.set_config(text,text,boolean) to launch_studio_app;
