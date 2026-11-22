-- Review and apply AFTER 20261121_scene_commit.sql. Never rerun schema.sql.
-- No deployed database was changed while preparing this file.
begin;

-- All project files become append-only for browser roles, including legacy paths.
-- RESTRICTIVE policies also constrain any existing permissive Storage policy.
-- Keep INSERT/SELECT: SDK uploads with upsert:false need no UPDATE permission.
create policy forma_projects_append_only_update on storage.objects
 as restrictive for update to anon, authenticated
 using (bucket_id <> 'forma-projects') with check (bucket_id <> 'forma-projects');
create policy forma_projects_append_only_delete on storage.objects
 as restrictive for delete to anon, authenticated using (bucket_id <> 'forma-projects');

-- Reject old uploads whose pre-hardening bytes may already have been overwritten.
-- Existing saved projects still load; only NEW commits require fresh uploads.
create schema forma_private;
revoke all on schema forma_private from public, anon, authenticated;
create table forma_private.scene_storage_epoch (
 singleton boolean primary key default true check (singleton),
 enabled_at timestamptz not null
);
insert into forma_private.scene_storage_epoch values (true, clock_timestamp());
revoke all on forma_private.scene_storage_epoch from public, anon, authenticated;

-- Immutable commit receipts preserve every path for future version history.
-- No FK to storage.objects: Storage's managed schema is not an application API.
create table public.scene_commits (
 project_id uuid not null references public.projects(id) on delete cascade,
 scene_revision bigint not null check (scene_revision > 0),
 scene_path text not null unique,
 storage_object_id uuid not null unique,
 storage_version text not null,
 storage_updated_at timestamptz not null,
 thumbnail_path text,
 thumbnail_object_id uuid,
 thumbnail_version text,
 scene_metadata jsonb not null check (jsonb_typeof(scene_metadata) = 'object'),
 committed_by uuid not null references public.profiles(id),
 committed_at timestamptz not null default clock_timestamp(),
 primary key (project_id, scene_revision)
);
alter table public.scene_commits enable row level security;
revoke all on public.scene_commits from public, anon, authenticated;
grant select on public.scene_commits to authenticated;
create policy scene_commits_read on public.scene_commits for select to authenticated
 using (public.can_read_project(project_id));

-- Table-level UPDATE revocation does NOT revoke column-level grants.
revoke insert, update, delete on public.scene_objects from public, anon, authenticated;
revoke update(name,parent_object_id,object_type,transform,properties,geometry_path)
 on public.scene_objects from public, anon, authenticated;
revoke update on public.projects from public, anon, authenticated;
revoke update(scene_path,thumbnail_path,scene_revision,scene_metadata)
 on public.projects from public, anon, authenticated;
-- Reassert only the editor's ordinary project-management updates.
grant update(name,description,status) on public.projects to authenticated;

-- INSERT was another pointer bypass: preserve create({owner_id,name,description,
-- scene_metadata:{category}}), but never allow a new project to claim a saved scene.
create policy projects_initial_scene on public.projects as restrictive
 for insert to authenticated with check (
 scene_path is null and thumbnail_path is null and scene_revision=0
 and (scene_metadata - 'category') = '{}'::jsonb
 and (not (scene_metadata ? 'category') or
      (jsonb_typeof(scene_metadata->'category')='string' and length(scene_metadata->>'category')<=100))
);

