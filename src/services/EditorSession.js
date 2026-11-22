import { serializeScene, restoreScene, sceneFingerprint } from './SceneSerializer.js';
export class EditorSession {
  constructor({editor,project,scenes,projects,root,signal}){Object.assign(this,{editor,project,scenes,projects,root,signal});this.baseline=null;this.saving=false;}
  async start(){
    const snapshot=await this.scenes.load(this.project);
    if(this.signal.aborted)return;
    if(snapshot)restoreScene(this.editor,snapshot);
    this.baseline=sceneFingerprint(serializeScene(this.editor));
    this.editor.history.onChange=()=>this.refresh();
    this.saveButton=this.root.querySelector('#save-scene');this.reloadButton=this.root.querySelector('#reload-scene');this.status=this.root.querySelector('#scene-status');
    this.saveButton.addEventListener('click',()=>this.save(),{signal:this.signal});
    this.reloadButton.addEventListener('click',()=>this.reload(),{signal:this.signal});
    window.addEventListener('beforeunload',event=>{if(this.dirty()){event.preventDefault();event.returnValue='';}},{signal:this.signal});
    this.refresh();
  }
  dirty(){try{return this.baseline!==sceneFingerprint(serializeScene(this.editor));}catch{return true;}}
  refresh(message){
    if(this.signal.aborted||!this.status)return;
    this.saveButton.disabled=!this.project.canEdit||this.saving||this.loading;
    this.reloadButton.disabled=this.saving||this.loading;
    this.status.textContent=message??(this.project.canEdit?(this.dirty()?'Unsaved changes':this.project.scene_path?`Saved revision ${this.project.scene_revision}`:'New scene — not saved yet'):'Read-only project');
  }
  thumbnail(){
    this.editor.viewport.renderer.render(this.editor.viewport.scene,this.editor.viewport.camera);
    const data=this.editor.viewport.renderer.domElement.toDataURL('image/png');
    const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));
    return new Blob([bytes],{type:'image/png'});
  }
  async save(){
    if(this.saving||!this.project.canEdit)return;
    this.saving=true;this.refresh('Saving private scene…');
    try{
      const snapshot=serializeScene(this.editor),fingerprint=sceneFingerprint(snapshot);
      const saved=await this.scenes.save(this.project,snapshot,this.thumbnail());
      if(this.signal.aborted)return;
      this.project=saved;this.baseline=fingerprint;this.refresh();
    }catch(error){this.refresh(error.message);}
    finally{this.saving=false;this.refresh(this.status?.textContent);}
  }
  async reload(){
    if(this.saving||this.loading)return;
    if(this.dirty()&&!window.confirm('Discard unsaved changes and load the latest saved scene?'))return;
    this.loading=true;this.root.classList.add('is-loading-scene');this.refresh('Loading the saved scene…');
    try{
      const project=await this.projects.get(this.project.id);if(!project)throw new Error('Project is no longer accessible.');
      const snapshot=await this.scenes.load(project);if(this.signal.aborted)return;
      if(!snapshot)throw new Error('No scene has been saved yet.');
      this.editor.readOnly=!project.canEdit;this.editor.viewport.transformControls.enabled=project.canEdit;
      restoreScene(this.editor,snapshot);const badge=this.root.querySelector('.workspace-badge');if(badge)badge.textContent=project.role;this.project=project;this.baseline=sceneFingerprint(serializeScene(this.editor));this.refresh();
    }catch(error){this.refresh(error.message);}
    finally{this.loading=false;this.root.classList.remove('is-loading-scene');this.refresh(this.status?.textContent);}
  }
  dispose(){this.editor.history.onChange=null;}
}
