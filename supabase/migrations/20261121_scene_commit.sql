-- REVIEW REQUIRED. Additive migration; do not rerun schema.sql on the existing project.
-- Atomic commit for snapshots already uploaded through Supabase Storage.
-- SECURITY DEFINER is the trusted, narrowly scoped save boundary. It checks
-- auth.uid()/can_edit_project before any operation and rejects cross-project IDs.
-- Direct snapshot-column UPDATE is revoked so callers cannot bypass revision checks.
begin;
create or replace function public.commit_forma_scene(
 p_project_id uuid, p_expected_revision bigint, p_scene_path text,
 p_scene_metadata jsonb, p_objects jsonb, p_thumbnail_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_project public.projects; next_revision bigint;
begin
 if auth.uid() is null or not public.can_edit_project(p_project_id) then
  raise exception 'Project editing permission required' using errcode='42501';
 end if;
 if p_expected_revision is null or p_expected_revision < 0 or
    jsonb_typeof(p_objects) is distinct from 'array' or
    jsonb_typeof(p_scene_metadata) is distinct from 'object' then
  raise exception 'Invalid scene commit';
 end if;
 if jsonb_array_length(p_objects)>1000 or
    split_part(p_scene_path,'/',1) is distinct from p_project_id::text or
    p_scene_path like '%..%' or p_scene_path not like '%/scenes/%.json' or
    (p_thumbnail_path is not null and (split_part(p_thumbnail_path,'/',1)<>p_project_id::text or p_thumbnail_path like '%..%')) then
  raise exception 'Invalid project storage path or object count';
 end if;
 select * into current_project from public.projects where id=p_project_id for update;
 if not found then raise exception 'Project not accessible' using errcode='42501'; end if;
 if current_project.scene_revision <> p_expected_revision then
  raise exception 'SCENE_CONFLICT: another user saved a newer revision' using errcode='P0001';
 end if;
 next_revision := current_project.scene_revision+1;
 if exists(select 1 from public.scene_objects s join jsonb_to_recordset(p_objects) as o(id uuid) on s.id=o.id where s.project_id<>p_project_id) then
  raise exception 'Object identifier belongs to a different project';
 end if;
 if (select count(*)<>count(distinct id) from jsonb_to_recordset(p_objects) as o(id uuid)) or
    exists(select 1 from jsonb_to_recordset(p_objects) as o(id uuid,parent_object_id uuid,name text,object_type text,transform jsonb,properties jsonb)
      where o.id is null or o.id=o.parent_object_id or o.name is null or length(o.name)>150 or
       o.object_type not in ('Cube','Sphere','Cylinder','Group') or o.object_type is null or
       jsonb_typeof(o.transform) is distinct from 'object' or jsonb_typeof(o.properties) is distinct from 'object') then
  raise exception 'Invalid scene object metadata';
 end if;
 if exists(select 1 from jsonb_to_recordset(p_objects) as o(id uuid,parent_object_id uuid)
   where o.parent_object_id is not null and not exists(select 1 from jsonb_to_recordset(p_objects) as p(id uuid) where p.id=o.parent_object_id)) then
  raise exception 'Scene parent is missing';
 end if;
 if exists(with recursive edges as (
   select * from jsonb_to_recordset(p_objects) as o(id uuid,parent_object_id uuid)
 ), walk as (
   select id,parent_object_id,array[id] as path,false as cycle from edges
   union all
   select w.id,e.parent_object_id,w.path||e.id,e.id=any(w.path)
   from walk w join edges e on e.id=w.parent_object_id where not w.cycle
 ) select 1 from walk where cycle) then raise exception 'Scene hierarchy cycle'; end if;
 -- Keep tombstones so existing comments/measurements retain valid foreign keys.
 update public.scene_objects set properties=properties||jsonb_build_object('present_in_scene',false,'scene_revision',next_revision)
 where project_id=p_project_id and id not in (select id from jsonb_to_recordset(p_objects) as o(id uuid));
 insert into public.scene_objects(id,project_id,parent_object_id,name,object_type,transform,properties,geometry_path)
 select id,p_project_id,parent_object_id,name,object_type,transform,
   properties||jsonb_build_object('present_in_scene',true,'scene_revision',next_revision),p_scene_path
 from jsonb_to_recordset(p_objects) as o(id uuid,parent_object_id uuid,name text,object_type text,transform jsonb,properties jsonb)
 on conflict(id) do update set parent_object_id=excluded.parent_object_id,name=excluded.name,
   object_type=excluded.object_type,transform=excluded.transform,properties=excluded.properties,geometry_path=excluded.geometry_path
 where public.scene_objects.project_id=p_project_id;
 update public.projects set scene_path=p_scene_path,thumbnail_path=coalesce(p_thumbnail_path,thumbnail_path),
   scene_revision=next_revision,scene_metadata=scene_metadata||p_scene_metadata
 where id=p_project_id returning * into current_project;
 return to_jsonb(current_project);
end;
$$;
revoke update(scene_path,thumbnail_path,scene_revision,scene_metadata) on public.projects from authenticated;
revoke all on function public.commit_forma_scene(uuid,bigint,text,jsonb,jsonb,text) from public,anon;
grant execute on function public.commit_forma_scene(uuid,bigint,text,jsonb,jsonb,text) to authenticated;
comment on function public.commit_forma_scene(uuid,bigint,text,jsonb,jsonb,text)
 is 'Atomically compare scene revision, synchronize searchable object metadata, and advance a private scene snapshot pointer. Review before deployment.';
notify pgrst, 'reload schema';
commit;
