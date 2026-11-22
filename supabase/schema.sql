-- Forma3D / Supabase PostgreSQL schema v1.0
-- Run ONCE in a NEW Supabase project using SQL Editor.
-- 19 application tables (excluding Supabase auth/storage system tables).
-- No DROP TABLE / destructive reset operations.
-- File operations must go through Supabase Storage API, not direct storage.objects inserts.

begin;
create extension if not exists pgcrypto with schema extensions;

-- 1) Shared helpers ---------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;

-- 2) Identity and project membership ---------------------------------------
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username varchar(50) unique,
 full_name varchar(150), avatar_path text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint username_format check (username is null or username ~ '^[a-zA-Z0-9_]{3,50}$')
);

create table public.projects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 name varchar(150) not null check (length(btrim(name)) > 0),
 description text, status text not null default 'active' check (status in ('active','archived')),
 scene_path text, thumbnail_path text,
 scene_revision bigint not null default 0 check (scene_revision >= 0),
 scene_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(scene_metadata) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, owner_id)
);

create table public.project_members (
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check (role in ('editor','viewer')),
 joined_at timestamptz not null default now(),
 primary key (project_id, user_id)
);

-- SECURITY DEFINER to avoid RLS recursion when membership/project policies
-- refer to one another. Hard-coded schema names and fixed search_path.
create or replace function public.can_read_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.projects p where p.id = p_project_id
   and (p.owner_id = (select auth.uid()) or exists (
     select 1 from public.project_members m
     where m.project_id = p.id and m.user_id = (select auth.uid()))));
$$;

create or replace function public.can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.projects p where p.id = p_project_id
   and (p.owner_id = (select auth.uid()) or exists (
     select 1 from public.project_members m where m.project_id = p.id
       and m.user_id = (select auth.uid()) and m.role = 'editor')));
$$;

create or replace function public.owns_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.projects p where p.id = p_project_id and p.owner_id = (select auth.uid()));
$$;

create table public.project_invitations (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 invited_by uuid not null references public.profiles(id),
 invitee_email varchar(255) not null check (position('@' in invitee_email) > 1),
 role text not null check (role in ('editor','viewer')),
 token_hash text not null unique,
 status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);

-- 3) Scene, versions, asset catalog -----------------------------------------
create table public.project_versions (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 version_number integer not null check (version_number > 0),
 created_by uuid not null references public.profiles(id),
 snapshot_path text not null,
 scene_revision bigint not null check (scene_revision >= 0),
 description text,
 created_at timestamptz not null default now(),
 unique (project_id, version_number), unique (project_id, id)
);

create table public.asset_categories (
 id uuid primary key default gen_random_uuid(),
 name varchar(100) not null unique,
 slug varchar(100) not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 created_at timestamptz not null default now()
);

create table public.assets (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 category_id uuid references public.asset_categories(id) on delete set null,
 name varchar(150) not null check (length(btrim(name)) > 0),
 asset_type text not null check (asset_type in ('model','texture','material','image','other')),
 file_format varchar(20), file_path text not null,
 thumbnail_path text, size_bytes bigint check (size_bytes is null or size_bytes >= 0),
 visibility text not null default 'private' check (visibility in ('private','public')),
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.scene_objects (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 parent_object_id uuid,
 name varchar(150) not null,
 object_type varchar(50) not null,
 transform jsonb not null default '{"position":[0,0,0],"rotation":[0,0,0],"scale":[1,1,1]}'::jsonb
   check (jsonb_typeof(transform) = 'object'),
 properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties) = 'object'),
 geometry_path text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (project_id, id),
 foreign key (project_id, parent_object_id) references public.scene_objects(project_id, id)
   on delete no action deferrable initially deferred,
 check (parent_object_id is distinct from id)
);
-- Application must additionally prevent INDIRECT parent hierarchy cycles.

-- 4) AI ---------------------------------------------------------------------
create table public.ai_models (
 id uuid primary key default gen_random_uuid(),
 name varchar(100) not null,
 version varchar(100) not null,
 provider varchar(60) not null default 'ollama',
 base_model varchar(100),
 deployment_type text not null default 'local' check (deployment_type in ('local','hosted')),
 description text,
 metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique (provider, name, version)
);

