import { getSupabaseClient } from './supabaseClient.js';
import { isUUID, validateScene, sceneObjectRows } from './SceneSerializer.js';
export class SceneConflictError extends Error { constructor(){super('Another user saved a newer scene. Your edits remain here. Reload the saved scene before trying again; it will not be overwritten.');this.name='SceneConflictError';} }
export class SceneService {
  constructor({client,provider=getSupabaseClient}={}){this.provider=()=>client??provider();}
  validPath(projectId,path){return isUUID(projectId)&&typeof path==='string'&&path.startsWith(`${projectId}/` )&&!path.includes('..')&&!path.includes('://');}
  async load(project) {
    if(!project.scene_path)return null;
    if(!this.validPath(project.id,project.scene_path))throw new Error('Invalid private project snapshot path.');
    const {data,error}=await this.provider().storage.from('forma-projects').download(project.scene_path);
    if(error)throw error;
    if(data.size>25*1024*1024)throw new Error('This scene exceeds the 25 MB client limit.');
    return validateScene(JSON.parse(await data.text()));
  }
  async save(project,scene,thumbnail=null) {
    if(!isUUID(project.id)||!Number.isSafeInteger(project.scene_revision)||project.scene_revision<0)throw new Error('Invalid project scene revision.');
    if(!project.canEdit)throw new Error('This project is read-only.');
    validateScene(scene);
    const client=this.provider(),bucket=client.storage.from('forma-projects'),paths=[];
    const path=`${project.id}/scenes/${crypto.randomUUID()}.json`;
    const text=JSON.stringify(scene);
    if(new Blob([text]).size>25*1024*1024)throw new Error('This scene exceeds the 25 MB client limit.');
    const {error:uploadError}=await bucket.upload(path,new Blob([text],{type:'application/json'}),{contentType:'application/json',upsert:false});
    if(uploadError)throw uploadError;
    paths.push(path);let thumbnailPath=null;
    try {
      if(thumbnail){thumbnailPath=`${project.id}/thumbnails/${crypto.randomUUID()}.png`;const {error}=await bucket.upload(thumbnailPath,thumbnail,{contentType:'image/png',upsert:false});if(error)throw error;paths.push(thumbnailPath);}
      const {data,error}=await client.rpc('commit_forma_scene',{p_project_id:project.id,p_expected_revision:project.scene_revision,p_scene_path:path,p_scene_metadata:{format:scene.format,format_version:scene.version,object_count:scene.objects.length},p_objects:sceneObjectRows(scene),p_thumbnail_path:thumbnailPath});
      if(error){if(error.message?.includes('SCENE_CONFLICT'))throw new SceneConflictError();if(error.code==='PGRST202')throw new Error('Scene saving requires the reviewed commit_forma_scene migration. No saved scene was overwritten.');throw error;}
      if(!data||data.scene_revision!==project.scene_revision+1)throw new Error('The server did not confirm a new scene revision.');
      return {...project,...data};
    } catch(error) {
      // Storage deletion is owner-only in the supplied schema. Editor-owned orphans
      // require a trusted maintenance job; never use a public URL or admin key.
      // Never remove an upload after an ambiguous network error: the atomic commit
      // may have succeeded. A trusted job can remove only unreferenced objects.
      throw error;
    }
  }
}
