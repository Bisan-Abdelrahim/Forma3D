import * as THREE from 'three';
import {SceneService,SceneConflictError} from '../src/services/SceneService.js';
import {sceneObjectRows} from '../src/services/SceneSerializer.js';
// Opt-in live test: uses two existing, disposable test users. Never creates accounts.
// Run only after reviewing/applying the scene-commit migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {ProjectService} from '../src/services/ProjectService.js';
import {AuthService} from '../src/services/AuthService.js';
const enabled=process.env.FORMA_INTEGRATION_RUN==='1';
test('live Supabase owner/editor/viewer/isolation and project CRUD', {skip:!enabled},async t=>{
 const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
 for(const name of ['FORMA_TEST_EMAIL_A','FORMA_TEST_PASSWORD_A','FORMA_TEST_EMAIL_B','FORMA_TEST_PASSWORD_B'])assert.ok(process.env[name],`${name} must be set locally`);
 const create=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const a=create(),b=create(),authA=new AuthService({client:a}),authB=new AuthService({client:b});let project;
 try{
  const [sessionA,sessionB]=await Promise.all([a.auth.signInWithPassword({email:process.env.FORMA_TEST_EMAIL_A,password:process.env.FORMA_TEST_PASSWORD_A}),b.auth.signInWithPassword({email:process.env.FORMA_TEST_EMAIL_B,password:process.env.FORMA_TEST_PASSWORD_B})]);
  assert.ifError(sessionA.error);assert.ifError(sessionB.error);assert.notEqual(sessionA.data.user.id,sessionB.data.user.id);
  const projectsA=new ProjectService({client:a,auth:authA}),projectsB=new ProjectService({client:b,auth:authB});
  project=await projectsA.create({name:`Forma3D integration ${Date.now()}`,description:'Creation RLS regression',category:'Architecture'});
  assert.equal(project.owner_id,sessionA.data.user.id);
  assert.equal(project.description,'Creation RLS regression');assert.equal(project.scene_path,null);
  assert.equal(project.thumbnail_path,null);assert.equal(project.scene_revision,0);
  assert.deepEqual(project.scene_metadata,{category:'Architecture'});
  assert.ok((await projectsA.list({filter:'personal'})).some(row=>row.id===project.id));
  const editable=await projectsA.get(project.id);assert.equal(editable.canEdit,true);
  const foreignOwner=await a.from('projects').insert({owner_id:sessionB.data.user.id,name:'Forbidden ownership',
   scene_path:null,thumbnail_path:null,scene_revision:0,scene_metadata:{category:'Objects'}});
  assert.equal(foreignOwner.error?.code,'42501');
  const commitArgs={p_project_id:project.id,p_expected_revision:0,p_scene_path:null,
   p_scene_metadata:{format:'forma3d-scene',format_version:1,object_count:0},p_objects:[],p_thumbnail_path:null};
  assert.equal((await b.rpc('commit_forma_scene',commitArgs)).error?.code,'42501');
  assert.equal((await create().rpc('commit_forma_scene',commitArgs)).error?.code,'42501');
  assert.equal(await projectsB.get(project.id),null);
  const blocked=await b.storage.from('forma-projects').upload(`${project.id}/unrelated.json`,new Blob(['{}']));assert.ok(blocked.error);
  const membership=await a.from('project_members').insert({project_id:project.id,user_id:sessionB.data.user.id,role:'viewer'});assert.ifError(membership.error);
  assert.equal((await projectsB.get(project.id)).canEdit,false);
  assert.equal((await b.rpc('commit_forma_scene',commitArgs)).error?.code,'42501');
  const denied=await b.from('projects').update({name:'Forbidden'}).eq('id',project.id).select('id');assert.ok(denied.error||!denied.data.length);
  const promote=await a.from('project_members').update({role:'editor'}).eq('project_id',project.id).eq('user_id',sessionB.data.user.id);assert.ifError(promote.error);
  await projectsB.update(project.id,{name:'Updated by editor'});
  const deniedDelete=await b.from('projects').delete().eq('id',project.id).select('id');assert.ok(deniedDelete.error||!deniedDelete.data.length);
  const geometry=new THREE.BufferGeometry().copy(new THREE.BoxGeometry(2,2,2));
  const scene={format:'forma3d-scene',version:1,objects:[{id:1,persistentId:crypto.randomUUID(),type:'Cube',name:'Saved cube',parentId:null,position:[1,2,3],rotation:[0,0,0,'XYZ'],scale:[1,1,1],visible:true,locked:false,dimensions:{width:2,height:2,depth:2},geometry:geometry.toJSON(),materials:[new THREE.MeshStandardMaterial().toJSON()]}],nameCounts:{Cube:1,Sphere:0,Cylinder:0,Group:0},nextObjectId:2,selectedIds:[1]};
  const scenesA=new SceneService({client:a}),scenesB=new SceneService({client:b});
  const results=await Promise.allSettled([scenesA.save(project,scene),scenesA.save(project,scene)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected'&&result.reason instanceof SceneConflictError).length,1);
  const latest=await projectsA.get(project.id);assert.equal(latest.scene_revision,1);
  const reopened=await scenesB.load(latest);assert.deepEqual(reopened.objects[0].position,[1,2,3]);
  assert.deepEqual(reopened.objects[0].geometry.data.attributes.position.array,scene.objects[0].geometry.data.attributes.position.array);
  const metadata=await a.from('scene_objects').select('id,parent_object_id,properties').eq('project_id',project.id);assert.ifError(metadata.error);assert.equal(metadata.data[0].id,scene.objects[0].persistentId);
  // These exercise the deployed Storage HTTP service, unlike local SQL fixtures.
  const bucket=a.storage.from('forma-projects');
  assert.ok((await bucket.update(latest.scene_path,new Blob(['{}'],{type:'application/json'}))).error);
  assert.ok((await bucket.upload(latest.scene_path,new Blob(['{}'],{type:'application/json'}),{upsert:true})).error);
  const removal=await bucket.remove([latest.scene_path]);
  assert.ok(removal.error||removal.data.length===0);
  assert.deepEqual((await scenesA.load(latest)).objects[0].position,[1,2,3]);
  for(const operation of [
   a.from('scene_objects').insert({...sceneObjectRows(scene)[0],id:crypto.randomUUID(),project_id:project.id}),
   a.from('scene_objects').update({name:'Bypass'}).eq('project_id',project.id),
   a.from('scene_objects').delete().eq('project_id',project.id),
   a.from('projects').update({scene_revision:99}).eq('id',project.id)
  ])assert.equal((await operation).error?.code,'42501');
  const badPath=`${project.id}/scenes/${crypto.randomUUID()}.json`;
  assert.ifError((await bucket.upload(badPath,new Blob(['not JSON'],{type:'text/plain'}),{contentType:'text/plain',upsert:false})).error);
  const invalid=await a.rpc('commit_forma_scene',{...commitArgs,p_expected_revision:1,p_scene_path:badPath,
   p_scene_metadata:{...commitArgs.p_scene_metadata,object_count:1},p_objects:sceneObjectRows(scene)});
  assert.equal(invalid.error?.code,'22023');
  assert.equal((await projectsA.get(project.id)).scene_revision,1);
  await authB.logout();assert.equal(await authB.getCurrentUser(),null);
 }finally{
  if(project){
   // Append-only protection intentionally denies owner cleanup too. A trusted
   // Storage API maintenance task must clean this disposable prefix later.
   t.diagnostic(`Trusted Storage cleanup required for forma-projects/${project.id}/ (test uploads retained)`);
   const cleanup=await a.from('projects').delete().eq('id',project.id);assert.ifError(cleanup.error);
  }
  await Promise.all([a.auth.signOut(),b.auth.signOut()]);
 }
});