create table public.ai_conversations (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 title varchar(150), created_at timestamptz not null default now(),
 unique (id, project_id)
);

create table public.ai_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
 sender_id uuid references public.profiles(id),
 role text not null check (role in ('user','assistant','system','tool')),
 content text not null,
 model_id uuid references public.ai_models(id) on delete set null,
 context_snapshot jsonb,
 created_at timestamptz not null default now(),
 check (context_snapshot is null or jsonb_typeof(context_snapshot) = 'object')
);

create table public.ai_actions (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references public.ai_messages(id) on delete cascade,
 target_object_id uuid, -- optional UUID; execution service validates project ownership
 action_type varchar(80) not null,
 parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
 execution_result jsonb,
 status text not null default 'proposed' check (status in ('proposed','approved','executed','failed','rejected')),
 user_feedback text check (user_feedback in ('positive','negative') or user_feedback is null),
 execution_order integer not null default 0 check (execution_order >= 0),
 created_at timestamptz not null default now(), executed_at timestamptz,
 check (execution_result is null or jsonb_typeof(execution_result) = 'object')
);

-- 5) Collaboration, measurements, validation --------------------------------
create table public.project_comments (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 author_id uuid not null references public.profiles(id),
 object_id uuid,
 content text not null check (length(btrim(content)) > 0),
 resolved boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (project_id, object_id) references public.scene_objects(project_id,id)
   on delete no action deferrable initially deferred
);

create table public.measurements (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 object_id uuid,
 created_by uuid not null references public.profiles(id),
 kind text not null check (kind in ('distance','angle','area','volume')),
 measured_value double precision check (measured_value is null or measured_value >= 0),
 unit varchar(20) not null,
 anchors jsonb not null default '[]'::jsonb check (jsonb_typeof(anchors) = 'array'),
 scene_revision bigint not null check (scene_revision >= 0),
 created_at timestamptz not null default now(),
 foreign key (project_id, object_id) references public.scene_objects(project_id,id)
   on delete no action deferrable initially deferred
);

create table public.validation_reports (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 version_id uuid,
 generated_by uuid not null references public.profiles(id),
 scene_revision bigint not null check (scene_revision >= 0),
 status text not null default 'completed' check (status in ('pending','completed','failed')),
 summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
 issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
 created_at timestamptz not null default now(),
 foreign key (project_id, version_id) references public.project_versions(project_id,id)
);

-- 6) Gallery ----------------------------------------------------------------
create table public.gallery_posts (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 version_id uuid not null,
 author_id uuid not null references public.profiles(id),
 title varchar(150) not null check (length(btrim(title)) > 0),
 description text,
 thumbnail_path text,
 public_snapshot_path text,
 status text not null default 'draft' check (status in ('draft','published','unlisted')),
 published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (project_id, version_id) references public.project_versions(project_id,id),
 check (status <> 'published' or (public_snapshot_path is not null and published_at is not null))
);

create table public.gallery_likes (
 post_id uuid not null references public.gallery_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (post_id, user_id)
);

create table public.gallery_comments (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.gallery_posts(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 content text not null check (length(btrim(content)) > 0),
 created_at timestamptz not null default now()
);

-- 7) Activity audit ---------------------------------------------------------
create table public.project_activity_logs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 action_type varchar(80) not null,
 target_id uuid, metadata jsonb not null default '{}'::jsonb
   check (jsonb_typeof(metadata) = 'object'),
 created_at timestamptz not null default now()
);

-- 8) Auth -> Profile trigger ------------------------------------------------
create or replace function public.handle_new_forma_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id, full_name)
 values(new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name',''),150))
 on conflict (id) do nothing;
 return new;
end; $$;

drop trigger if exists on_forma_auth_user_created on auth.users;
create trigger on_forma_auth_user_created after insert on auth.users
for each row execute function public.handle_new_forma_user();

-- 9) updated_at triggers ----------------------------------------------------
do $$ declare t text; begin
 foreach t in array array['profiles','projects','scene_objects','assets','project_comments','gallery_posts'] loop
  execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', 'touch_'||t, t);
 end loop;
