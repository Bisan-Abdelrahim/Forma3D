import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectService } from './fixtures/MemoryProjectService.js';
import { AuthService, validateAuth } from '../src/services/AuthService.js';
import { matchRoute, Router } from '../src/routing/Router.js';
import { projectCard } from '../src/components/ProjectCards.js';

test('platform routes resolve direct URLs, trailing slashes, editor IDs and malformed routes', () => {
  for (const path of ['/','/login','/register','/dashboard','/projects']) assert.equal(matchRoute(path).path,path);
  assert.equal(matchRoute('/projects/').path,'/projects');
  assert.equal(matchRoute('/editor/demo').params.projectId,'demo');
  assert.equal(matchRoute('/editor/a%20b').params.projectId,'a b');
  for (const path of ['/editor','/editor/a/b','/editor/%zz','/missing']) assert.equal(matchRoute(path).path,'404');
});

test('project metadata is isolated, filtered, sorted, validated, and memory-only', async () => {
  const projects = new ProjectService(), fresh = new ProjectService();
  const initial = await projects.list();
  assert.equal(projects.storageMode,'memory');
  initial[0].name = 'mutated copy';
  assert.notEqual((await projects.get(initial[0].id)).name,'mutated copy');
  const created = await projects.create({name:' A new form ',description:'A simple study',category:'Objects'});
  assert.equal(created.name,'A new form');
  assert.equal(await fresh.get(created.id),null);
  assert.equal((await projects.list({search:'simple study'})).length,1);
  assert.ok((await projects.list({filter:'shared'})).every(p=>p.shared));
  assert.ok((await projects.list({filter:'personal'})).every(p=>!p.shared));
  const sorted = await projects.list({sort:'name'});
  assert.deepEqual(sorted.map(p=>p.name),sorted.map(p=>p.name).sort((a,b)=>a.localeCompare(b)));
  await assert.rejects(projects.create({name:' '}));
  await assert.rejects(projects.create({name:'x',category:'invalid'}));
  await projects.remove(created.id);
  assert.equal(await projects.get(created.id),null);
  assert.equal((await projects.recentActivity()).length,2);
  await assert.rejects(projects.remove('missing'));
});

test('authentication validates fields and never returns a fake user or session', async () => {
  assert.deepEqual(validateAuth({email:'person@example.com',password:'a-valid-password'}),{});
  assert.ok(validateAuth({email:'bad',password:'short'}).email);
  const errors = validateAuth({email:'person@example.com',password:'a-valid-password',username:'x!',fullName:'A',confirmPassword:'different'},'register');
  assert.ok(errors.username && errors.fullName && errors.confirmPassword);
  const auth = new AuthService({client:{auth:{getSession:async()=>({data:{session:null},error:null}),signInWithPassword:async()=>({error:new Error('Authentication provider rejected the credentials')})}}});
  assert.equal(await auth.getCurrentUser(),null);
  await assert.rejects(auth.login({email:'x',password:'unused'}),/rejected the credentials/);
  await assert.rejects(auth.register({}),/valid email/);
});

test('project cards escape user-controlled labels and keep links within editor routes', () => {
  const html = projectCard({ id:'<script>', name:'<img onerror="alert(1)">',description:'<script>alert(1)</script>',category:'Objects',thumbnail:'forms',updatedAt:'2026-11-01T00:00:00Z' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('/editor/%3Cscript%3E'));
});

test('router owns navigation listeners, disposes each page, and ignores stale async mounts', async () => {
  const previous = Object.fromEntries(['window','document','location','history'].map(key=>[key,globalThis[key]]));
  const fakeWindow = new EventTarget(), fakeDocument = new EventTarget();
  fakeWindow.scrollTo = () => {};
  fakeDocument.documentElement = {}; fakeDocument.body = {};
  fakeDocument.getElementById = () => null;
  globalThis.window = fakeWindow; globalThis.document = fakeDocument;
  globalThis.location = new URL('http://localhost/');
  globalThis.history = { pushState(_state,_title,url) { globalThis.location = new URL(url,globalThis.location); } };
  const root = { className:'',innerHTML:'',querySelector(){return null;} };
  let mounts = 0, cleanups = 0, release;
  const router = new Router({root,services:{},routes:{
    '/':{title:'Home',mount:()=>{mounts++;return()=>cleanups++;}},
    '/login':{title:'Login',mount:()=>new Promise(resolve=>{release=()=>resolve(()=>cleanups++);})},
    '/projects':{title:'Projects',mount:()=>{mounts++;return()=>cleanups++;}}
  }});
  try {
    await router.start(); assert.equal(mounts,1);
    const pending = router.navigate('/login'); assert.equal(cleanups,1);
    await router.navigate('/projects');
    release(); await pending;
    assert.equal(cleanups,2); // Home plus abandoned Login.
    assert.equal(mounts,2);
    assert.equal(fakeDocument.title,'Projects · Forma3D');
    globalThis.location = new URL('http://localhost/');
    fakeWindow.dispatchEvent(new Event('popstate'));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(mounts,3); assert.equal(cleanups,3);
    router.dispose(); assert.equal(cleanups,4);
    fakeWindow.dispatchEvent(new Event('popstate')); assert.equal(mounts,3);
  } finally { router.dispose(); for (const [key,value] of Object.entries(previous)) globalThis[key]=value; }
});

test('protected routes require a server-verified user while the editor demo stays public',async()=>{
 const previous=Object.fromEntries(['window','document','location','history'].map(key=>[key,globalThis[key]]));
 const w=new EventTarget(),d=new EventTarget();w.scrollTo=()=>{};d.documentElement={};d.body={};d.getElementById=()=>null;
 globalThis.window=w;globalThis.document=d;globalThis.location=new URL('http://localhost/projects');
 globalThis.history={pushState(_s,_t,url){globalThis.location=new URL(url,globalThis.location);},replaceState(_s,_t,url){globalThis.location=new URL(url,globalThis.location);}};
 let user=null,protectedMounts=0,demoMounts=0;
 const root={querySelector(){return null;}};
 const router=new Router({root,services:{auth:{getCurrentUser:async()=>user}},routes:{'/projects':{title:'Projects',protected:true,mount:()=>{protectedMounts++;}},'/login':{title:'Login',mount:()=>{}},'/editor/:projectId':{title:'Editor',protected:true,mount:()=>{demoMounts++;}}}});
 try{
  await router.start();assert.equal(location.pathname,'/login');assert.equal(new URL(location).searchParams.get('next'),'/projects');assert.equal(protectedMounts,0);
  await router.navigate('/editor/demo');assert.equal(demoMounts,1);
  user={id:'verified-user'};await router.navigate('/projects');assert.equal(protectedMounts,1);
 }finally{router.dispose();for(const[key,value]of Object.entries(previous))globalThis[key]=value;}
});
