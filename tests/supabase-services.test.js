import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {AuthService,safeRedirect} from '../src/services/AuthService.js';
import {ProjectService} from '../src/services/ProjectService.js';
import {SceneService,SceneConflictError} from '../src/services/SceneService.js';
import {ConversationService} from '../src/services/ConversationService.js';

function queryClient(responder){
 const calls=[];
 return {calls,from(table){const call={table,operations:[]};calls.push(call);const query={};
  for(const method of ['select','insert','update','delete','eq','neq','ilike','order','limit','maybeSingle','single','in'])query[method]=(...args)=>{call.operations.push([method,...args]);return query;};
  query.then=(resolve,reject)=>Promise.resolve().then(()=>responder(call)).then(resolve,reject);return query;
 }};
}
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',P='33333333-3333-4333-8333-333333333333';
const op=(call,name)=>call.operations.find(operation=>operation[0]===name);
function snapshot(){
 const geometry=new THREE.BufferGeometry().copy(new THREE.BoxGeometry(2,2,2));
 return{format:'forma3d-scene',version:1,objects:[{id:1,persistentId:A,type:'Cube',name:'Cube 1',parentId:null,position:[0,0,0],rotation:[0,0,0,'XYZ'],scale:[1,1,1],visible:true,locked:false,dimensions:{width:2,height:2,depth:2},geometry:geometry.toJSON(),materials:[new THREE.MeshStandardMaterial().toJSON()],drawRange:{start:0,count:null}}],nameCounts:{Cube:1,Sphere:0,Cylinder:0,Group:0},nextObjectId:2,selectedIds:[1]};
}

test('Auth uses the provider session, signup metadata, profiles trigger and explicit logout',async()=>{
 let session=null,signup,profileUsername=null,unsubscribed=false;
 const client=queryClient(call=>{
  assert.equal(call.table,'profiles');
  if(op(call,'update')){profileUsername=op(call,'update')[1].username;return{data:{id:A},error:null};}
  return{data:{id:A,username:profileUsername},error:null};
 });
 const user={id:A,email:'test@example.invalid',user_metadata:{username:'test_user',full_name:'Test User'}};
 client.auth={getSession:async()=>({data:{session},error:null}),getUser:async()=>({data:{user},error:null}),signInWithPassword:async()=>{session={user};return{data:{user,session},error:null};},signUp:async input=>{signup=input;return{data:{user,session:null},error:null};},signOut:async()=>{session=null;return{error:null};},onAuthStateChange:()=>({data:{subscription:{unsubscribe(){unsubscribed=true;}}}})};
 const auth=new AuthService({client});
 assert.equal(await auth.getCurrentUser(),null);
 await auth.login({email:user.email,password:'unit-test-only'});
 assert.equal((await auth.getCurrentUser()).id,A);assert.equal(profileUsername,'test_user');
 const previous=globalThis.location;globalThis.location={origin:'http://localhost:5173'};
 try{const result=await auth.register({email:user.email,password:'unit-test-only',confirmPassword:'unit-test-only',username:'test_user',fullName:'Test User'});assert.equal(result.session,null);assert.equal(signup.options.data.full_name,'Test User');assert.equal(signup.options.emailRedirectTo,'http://localhost:5173/login');}finally{globalThis.location=previous;}
 const stop=auth.onAuthStateChange(()=>{});stop();assert.equal(unsubscribed,true);
 await auth.logout();assert.equal(await auth.getCurrentUser(),null);
 assert.equal(safeRedirect('//outside.example'),' /dashboard'.trim());assert.equal(safeRedirect('/projects?filter=shared'),'/projects?filter=shared');
});

test('project CRUD uses RLS-scoped tables and denies viewer writes and non-owner deletion',async()=>{
 let row={id:P,owner_id:A,name:'Private project',description:'',updated_at:'2026-11-21T12:00:00Z',scene_revision:0,scene_metadata:{},project_members:[{user_id:B,role:'viewer'}]};
 const client=queryClient(call=>{
  if(op(call,'insert')){row={...row,...op(call,'insert')[1]};return{data:row,error:null};}
  if(op(call,'update'))return{data:null,error:new Error('row-level security denied update')};
  if(op(call,'delete'))return{data:{id:P},error:null};
  return{data:op(call,'maybeSingle')||op(call,'single')?row:[row],error:null};
 });
 const owner=new ProjectService({client,auth:{requireUser:async()=>({id:A})}});
 const viewer=new ProjectService({client,auth:{requireUser:async()=>({id:B})}});
 const own=await owner.get(P),shared=await viewer.get(P);
 assert.equal(own.canDelete,true);assert.equal(shared.canEdit,false);assert.equal(shared.shared,true);
 await assert.rejects(viewer.remove(P),/owner/);
 await assert.rejects(viewer.update(P,{name:'Not allowed'}),/security/);
 await owner.create({name:'Real table',category:'Objects'});assert.equal(op(client.calls.find(call=>op(call,'insert')),'insert')[1].owner_id,A);
 await owner.list({filter:'shared',search:'x%'});assert.ok(op(client.calls.at(-1),'neq'));assert.ok(op(client.calls.at(-1),'ilike'));
 await owner.remove(P);assert.ok(op(client.calls.at(-1),'delete'));
});