end $$;

-- 10) Indexes ---------------------------------------------------------------
create index projects_owner_idx on public.projects(owner_id, updated_at desc);
create index members_user_idx on public.project_members(user_id);
create index invitations_project_idx on public.project_invitations(project_id, status);
create unique index invitations_one_pending_idx on public.project_invitations(project_id, lower(invitee_email)) where status = 'pending';
create index versions_project_idx on public.project_versions(project_id, version_number desc);
create index objects_project_idx on public.scene_objects(project_id);
create index assets_owner_idx on public.assets(owner_id);
create index assets_category_idx on public.assets(category_id);
create index ai_conversations_project_idx on public.ai_conversations(project_id);
create index ai_messages_conversation_idx on public.ai_messages(conversation_id, created_at);
create index ai_actions_message_idx on public.ai_actions(message_id);
create index comments_project_idx on public.project_comments(project_id, created_at desc);
create index measurements_project_idx on public.measurements(project_id);
create index reports_project_idx on public.validation_reports(project_id, created_at desc);
create index gallery_status_idx on public.gallery_posts(status, published_at desc);
create index gallery_author_idx on public.gallery_posts(author_id);
create index gallery_likes_user_idx on public.gallery_likes(user_id);
create index gallery_comments_post_idx on public.gallery_comments(post_id);
create index activity_project_idx on public.project_activity_logs(project_id, created_at desc);

-- 11) RLS on every application table ----------------------------------------
do $$ declare t text; begin
 foreach t in array array[
 'profiles','projects','project_members','project_invitations','project_versions',
 'asset_categories','assets','scene_objects','ai_models','ai_conversations',
 'ai_messages','ai_actions','project_comments','measurements','validation_reports',
 'gallery_posts','gallery_likes','gallery_comments','project_activity_logs'
 ] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on table public.%I from anon, authenticated', t);
 end loop;
end $$;

-- Default: no public grants. Explicitly grant only needed operations.
grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update(username,full_name,avatar_path) on public.profiles to authenticated;

grant select, insert, delete on public.projects to authenticated;
grant update(name,description,status,scene_path,thumbnail_path,scene_revision,scene_metadata) on public.projects to authenticated;
grant select, insert, update(role), delete on public.project_members to authenticated;
grant select on public.project_invitations to authenticated; -- invite creation/acceptance via trusted backend only
grant select, insert on public.project_versions to authenticated;
grant select on public.asset_categories to anon, authenticated;
grant select, insert, delete on public.assets to authenticated;
grant update(name,category_id,thumbnail_path,visibility,metadata) on public.assets to authenticated;
grant select, insert, delete on public.scene_objects to authenticated;
grant update(name,parent_object_id,object_type,transform,properties,geometry_path) on public.scene_objects to authenticated;
grant select on public.ai_models to authenticated;
grant select, insert on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select on public.ai_actions to authenticated; -- server writes approved/executed results
grant select, insert, delete on public.project_comments to authenticated;
grant update(content,resolved) on public.project_comments to authenticated;
grant select, insert, delete on public.measurements to authenticated;
grant select on public.validation_reports to authenticated; -- trusted backend writes reports
grant select on public.gallery_posts to anon, authenticated;
grant insert, delete on public.gallery_posts to authenticated;
grant update(title,description,thumbnail_path,public_snapshot_path,status,published_at,version_id) on public.gallery_posts to authenticated;
grant select on public.gallery_likes to anon, authenticated;
grant insert, delete on public.gallery_likes to authenticated;
grant select on public.gallery_comments to anon, authenticated;
grant insert, delete on public.gallery_comments to authenticated;
grant select on public.project_activity_logs to authenticated;