create or replace function public.commit_forma_scene(
 p_project_id uuid, p_expected_revision bigint, p_scene_path text,
 p_scene_metadata jsonb, p_objects jsonb, p_thumbnail_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 current_project public.projects;
 snapshot storage.objects;
 thumbnail storage.objects;
 epoch timestamptz;
 last_commit timestamptz;
 next_revision bigint;
 merged_metadata jsonb;
 o jsonb; vector jsonb;
begin
 if auth.uid() is null then
  raise exception 'Project editing permission required' using errcode='42501';
 end if;
 -- Lock BEFORE authorization/revision inspection. Concurrent saves serialize here.
 select * into current_project from public.projects where id=p_project_id for update;
 if not found then raise exception 'Project editing permission required' using errcode='42501'; end if;
 if current_project.owner_id <> auth.uid() then
  -- Lock membership so a concurrent demotion/removal cannot race this commit.
  perform 1 from public.project_members where project_id=p_project_id
   and user_id=auth.uid() and role='editor' for share;
  if not found then raise exception 'Project editing permission required' using errcode='42501'; end if;
 end if;
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>9007199254740990 then
  raise exception 'Invalid expected scene revision' using errcode='22023';
 end if;
 if current_project.scene_revision <> p_expected_revision then
  raise exception 'SCENE_CONFLICT: another user saved a newer revision' using errcode='P0001';
 end if;
 next_revision := current_project.scene_revision+1;
 -- Exact, case-sensitive paths generated by SceneService; NULL must fail explicitly.
 if p_scene_path is null or p_scene_path !~ (
  '^'||p_project_id::text||'/scenes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$') or
  (p_thumbnail_path is not null and p_thumbnail_path !~ (
  '^'||p_project_id::text||'/thumbnails/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$')) then
  raise exception 'Invalid project storage path' using errcode='22023';
 end if;
 if jsonb_typeof(p_objects) is distinct from 'array' or
    jsonb_typeof(p_scene_metadata) is distinct from 'object' then
  raise exception 'Invalid scene commit payload' using errcode='22023';
 end if;
 if jsonb_array_length(p_objects)>1000 or octet_length(p_objects::text)>4194304 or
    (p_scene_metadata - array['format','format_version','object_count']) <> '{}'::jsonb or
    p_scene_metadata->>'format' is distinct from 'forma3d-scene' or
    p_scene_metadata->'format_version' is distinct from '1'::jsonb or
    p_scene_metadata->'object_count' is distinct from to_jsonb(jsonb_array_length(p_objects)) then
  raise exception 'Invalid scene format, count or metadata keys' using errcode='22023';
 end if;

 select enabled_at into strict epoch from forma_private.scene_storage_epoch where singleton;
 select max(committed_at) into last_commit from public.scene_commits where project_id=p_project_id;
 -- Only read/lock Storage metadata. Never insert/update/delete storage.objects here.
 perform 1 from storage.buckets where id='forma-projects' and public=false for share;
 if not found then raise exception 'Private project bucket required' using errcode='22023'; end if;
 select * into snapshot from storage.objects
  where bucket_id='forma-projects' and name=p_scene_path for share;
 if not found then raise exception 'Scene snapshot is missing' using errcode='22023'; end if;
 if snapshot.version is null or snapshot.version='' or snapshot.created_at is null or
    snapshot.updated_at is null or snapshot.created_at > clock_timestamp() or snapshot.created_at <= epoch or
    snapshot.created_at <= coalesce(last_commit, epoch) or
    snapshot.metadata->>'mimetype' is distinct from 'application/json' or
    coalesce(snapshot.metadata->>'size','') !~ '^[0-9]{1,8}$' then
  raise exception 'Invalid or stale scene snapshot' using errcode='22023';
 end if;
 if (snapshot.metadata->>'size')::bigint not between 1 and 26214400 or
    exists(select 1 from public.scene_commits where scene_path=p_scene_path or storage_object_id=snapshot.id) or
    current_project.scene_path=p_scene_path then
  raise exception 'Invalid size or reused scene snapshot' using errcode='22023';
 end if;
 if p_thumbnail_path is not null then
  select * into thumbnail from storage.objects
   where bucket_id='forma-projects' and name=p_thumbnail_path for share;
  if not found then raise exception 'Thumbnail is missing' using errcode='22023'; end if;
  if thumbnail.created_at is null or thumbnail.updated_at is null or thumbnail.created_at > clock_timestamp() or
     thumbnail.created_at <= coalesce(last_commit,epoch) or thumbnail.version is null or thumbnail.version='' or
     thumbnail.metadata->>'mimetype' is distinct from 'image/png' or
     coalesce(thumbnail.metadata->>'size','') !~ '^[0-9]{1,8}$' then
   raise exception 'Invalid or stale thumbnail' using errcode='22023';
  end if;
  if (thumbnail.metadata->>'size')::bigint not between 1 and 10485760 then
   raise exception 'Invalid thumbnail size' using errcode='22023';
  end if;
 end if;

 -- Supported editor types: ShapeFactory's Cube/Sphere/Cylinder plus one-level Group.
 for o in select value from jsonb_array_elements(p_objects) loop
  if jsonb_typeof(o) is distinct from 'object' or
   coalesce(o->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
   jsonb_typeof(o->'name') is distinct from 'string' or length(btrim(o->>'name'))=0 or length(o->>'name')>150 or
   coalesce(o->>'object_type','') not in ('Cube','Sphere','Cylinder','Group') or
   jsonb_typeof(o->'transform') is distinct from 'object' or
   jsonb_typeof(o->'properties') is distinct from 'object' then
   raise exception 'Invalid scene object metadata' using errcode='22023';
  end if;
  if o->'parent_object_id' is not null and o->'parent_object_id'<>'null'::jsonb and
    coalesce(o->>'parent_object_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception 'Invalid parent identifier' using errcode='22023';
  end if;
  for vector in select o->'transform'->'position' union all select o->'transform'->'scale' loop
   if jsonb_typeof(vector) is distinct from 'array' then raise exception 'Invalid transform vector' using errcode='22023'; end if;
   if jsonb_array_length(vector)<>3 or exists(select 1 from jsonb_array_elements(vector) v where jsonb_typeof(v)<>'number') then
    raise exception 'Invalid transform vector' using errcode='22023';
   end if;
  end loop;
  vector:=o->'transform'->'rotation';
  if jsonb_typeof(vector) is distinct from 'array' then raise exception 'Invalid rotation' using errcode='22023'; end if;
  if jsonb_array_length(vector)<>4 or exists(select 1 from jsonb_array_elements(vector - 3) v where jsonb_typeof(v)<>'number') or
     coalesce(vector->>3,'') not in ('XYZ','XZY','YXZ','YZX','ZXY','ZYX') then
   raise exception 'Invalid rotation' using errcode='22023';
  end if;
 end loop;
 if (select count(*)<>count(distinct id) from jsonb_to_recordset(p_objects) as x(id uuid)) then
  raise exception 'Duplicate scene objects' using errcode='22023';
 end if;
 if exists(select 1 from public.scene_objects s join jsonb_to_recordset(p_objects) as x(id uuid) on x.id=s.id where s.project_id<>p_project_id) then
  raise exception 'Object identifier belongs to a different project' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_to_recordset(p_objects) as x(id uuid,parent_object_id uuid,object_type text)
  left join jsonb_to_recordset(p_objects) as parent(id uuid,parent_object_id uuid,object_type text) on parent.id=x.parent_object_id
  where x.parent_object_id is not null and (parent.id is null or parent.object_type<>'Group' or
   x.object_type='Group' or x.id=x.parent_object_id)) then
  raise exception 'Missing parent or invalid/cyclic scene hierarchy (one-level groups only)' using errcode='22023';
 end if;

 -- Tombstones retain referenced IDs, but detach stale parents to avoid false hierarchy.
 update public.scene_objects set parent_object_id=null,
  properties=properties||jsonb_build_object('present_in_scene',false,'scene_revision',next_revision)
 where project_id=p_project_id and id not in (select id from jsonb_to_recordset(p_objects) as x(id uuid));
 insert into public.scene_objects(id,project_id,parent_object_id,name,object_type,transform,properties,geometry_path)
 select id,p_project_id,parent_object_id,name,object_type,transform,
  properties||jsonb_build_object('present_in_scene',true,'scene_revision',next_revision),p_scene_path
 from jsonb_to_recordset(p_objects) as x(id uuid,parent_object_id uuid,name text,object_type text,transform jsonb,properties jsonb)
 on conflict(id) do update set parent_object_id=excluded.parent_object_id,name=excluded.name,
  object_type=excluded.object_type,transform=excluded.transform,properties=excluded.properties,geometry_path=excluded.geometry_path
 where public.scene_objects.project_id=p_project_id;
 -- A competing commit in ANOTHER project could win the same UUID after the precheck.
 if exists(select 1 from jsonb_to_recordset(p_objects) as x(id uuid)
  left join public.scene_objects s on s.id=x.id and s.project_id=p_project_id where s.id is null) then
  raise exception 'Object identifier belongs to a different project' using errcode='22023';
 end if;
 -- Surface deferred parent FK errors inside this call; every failure rolls back all DML.
 set constraints public.scene_objects_project_id_parent_object_id_fkey immediate;
 set constraints public.scene_objects_project_id_parent_object_id_fkey deferred;
 -- Preserve project-level metadata (category); replace ALL scene-owned keys, never
 -- let a caller merge arbitrary project settings or stale server-owned counts.
 merged_metadata := (current_project.scene_metadata - array['format','format_version','object_count']) ||
  jsonb_build_object('format','forma3d-scene','format_version',1,'object_count',jsonb_array_length(p_objects));
 insert into public.scene_commits(project_id,scene_revision,scene_path,storage_object_id,storage_version,
  storage_updated_at,thumbnail_path,thumbnail_object_id,thumbnail_version,scene_metadata,committed_by)
 values(p_project_id,next_revision,p_scene_path,snapshot.id,snapshot.version,snapshot.updated_at,
  coalesce(p_thumbnail_path,current_project.thumbnail_path),thumbnail.id,thumbnail.version,merged_metadata,auth.uid());
 update public.projects set scene_path=p_scene_path,thumbnail_path=coalesce(p_thumbnail_path,thumbnail_path),
  scene_revision=next_revision,scene_metadata=merged_metadata where id=p_project_id returning * into current_project;
 return to_jsonb(current_project);
end;
$$;
revoke all on function public.commit_forma_scene(uuid,bigint,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_forma_scene(uuid,bigint,text,jsonb,jsonb,text) to authenticated;
comment on function public.commit_forma_scene(uuid,bigint,text,jsonb,jsonb,text) is
 'Authorized atomic CAS scene commit. Private append-only Storage metadata checked; raw JSON bytes require trusted server validation. See SUPABASE.md.';
notify pgrst, 'reload schema';
commit;