test('project creation uses a verified session, explicit empty scene fields and a separate read',async()=>{
 let stored,session={user:{id:A}},verifiedUser={id:A},verified=0;
 const client=queryClient(call=>{
  const insert=op(call,'insert');
  if(insert){assert.equal(verified,1);assert.equal(op(call,'select'),undefined);stored=insert[1];return{data:null,error:null};}
  assert.ok(op(call,'single'));assert.deepEqual(op(call,'eq'),['eq','id',stored.id]);
  return{data:{...stored,project_members:[]},error:null};
 });
 client.auth={getSession:async()=>({data:{session},error:null}),getUser:async()=>{verified++;return{data:{user:verifiedUser},error:null};}};
 const projects=new ProjectService({client,auth:new AuthService({client})});
 const created=await projects.create({name:'  Design study  ',description:'  Preserve this  ',category:'Architecture',owner_id:B,scene_path:'injected',scene_revision:99,scene_metadata:{format:'injected'}});
 assert.equal(created.canEdit,true);assert.equal(created.canDelete,true);
 assert.deepEqual(stored,{id:created.id,owner_id:A,name:'Design study',description:'Preserve this',scene_path:null,thumbnail_path:null,scene_revision:0,scene_metadata:{category:'Architecture'}});
 const calls=client.calls.length;
 session=null;await assert.rejects(projects.create({name:'No session'}),/sign in/);assert.equal(client.calls.length,calls);
 session={user:{id:A}};verifiedUser=null;
 await assert.rejects(projects.create({name:'Revoked session'}),/sign in/);assert.equal(client.calls.length,calls);
 for(const category of [null,{},'x'.repeat(101)])await assert.rejects(projects.create({name:'Invalid category',category}),/category/);
 assert.equal(client.calls.length,calls);
});

test('project creation reports a failed follow-up read without retrying the successful insert',async()=>{
 const client=queryClient(call=>op(call,'insert')?{data:null,error:null}:{data:null,error:new Error('Disconnected')});
 const projects=new ProjectService({client,auth:{requireUser:async()=>({id:A})}});
 await assert.rejects(projects.create({name:'Created already'}),/was created.*Refresh My Projects/);
 assert.equal(client.calls.filter(call=>op(call,'insert')).length,1);
});

test('scene saves upload immutable private snapshots then commit only through expected-revision RPC',async()=>{
 const uploads=[],rpcCalls=[];let revision=0,currentPath=null;
 const client={storage:{from(bucket){assert.equal(bucket,'forma-projects');return{async upload(path,blob,options){uploads.push({path,blob,options});return{error:null};}};}},async rpc(name,args){rpcCalls.push({name,args});if(args.p_expected_revision!==revision)return{data:null,error:{message:'SCENE_CONFLICT'}};currentPath=args.p_scene_path;return{data:{scene_revision:++revision,scene_path:currentPath},error:null};}};
 const service=new SceneService({client}),project={id:P,scene_revision:0,canEdit:true};
 const saved=await service.save(project,snapshot());
 assert.equal(saved.scene_revision,1);assert.equal(uploads[0].options.upsert,false);assert.ok(uploads[0].path.startsWith(`${P}/scenes/`));
 assert.equal(rpcCalls[0].name,'commit_forma_scene');assert.equal(rpcCalls[0].args.p_objects[0].id,A);
 await assert.rejects(service.save(project,snapshot()),SceneConflictError);
 assert.equal(currentPath,saved.scene_path);assert.notEqual(uploads[0].path,uploads[1].path);
 const failed=new SceneService({client:{...client,rpc:async()=>({error:{code:'PGRST202'}})}});
 await assert.rejects(failed.save(project,snapshot()),/reviewed/);
 await assert.rejects(service.save({...project,canEdit:false},snapshot()),/read-only/);
});

test('scene download stays in the project private bucket and refuses foreign paths and malformed JSON',async()=>{
 let calls=0;
 const client={storage:{from(){return{async download(){calls++;return{data:new Blob([JSON.stringify(snapshot())]),error:null};}};}}};
 const service=new SceneService({client});assert.equal(await service.load({id:P,scene_path:null}),null);
 assert.equal((await service.load({id:P,scene_path:`${P}/scenes/current.json`})).objects.length,1);
 await assert.rejects(service.load({id:P,scene_path:`${B}/scenes/current.json`}),/Invalid private/);assert.equal(calls,1);
});

test('AI history writes only caller-owned user messages and reads assistant/action records',async()=>{
 const client=queryClient(call=>{
  if(call.table==='ai_conversations')return{data:{id:P,project_id:P,user_id:A},error:null};
  if(op(call,'insert'))return{data:{id:A,...op(call,'insert')[1]},error:null};
  return{data:call.table==='ai_messages'?[{id:A,role:'assistant',content:'Server record'}]:[],error:null};
 });
 const service=new ConversationService({client,auth:{requireUser:async()=>({id:A})}});
 await service.appendUser(P,'Create a cube',{objects:[]});const history=await service.history(P);assert.equal(history.messages[0].role,'assistant');
 const writes=client.calls.filter(call=>op(call,'insert'));
 assert.deepEqual(writes.map(call=>call.table),['ai_messages']);
 assert.equal(op(writes[0],'insert')[1].role,'user');assert.equal(op(writes[0],'insert')[1].sender_id,A);
 assert.ok(client.calls.some(call=>call.table==='ai_actions'&&!op(call,'insert')));
});