-- restrict function invocation intentionally
revoke all on function public.handle_new_forma_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.can_read_project(uuid) from public;
revoke all on function public.can_edit_project(uuid) from public;
revoke all on function public.owns_project(uuid) from public;
grant execute on function public.can_read_project(uuid), public.can_edit_project(uuid), public.owns_project(uuid) to authenticated;

-- Policies: profiles --------------------------------------------------------
create policy profiles_read on public.profiles for select to anon,authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
 using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Policies: projects --------------------------------------------------------
create policy projects_read on public.projects for select to authenticated using (public.can_read_project(id));
create policy projects_create on public.projects for insert to authenticated with check (owner_id = (select auth.uid()));
create policy projects_update on public.projects for update to authenticated using (public.can_edit_project(id)) with check (public.can_edit_project(id));
create policy projects_delete on public.projects for delete to authenticated using (public.owns_project(id));

create policy members_read on public.project_members for select to authenticated using (public.can_read_project(project_id));
create policy members_add on public.project_members for insert to authenticated
 with check (public.owns_project(project_id) and user_id <> (select auth.uid()));
create policy members_change on public.project_members for update to authenticated
 using (public.owns_project(project_id)) with check (public.owns_project(project_id));
create policy members_remove on public.project_members for delete to authenticated
 using (public.owns_project(project_id) or user_id = (select auth.uid()));

create policy invitations_owner_read on public.project_invitations for select to authenticated
 using (public.owns_project(project_id));

create policy versions_read on public.project_versions for select to authenticated using (public.can_read_project(project_id));
create policy versions_create on public.project_versions for insert to authenticated
 with check (public.can_edit_project(project_id) and created_by = (select auth.uid()));

create policy categories_read on public.asset_categories for select to anon,authenticated using (true);
create policy assets_read on public.assets for select to authenticated
 using (owner_id = (select auth.uid()) or visibility = 'public');
create policy assets_create on public.assets for insert to authenticated with check (owner_id = (select auth.uid()));
create policy assets_update on public.assets for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy assets_delete on public.assets for delete to authenticated using (owner_id = (select auth.uid()));

create policy objects_read on public.scene_objects for select to authenticated using (public.can_read_project(project_id));
create policy objects_create on public.scene_objects for insert to authenticated with check (public.can_edit_project(project_id));
create policy objects_update on public.scene_objects for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy objects_delete on public.scene_objects for delete to authenticated using (public.can_edit_project(project_id));

create policy ai_models_read on public.ai_models for select to authenticated using (is_active);
create policy ai_conversations_read on public.ai_conversations for select to authenticated
 using (user_id = (select auth.uid()) and public.can_read_project(project_id));
create policy ai_conversations_create on public.ai_conversations for insert to authenticated
 with check (user_id = (select auth.uid()) and public.can_read_project(project_id));
create policy ai_messages_read on public.ai_messages for select to authenticated
 using (exists(select 1 from public.ai_conversations c where c.id = conversation_id
  and c.user_id = (select auth.uid()) and public.can_read_project(c.project_id)));
create policy ai_messages_user_create on public.ai_messages for insert to authenticated
 with check (role = 'user' and sender_id = (select auth.uid()) and model_id is null
 and exists(select 1 from public.ai_conversations c where c.id = conversation_id
  and c.user_id = (select auth.uid()) and public.can_read_project(c.project_id)));
create policy ai_actions_read on public.ai_actions for select to authenticated
 using (exists(select 1 from public.ai_messages m join public.ai_conversations c
  on c.id = m.conversation_id where m.id = message_id
  and c.user_id = (select auth.uid()) and public.can_read_project(c.project_id)));

create policy project_comments_read on public.project_comments for select to authenticated
 using (public.can_read_project(project_id));
create policy project_comments_create on public.project_comments for insert to authenticated
 with check (author_id = (select auth.uid()) and public.can_read_project(project_id));
create policy project_comments_update on public.project_comments for update to authenticated
 using (author_id = (select auth.uid()) and public.can_read_project(project_id))
 with check (author_id = (select auth.uid()) and public.can_read_project(project_id));
create policy project_comments_delete on public.project_comments for delete to authenticated
 using (author_id = (select auth.uid()) or public.owns_project(project_id));

