import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sceneObjectRows} from '../src/services/SceneSerializer.js';
import {ProjectService} from '../src/services/ProjectService.js';
import {AuthService} from '../src/services/AuthService.js';
import {SceneService} from '../src/services/SceneService.js';
import {projectCard} from '../src/components/ProjectCards.js';
import {matchRoute} from '../src/routing/Router.js';

// Real PostgreSQL SQL/PLpgSQL/ACL/RLS, isolated WASM engine. No network/credentials.
// auth/storage are minimal local stand-ins; these tests do not validate Storage HTTP
// or physical S3 bytes. The entire original application schema is loaded unchanged
// except pgcrypto installation (core gen_random_uuid is already available).
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const D='44444444-4444-4444-8444-444444444444';
const metadata={format:'forma3d-scene',format_version:1,object_count:1};
function object(id=crypto.randomUUID(),type='Cube',parent=null){
 return {id,parent_object_id:parent,name:type,object_type:type,
  transform:{position:[0,0,0],rotation:[0,0,0,'XYZ'],scale:[1,1,1]},
  properties:{editor_id:1,visible:true,locked:false,dimensions:{}}};
}

test('hardening migration executes against the original schema and enforces the commit boundary',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated;
   create schema auth; create schema storage; create schema extensions;
   create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth,storage to anon,authenticated;
   grant execute on function auth.uid() to anon,authenticated;
   create table storage.buckets(id text primary key,name text,public boolean);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,
    name text not null,version text default gen_random_uuid()::text,metadata jsonb,
    created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp(),unique(bucket_id,name));
   alter table storage.objects enable row level security;
   grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  await db.exec(schema.replace('create extension if not exists pgcrypto with schema extensions;','-- unavailable optional extension in WASM test engine'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261121_scene_commit.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261123_scene_commit_hardening.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users(id) values ($1),($2),($3),($4)',[A,B,C,D]);
  const as=async(user,fn,role='authenticated')=>db.transaction(async tx=>{
   await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user??'']);
   await tx.exec(`set local role ${role}`);return fn(tx);
  });
  const project=async()=>{
   const id=crypto.randomUUID();
   await as(A,tx=>tx.query("insert into public.projects(id,owner_id,name,scene_metadata) values($1,$2,'Test','{\"category\":\"Models\",\"custom\":\"blocked\"}')",[id,A])).then(
    ()=>assert.fail('project scene metadata bypass'),e=>assert.match(e.message,/row-level security/));
   await as(A,tx=>tx.query("insert into public.projects(id,owner_id,name,scene_metadata) values($1,$2,'Test','{\"category\":\"Models\"}')",[id,A]));
   await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'editor'),($1,$3,'viewer')",[id,B,C]);
   return id;
  };
  const upload=async(id,options={})=>{
   const path=options.path??`${id}/scenes/${crypto.randomUUID()}.json`;
   // Fixture-only metadata insertion simulates completed Storage API upload.
   await as(A,tx=>tx.query(`insert into storage.objects(bucket_id,name,metadata,version,created_at)
    values($1,$2,$3,$4,coalesce($5::timestamptz,clock_timestamp()))`,
    [options.bucket??'forma-projects',path,JSON.stringify(options.metadata??{mimetype:'application/json',size:100}),
     options.version===undefined?crypto.randomUUID():options.version,options.createdAt??null]));
   return path;
  };
  const commit=(id,path,objects=[object()],revision=0,user=A,extra={})=>as(user,tx=>tx.query(
   'select public.commit_forma_scene($1,$2,$3,$4,$5,$6) as project',
   [id,revision,path,JSON.stringify(extra.metadata??{...metadata,object_count:objects.length}),JSON.stringify(objects),extra.thumbnail??null]));
  const state=async id=>(await db.query('select scene_revision,scene_path,scene_metadata from public.projects where id=$1',[id])).rows[0];
  const rejectUnchanged=async(id,fn,pattern)=>{
   const before=await state(id);
   const objects=(await db.query('select * from public.scene_objects where project_id=$1 order by id',[id])).rows;
   const receipts=(await db.query('select * from public.scene_commits where project_id=$1 order by scene_revision',[id])).rows;
   await assert.rejects(fn,pattern);assert.deepEqual(await state(id),before);
   assert.deepEqual((await db.query('select * from public.scene_objects where project_id=$1 order by id',[id])).rows,objects);
   assert.deepEqual((await db.query('select * from public.scene_commits where project_id=$1 order by scene_revision',[id])).rows,receipts);
  };

  await t.test('INSERT RETURNING hits the stable project-read policy before the new row is visible',async()=>{
   const id=crypto.randomUUID();
   await assert.rejects(as(A,tx=>tx.query("insert into public.projects(id,owner_id,name,scene_metadata) values($1,$2,'Returning regression','{\"category\":\"Objects\"}') returning *",[id,A])),/new row violates row-level security/);
   assert.equal((await db.query('select id from public.projects where id=$1',[id])).rows.length,0);
   await as(A,tx=>tx.query("insert into public.projects(id,owner_id,name,scene_metadata) values($1,$2,'Returning regression','{\"category\":\"Objects\"}')",[id,A]));
   assert.equal((await as(A,tx=>tx.query('select id from public.projects where id=$1',[id]))).rows[0].id,id);
  });
  await t.test('ProjectService creates with real RLS, appears in My Projects, and resolves an editable new scene',async()=>{
   // Small SDK query adapter runs the production service against actual local RLS.
   // No simulated successful INSERT: chaining select() recreates the regression.
   const clientFor=user=>({auth:{
    getSession:async()=>({data:{session:user?{user:{id:user}}:null},error:null}),
    getUser:async()=>({data:{user:user?{id:user}:null},error:null})
   },from(table){
    assert.equal(table,'projects');let payload,returning=false,single=false;const filters=[];
    const query={insert(value){payload=value;return query;},select(){returning=true;return query;},
     eq(key,value){assert.ok(['id','owner_id'].includes(key));filters.push([key,value]);return query;},
     order(){return query;},limit(){return query;},single(){single=true;return query;},maybeSingle(){single=true;return query;},
     then(resolve,reject){return as(user,async tx=>{
      if(payload){
       const entries=Object.entries(payload);
       assert.ok(entries.every(([key])=>['id','owner_id','name','description','scene_path','thumbnail_path','scene_revision','scene_metadata'].includes(key)));
       const result=await tx.query(`insert into public.projects(${entries.map(([key])=>key).join(',')}) values(${entries.map((_,i)=>`$${i+1}`).join(',')})${returning?' returning *':''}`,
        entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value));
       return{data:returning?result.rows[0]:null,error:null};
      }
      const result=await tx.query(`select p.*,(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role)),'[]') from public.project_members m where m.project_id=p.id) as project_members from public.projects p${filters.length?' where '+filters.map(([key],i)=>`p.${key}=$${i+1}`).join(' and '):''}`,filters.map(([,value])=>value));
      return{data:single?result.rows[0]??null:result.rows,error:null};
     }).catch(error=>({data:null,error})).then(resolve,reject);}
    };return query;
   }});
   const client=clientFor(A),projects=new ProjectService({client,auth:new AuthService({client})});
   for(const category of ['Objects','Product','Architecture','']){
    const created=await projects.create({name:`  My ${category||'uncategorized'} study  `,description:'  Description retained  ',category,owner_id:B});
    assert.equal(created.owner_id,A);assert.equal(created.name,`My ${category||'uncategorized'} study`);
    assert.equal(created.description,'Description retained');assert.equal(created.scene_path,null);
    assert.equal(created.thumbnail_path,null);assert.equal(created.scene_revision,0);
    assert.deepEqual(created.scene_metadata,category?{category}:{});
    const listed=(await projects.list({filter:'personal'})).find(row=>row.id===created.id);
    assert.ok(listed);const card=projectCard(listed);
    assert.ok(card.includes(`href="/editor/${created.id}"`));assert.ok(card.includes(created.name));
    assert.ok(card.includes('Description retained'));
    const route=matchRoute(`/editor/${created.id}`),opened=await projects.get(route.params.projectId);
    assert.equal(route.path,'/editor/:projectId');assert.equal(opened.canEdit,true);assert.equal(opened.role,'owner');
    assert.equal(await new SceneService({client}).load(opened),null); // Editor starts its normal initial scene.
    const other=clientFor(B),otherProjects=new ProjectService({client:other,auth:new AuthService({client:other})});
    assert.equal(await otherProjects.get(created.id),null);
   }
   const deniedId=crypto.randomUUID();
   await assert.rejects(as(A,tx=>tx.query("insert into public.projects(id,owner_id,name,scene_path,thumbnail_path,scene_revision,scene_metadata) values($1,$2,'Foreign owner',null,null,0,'{\"category\":\"Objects\"}')",[deniedId,B])),/row-level security/);
   assert.equal((await db.query('select 1 from public.projects where id=$1',[deniedId])).rows.length,0);
   const anonymous=clientFor(null);
   await assert.rejects(new ProjectService({client:anonymous,auth:new AuthService({client:anonymous})}).create({name:'Anonymous'}),/sign in/);
  });

  await t.test('anonymous, viewer and unrelated users cannot commit; editor can',async()=>{
   const id=await project(),path=await upload(id);
   await assert.rejects(as(null,tx=>tx.query('select public.commit_forma_scene($1,0,$2,$3,$4,null)',[id,path,JSON.stringify(metadata),'[]']),'anon'),/permission denied/);
   for(const user of [null,C,D])await rejectUnchanged(id,()=>commit(id,path,undefined,0,user),/permission required/);
   const saved=await commit(id,path,undefined,0,B);assert.equal(saved.rows[0].project.scene_revision,1);
   assert.equal((await as(D,tx=>tx.query('select * from public.scene_commits'))).rows.length,0);
   assert.equal((await as(C,tx=>tx.query('select * from public.scene_commits where project_id=$1',[id]))).rows.length,1);
  });
  await t.test('direct table/column writes and initial pointer injection are denied',async()=>{
   const id=await project();
   for(const sql of [
    'insert into public.scene_objects(project_id,name,object_type) values($1,\'Bypass\',\'Cube\')',
    "update public.scene_objects set name='Bypass' where project_id=$1",
    'delete from public.scene_objects where project_id=$1',
    'update public.projects set scene_revision=99 where id=$1',
    'update public.projects set scene_metadata=\'{}\' where id=$1',
    'delete from public.scene_commits where project_id=$1'])
    await assert.rejects(as(A,tx=>tx.query(sql,[id])),/permission denied/);
   await assert.rejects(as(A,tx=>tx.query("insert into public.projects(owner_id,name,scene_path) values($1,'Bypass','fake')",[A])),/row-level security/);
   await as(B,tx=>tx.query("update public.projects set name='Renamed',description='Works',status='archived' where id=$1",[id]));
  });
  await t.test('null, empty, malformed, missing, foreign and wrong-bucket paths fail',async()=>{
   const id=await project();
   for(const path of [null,'',' ',`${id}/scenes/current.json`,`${id}/scenes/../x.json`,`${id}/scenes/${crypto.randomUUID()}.json?x=1`,`${crypto.randomUUID()}/scenes/${crypto.randomUUID()}.json`])
    await rejectUnchanged(id,()=>commit(id,path),/Invalid project storage path/);
   await rejectUnchanged(id,()=>commit(id,`${id}/scenes/${crypto.randomUUID()}.json`),/snapshot is missing/);
   const wrong=`${id}/scenes/${crypto.randomUUID()}.json`;
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('forma-assets',$1,'{\"mimetype\":\"application/json\",\"size\":100}')",[wrong]);
   await rejectUnchanged(id,()=>commit(id,wrong),/snapshot is missing/);
  });
  await t.test('snapshot metadata, private bucket, thumbnail existence and upload freshness are checked',async()=>{
   const id=await project();
   for(const options of [{metadata:{mimetype:'text/plain',size:100}},{metadata:{mimetype:'application/json',size:0}},{metadata:{mimetype:'application/json',size:26214401}},{metadata:{mimetype:'application/json',size:'NaN'}},{metadata:null,version:null},{version:null},{createdAt:'2000-01-01'}]){
    const path=await upload(id,options);await rejectUnchanged(id,()=>commit(id,path),/Invalid.*snapshot|Invalid size/);
   }
   const path=await upload(id);
   await db.exec("update storage.buckets set public=true where id='forma-projects'");
   try{await rejectUnchanged(id,()=>commit(id,path),/Private project bucket/);}finally{await db.exec("update storage.buckets set public=false where id='forma-projects'");}
   await rejectUnchanged(id,()=>commit(id,path,undefined,0,A,{thumbnail:`${id}/thumbnails/${crypto.randomUUID()}.png`}),/Thumbnail is missing/);
  });
  await t.test('snapshots cannot be overwritten, moved, deleted or reused; history retains old paths',async()=>{
   const id=await project(),early=await upload(id),path=await upload(id);
   await commit(id,path);
   for(const user of [A,B]){
    assert.equal((await as(user,tx=>tx.query("update storage.objects set metadata='{}' where name=$1 returning id",[path]))).rows.length,0);
    assert.equal((await as(user,tx=>tx.query('delete from storage.objects where name=$1 returning id',[path]))).rows.length,0);
   }
   await assert.rejects(as(A,tx=>tx.query("insert into storage.objects(bucket_id,name) values('forma-projects',$1)",[path])),/duplicate key/);
   await rejectUnchanged(id,()=>commit(id,path,undefined,1),/stale|reused/);
   await rejectUnchanged(id,()=>commit(id,early,undefined,1),/stale/);
   const next=await upload(id);await commit(id,next,[],1);
   const receipts=(await db.query('select scene_path from public.scene_commits where project_id=$1 order by scene_revision',[id])).rows;
   assert.deepEqual(receipts.map(row=>row.scene_path),[path,next]);
   assert.equal((await db.query('select 1 from storage.objects where name=$1',[path])).rows.length,1);
  });
  await t.test('cross-project IDs, duplicates, unknown types, malformed transforms and cycles roll back',async()=>{
   const first=await project(),foreign=object();await commit(first,await upload(first),[foreign]);
   const id=await project(),path=await upload(id),duplicate=object(),group=object(undefined,'Group'),other=object(undefined,'Group');
   for(const [objects,pattern] of [
    [[foreign],/different project/],[[duplicate,duplicate],/Duplicate/],[[object(undefined,'Cone')],/Invalid scene object/],
    [[{...object(),name:' '}],/Invalid scene object/],[[{...object(),transform:{}}],/Invalid transform/],
    [[object(undefined,'Cube',crypto.randomUUID())],/Missing parent/],
    [[{...group,parent_object_id:group.id}],/cyclic/],
    [[{...group,parent_object_id:other.id},{...other,parent_object_id:group.id}],/cyclic/],
    [[{...object(),transform:{position:[0,null,0],scale:[1,1,1],rotation:[0,0,0,'XYZ']}}],/Invalid transform/]
   ])await rejectUnchanged(id,()=>commit(id,path,objects),pattern);
  });
  await t.test('frontend rows, child-before-parent FKs, tombstones and scene metadata synchronization',async()=>{
   const id=await project(),parent=crypto.randomUUID(),child=crypto.randomUUID();
   const scene={objects:[{persistentId:child,parentId:parent,type:'Cylinder',name:'Edited cylinder',position:[1,2,3],rotation:[0,0,0,'XYZ'],scale:[1,2,1],id:2,visible:true,locked:false,dimensions:{radius:1,height:2}},
    {persistentId:parent,parentId:null,type:'Group',name:'Group',position:[0,0,0],rotation:[0,0,0,'XYZ'],scale:[1,1,1],id:1,visible:true,locked:false,dimensions:{}}]};
   await commit(id,await upload(id),sceneObjectRows(scene));
   assert.deepEqual((await state(id)).scene_metadata,{category:'Models',format:'forma3d-scene',format_version:1,object_count:2});
   // Existing comment/measurement FKs must survive an object's removal.
   await db.query("insert into public.project_comments(project_id,object_id,author_id,content) values($1,$2,$3,'Keep')",[id,child,A]);
   const path=await upload(id);
   await rejectUnchanged(id,()=>commit(id,path,[],1,A,{metadata:{...metadata,object_count:0,category:'Hijack'}}),/metadata keys/);
   await rejectUnchanged(id,()=>commit(id,path,[],1,A,{metadata:{...metadata,object_count:999}}),/metadata keys/);
   await commit(id,path,[],1);
   const removed=(await db.query('select parent_object_id,properties from public.scene_objects where project_id=$1',[id])).rows;
   assert.ok(removed.every(row=>row.parent_object_id===null&&row.properties.present_in_scene===false&&row.properties.scene_revision===2));
   assert.equal((await state(id)).scene_metadata.object_count,0);
   assert.equal((await db.query('select 1 from public.project_comments where project_id=$1',[id])).rows.length,1);
  });
  await t.test('competing expected revisions have one winner (single-connection engine; live lock test separate)',async()=>{
   const id=await project(),paths=[await upload(id),await upload(id)];
   const results=await Promise.allSettled(paths.map(path=>commit(id,path)));
   assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
   assert.match(results.find(x=>x.status==='rejected').reason.message,/SCENE_CONFLICT/);
   assert.equal((await state(id)).scene_revision,1);
   assert.equal((await db.query('select 1 from public.scene_commits where project_id=$1',[id])).rows.length,1);
  });
  await t.test('late receipt failure rolls back upserts, tombstones and the project pointer together',async()=>{
   const id=await project();await commit(id,await upload(id));
   const path=await upload(id);
   await db.exec(`create function forma_private.reject_test_receipt() returns trigger language plpgsql as
    $$begin raise exception 'Injected late receipt failure'; end$$;
    create trigger reject_test_receipt before insert on public.scene_commits
    for each row execute function forma_private.reject_test_receipt();`);
   try {await rejectUnchanged(id,()=>commit(id,path,[],1),/Injected late receipt failure/);}
   finally {await db.exec('drop trigger reject_test_receipt on public.scene_commits; drop function forma_private.reject_test_receipt();');}
   await commit(id,path,[],1);assert.equal((await state(id)).scene_revision,2);
  });
  await t.test('optional PNG previews save once and remain attached when a later save omits a preview',async()=>{
   const id=await project(),thumbnail=`${id}/thumbnails/${crypto.randomUUID()}.png`;
   await upload(id,{path:thumbnail,metadata:{mimetype:'image/png',size:200}});
   const saved=await commit(id,await upload(id),[],0,A,{thumbnail});
   assert.equal(saved.rows[0].project.thumbnail_path,thumbnail);
   const next=await commit(id,await upload(id),[],1);
   assert.equal(next.rows[0].project.thumbnail_path,thumbnail);
   assert.deepEqual((await db.query('select thumbnail_path from public.scene_commits where project_id=$1 order by scene_revision',[id])).rows,
    [{thumbnail_path:thumbnail},{thumbnail_path:thumbnail}]);
  });
  await t.test('function uses an empty search_path and authenticated-only EXECUTE',async()=>{
   const row=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') as anon,has_function_privilege('authenticated',oid,'EXECUTE') as authenticated from pg_proc where proname='commit_forma_scene'")).rows[0];
   assert.equal(row.prosecdef,true);assert.ok(row.proconfig.includes('search_path=""'));
   assert.equal(row.anon,false);assert.equal(row.authenticated,true);
  });
 } finally {await db.close();}
});
