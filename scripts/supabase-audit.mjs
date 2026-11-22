import {createClient} from '@supabase/supabase-js';
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw new Error('Load .env.local before running this audit.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const health=await fetch(`${url}/auth/v1/health`,{headers:{apikey:key},signal:AbortSignal.timeout(15000)});
console.log('Auth endpoint:',health.status);
for(const table of ['profiles','projects','scene_objects','ai_models','ai_messages','ai_actions']){
 const {error}=await client.from(table).select('id').limit(0);
 console.log(`${table}: anonymous read ${error?`denied (${error.code})`:'permitted by current grants/policies (zero rows requested)'}`);
}
// The function's first statement rejects auth.uid() = null before any mutation.
const {error}=await client.rpc('commit_forma_scene',{p_project_id:null,p_expected_revision:0,p_scene_path:null,p_scene_metadata:{},p_objects:[],p_thumbnail_path:null});
console.log('Atomic save RPC:',error?.code==='PGRST202'?'not deployed':error?`not executable anonymously (${error.code})`:'UNEXPECTED anonymous success — review immediately');