create policy measurements_read on public.measurements for select to authenticated
 using (public.can_read_project(project_id));
create policy measurements_create on public.measurements for insert to authenticated
 with check (created_by = (select auth.uid()) and public.can_edit_project(project_id));
create policy measurements_delete on public.measurements for delete to authenticated
 using (public.can_edit_project(project_id));
create policy reports_read on public.validation_reports for select to authenticated
 using (public.can_read_project(project_id));

create policy gallery_posts_read_public on public.gallery_posts for select to anon,authenticated
 using (status = 'published' or (select auth.uid()) = author_id);
create policy gallery_posts_create on public.gallery_posts for insert to authenticated
 with check (author_id = (select auth.uid()) and public.owns_project(project_id));
create policy gallery_posts_update on public.gallery_posts for update to authenticated
 using (author_id = (select auth.uid()) and public.owns_project(project_id))
 with check (author_id = (select auth.uid()) and public.owns_project(project_id));
create policy gallery_posts_delete on public.gallery_posts for delete to authenticated
 using (author_id = (select auth.uid()) and public.owns_project(project_id));

create policy gallery_likes_read on public.gallery_likes for select to anon,authenticated
 using (exists(select 1 from public.gallery_posts g where g.id = post_id and g.status = 'published'));
create policy gallery_likes_create on public.gallery_likes for insert to authenticated
 with check (user_id = (select auth.uid()) and exists
  (select 1 from public.gallery_posts g where g.id = post_id and g.status = 'published'));
create policy gallery_likes_delete on public.gallery_likes for delete to authenticated
 using (user_id = (select auth.uid()));
create policy gallery_comments_read on public.gallery_comments for select to anon,authenticated
 using (exists(select 1 from public.gallery_posts g where g.id = post_id and g.status = 'published'));
create policy gallery_comments_create on public.gallery_comments for insert to authenticated
 with check (user_id = (select auth.uid()) and exists
  (select 1 from public.gallery_posts g where g.id = post_id and g.status = 'published'));
create policy gallery_comments_delete on public.gallery_comments for delete to authenticated
 using (user_id = (select auth.uid()));

create policy activity_read on public.project_activity_logs for select to authenticated
 using (public.can_read_project(project_id));

-- 12) Buckets. All private: RLS permits published gallery downloads only. ---
insert into storage.buckets(id,name,public)
 values ('forma-projects','forma-projects',false),
        ('forma-assets','forma-assets',false),
        ('forma-gallery','forma-gallery',false)
on conflict (id) do nothing;

