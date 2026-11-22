import { getSupabaseClient } from './supabaseClient.js';
const columns = '*,project_members(user_id,role)';
export class ProjectService {
  constructor({ client, auth, provider = getSupabaseClient } = {}) { this.provider=()=>client??provider(); this.auth=auth; this.storageMode='supabase'; }
  async user() { return this.auth.requireUser(); }
  async map(row,user) {
    const role = row.owner_id===user.id ? 'owner' : row.project_members?.find(member=>member.user_id===user.id)?.role;
    let thumbnailUrl=null;
    if (row.thumbnail_path?.startsWith(`${row.id}/`)) {
      const {data,error}=await this.provider().storage.from('forma-projects').createSignedUrl(row.thumbnail_path,900);
      if (!error) thumbnailUrl=data.signedUrl;
    }
    return {...row,updatedAt:row.updated_at,category:row.scene_metadata?.category??'Objects',shared:row.owner_id!==user.id,role,canEdit:['owner','editor'].includes(role),canDelete:role==='owner',thumbnailUrl,thumbnail:'forms'};
  }
  async list({search='',filter='all',sort='recent'}={}) {
    const user=await this.user();
    let query=this.provider().from('projects').select(columns);
    if (filter==='personal') query=query.eq('owner_id',user.id);
    if (filter==='shared') query=query.neq('owner_id',user.id);
    if (search.trim()) query=query.ilike('name',`%${search.trim().replace(/[%_\\]/g,'\\$&')}%`);
    query=query.order(sort==='name'?'name':'updated_at',{ascending:sort==='name'||sort==='oldest'}).limit(1000);
    const {data,error}=await query;
    if (error) throw error;
    return Promise.all(data.map(row=>this.map(row,user)));
  }
  async get(id) {
    const user=await this.user();
    const {data,error}=await this.provider().from('projects').select(columns).eq('id',id).maybeSingle();
    if (error) throw error;
    return data?this.map(data,user):null;
  }
  async create({name,description='',category='Objects'}) {
    name=typeof name==='string'?name.trim():'';
    if(typeof description!=='string')throw new Error('Use text for the project description.');
    description=description.trim();
    if (!name || name.length>150) throw new Error('Use a project name between 1 and 150 characters.');
    if(typeof category!=='string'||category.trim().length>100)throw new Error('Use a project category of at most 100 characters.');
    category=category.trim();
    // requireUser checks the current Supabase session and verifies it with getUser.
    const user=await this.user();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user?.id??''))throw new Error('Please sign in again before creating a project.');
    const client=this.provider(),id=crypto.randomUUID();
    const payload={id,owner_id:user.id,name,description,scene_path:null,thumbnail_path:null,
      scene_revision:0,scene_metadata:category?{category}:{}};
    // Do not chain select(): INSERT RETURNING evaluates the SELECT policy while
    // its STABLE can_read_project helper cannot yet see this new project row.
    const {error}=await client.from('projects').insert(payload);
    if (error) throw error;
    // A separate request sees the committed row and its project memberships.
    const {data,error:readError}=await client.from('projects').select(columns).eq('id',id).single();
    if(readError)throw new Error('The project was created, but its details could not be loaded. Refresh My Projects before trying again.',{cause:readError});
    return this.map(data,user);
  }
  async update(id,{name,description,status}) {
    const values={};
    if (name!==undefined) { if (!name.trim()||name.trim().length>150) throw new Error('Use a name between 1 and 150 characters.'); values.name=name.trim(); }
    if (description!==undefined) values.description=description.trim();
    if (status!==undefined) { if (!['active','archived'].includes(status)) throw new Error('Invalid project status.'); values.status=status; }
    const user=await this.user();
    const {data,error}=await this.provider().from('projects').update(values).eq('id',id).select(columns).single();
    if (error) throw error;
    return this.map(data,user);
  }
  async remove(id) {
    const project=await this.get(id);
    if (!project?.canDelete) throw new Error('Only the project owner can delete this project.');
    const {data,error}=await this.provider().from('projects').delete().eq('id',id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Project was not deleted. Check your permissions.');
  }
  async recentActivity() {
    const {data,error}=await this.provider().from('project_activity_logs').select('id,action_type,created_at').order('created_at',{ascending:false}).limit(6);
    if (error) throw error;
    return data.map(row=>({id:row.id,text:row.action_type,at:row.created_at}));
  }
}
