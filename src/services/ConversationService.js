import { getSupabaseClient } from './supabaseClient.js';
export class ConversationService {
  constructor({auth,client,provider=getSupabaseClient}={}){this.auth=auth;this.provider=()=>client??provider();this.conversations=new Map();}
  async conversation(projectId,create=false){
    const user=await this.auth.requireUser(),key=`${user.id}:${projectId}`;
    if(this.conversations.has(key))return this.conversations.get(key);
    const client=this.provider();
    let {data,error}=await client.from('ai_conversations').select('id,project_id,user_id').eq('project_id',projectId).eq('user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(error)throw error;
    if(!data&&create){const result=await client.from('ai_conversations').insert({project_id:projectId,user_id:user.id,title:'Modeling session'}).select('id,project_id,user_id').single();if(result.error)throw result.error;data=result.data;}
    if(data)this.conversations.set(key,data);
    return data;
  }
  async history(projectId){
    const conversation=await this.conversation(projectId);
    if(!conversation)return{messages:[],actions:[]};
    const {data:messages,error}=await this.provider().from('ai_messages').select('id,role,content,created_at').eq('conversation_id',conversation.id).order('created_at',{ascending:true}).limit(200);
    if(error)throw error;
    let actions=[];
    if(messages.length){const result=await this.provider().from('ai_actions').select('id,message_id,action_type,status').in('message_id',messages.map(message=>message.id));if(result.error)throw result.error;actions=result.data;}
    return{messages,actions};
  }
  async appendUser(projectId,content,context){
    const conversation=await this.conversation(projectId,true),user=await this.auth.requireUser();
    const {data,error}=await this.provider().from('ai_messages').insert({conversation_id:conversation.id,sender_id:user.id,role:'user',content,model_id:null,context_snapshot:context}).select('id,role,content,created_at').single();
    if(error)throw error;return data;
  }
  async models(){const{data,error}=await this.provider().from('ai_models').select('id,name,version,provider,deployment_type').eq('is_active',true);if(error)throw error;return data;}
  // Assistant/system/tool messages and ai_actions are deliberately never written here.
}