-- Storage paths must start: <project_uuid>/..., <owner_uuid>/..., <post_uuid>/...
-- UUID parser returns null for malformed prefixes instead of throwing errors.
create or replace function public.forma_path_uuid(p_name text) returns uuid
language sql immutable set search_path = '' as $$
 select case when split_part(p_name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then split_part(p_name,'/',1)::uuid else null::uuid end;
$$;
revoke all on function public.forma_path_uuid(text) from public;
grant execute on function public.forma_path_uuid(text) to anon,authenticated;

create policy forma_projects_storage_read on storage.objects for select to authenticated
 using (bucket_id='forma-projects' and public.can_read_project(public.forma_path_uuid(name)));
create policy forma_projects_storage_insert on storage.objects for insert to authenticated
 with check (bucket_id='forma-projects' and public.can_edit_project(public.forma_path_uuid(name)));
create policy forma_projects_storage_update on storage.objects for update to authenticated
 using (bucket_id='forma-projects' and public.can_edit_project(public.forma_path_uuid(name)))
 with check (bucket_id='forma-projects' and public.can_edit_project(public.forma_path_uuid(name)));
create policy forma_projects_storage_delete on storage.objects for delete to authenticated
 using (bucket_id='forma-projects' and public.owns_project(public.forma_path_uuid(name)));

create policy forma_assets_storage_read on storage.objects for select to authenticated
 using (bucket_id='forma-assets' and public.forma_path_uuid(name)=(select auth.uid()));
create policy forma_assets_storage_public_read on storage.objects for select to authenticated
 using (bucket_id='forma-assets' and exists (select 1 from public.assets a
  where a.file_path = name and a.visibility='public'));
create policy forma_assets_storage_insert on storage.objects for insert to authenticated
 with check (bucket_id='forma-assets' and public.forma_path_uuid(name)=(select auth.uid()));
create policy forma_assets_storage_update on storage.objects for update to authenticated
 using (bucket_id='forma-assets' and public.forma_path_uuid(name)=(select auth.uid()))
 with check (bucket_id='forma-assets' and public.forma_path_uuid(name)=(select auth.uid()));
create policy forma_assets_storage_delete on storage.objects for delete to authenticated
 using (bucket_id='forma-assets' and public.forma_path_uuid(name)=(select auth.uid()));

-- Published gallery files only; author can upload files while preparing draft.
-- Upload path: <gallery_post_uuid>/snapshot.glb or <gallery_post_uuid>/thumb.png
create policy forma_gallery_storage_public_read on storage.objects for select to anon,authenticated
 using (bucket_id='forma-gallery' and exists(select 1 from public.gallery_posts g
  where g.id = public.forma_path_uuid(name) and g.status = 'published'));
create policy forma_gallery_storage_author_read on storage.objects for select to authenticated
 using (bucket_id='forma-gallery' and exists(select 1 from public.gallery_posts g
  where g.id = public.forma_path_uuid(name) and g.author_id=(select auth.uid())
   and public.owns_project(g.project_id)));
create policy forma_gallery_storage_insert on storage.objects for insert to authenticated
 with check (bucket_id='forma-gallery' and exists(select 1 from public.gallery_posts g
  where g.id = public.forma_path_uuid(name) and g.author_id=(select auth.uid())
   and g.status='draft' and public.owns_project(g.project_id)));
create policy forma_gallery_storage_update on storage.objects for update to authenticated
 using (bucket_id='forma-gallery' and exists(select 1 from public.gallery_posts g
  where g.id = public.forma_path_uuid(name) and g.author_id=(select auth.uid())
   and g.status='draft' and public.owns_project(g.project_id)))
 with check (bucket_id='forma-gallery' and exists(select 1 from public.gallery_posts g
  where g.id = public.forma_path_uuid(name) and g.author_id=(select auth.uid())
   and g.status='draft' and public.owns_project(g.project_id)));
create policy forma_gallery_storage_delete on storage.objects for delete to authenticated
 using (bucket_id='forma-gallery' and exists(select 1 from public.gallery_posts g
  where g.id = public.forma_path_uuid(name) and g.author_id=(select auth.uid())
   and public.owns_project(g.project_id)));

commit;

-- IMPORTANT deployment notes:
-- 1) Invitation issuance/acceptance, AI assistant message/action execution,
--    validation report creation, and audit log writing are trusted BACKEND tasks.
--    Use a server-only secret/service-role key with server-side authorization.
-- 2) If you allow collaborators to edit scenes, implement optimistic concurrency
--    (compare-and-swap scene_revision) in a server RPC / backend. Plain UPDATE
--    is NOT safe against simultaneous saves.
-- 3) A gallery copy must be SANITIZED before publishing (no private URLs/metadata).
-- 4) Project files may be downloaded by collaborators; only upload files that
--    are appropriate for the project collaborators to access.
-- 5) Upload project snapshots to forma-projects/<project_id>/... and private
--    personal assets to forma-assets/<user_id>/... via the Storage SDK.
-- 6) Avoid using owner-only private asset paths inside shared projects; copy
--    the relevant asset into the project-scoped bucket instead.
-- 7) Browser writes to projects.scene_revision are restricted by RLS row scope,
--    but NOT by expected revision; route actual saves through an atomic API.
-- 8) Security/test audit required before production deployment, including
--    RLS checks for anon, owner, editor, viewer and unrelated users.
-- 9) The 19 tables cover application metadata; mesh geometry and scene
--    snapshots belong in Storage, not a row-per-vertex schema.
