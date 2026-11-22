import { publicHeader, emptyState } from '../components/Shell.js';
export async function mountEditor({root,services,params,signal}){
  const demo=params.projectId==='demo';
  const project=demo?{name:'Demo workspace'}:await services.projects.get(params.projectId);
  if(signal.aborted)return;
  if(!project){
    document.documentElement.className=document.body.className='platform-route';root.className='platform-app';
    root.innerHTML=`${publicHeader()}<main class="p-container p-missing">${emptyState('Project not accessible.','It may have been removed, or your account does not have permission.','<a class="p-button p-primary" href="/projects" data-route>My projects</a>')}</main>`;return;
  }
  const [{EditorApp},{EditorSession},{SceneService}]=await Promise.all([import('../editor/EditorApp.js'),import('../services/EditorSession.js'),import('../services/SceneService.js')]);if(signal.aborted)return;
  services.scenes ??= new SceneService();
  const editor=new EditorApp();editor.readOnly=!demo&&!project.canEdit;
  if(!demo){editor.projectId=project.id;editor.conversations=services.conversations;}
  let session;
  const dispose=()=>{root.classList.remove('is-loading-scene');session?.dispose();editor.dispose();};
  signal.addEventListener('abort',dispose,{once:true});
  try{
    editor.start();editor.viewport.transformControls.enabled=!editor.readOnly;
    root.querySelector('.project-title').textContent=project.name;
    const brand=root.querySelector('.brand');brand.href='/';brand.dataset.route='';brand.setAttribute('aria-label','Forma3D home');
    const badge=root.querySelector('.workspace-badge');badge.textContent=demo?'Unsaved demo':project.role;
    const back=document.createElement('a');back.href='/projects';back.dataset.route='';back.className='editor-projects-link';back.textContent='← Projects';
    root.querySelector('#toolbar').insertBefore(back,root.querySelector('.history-actions'));
    const note=document.createElement('div');note.className='editor-session-note';
    if(demo)note.textContent='Demo scene · Sign in and create a project to save. Changes here are not stored.';
    else{
      note.innerHTML='<button id="save-scene">Save scene</button><button id="reload-scene">Reload saved scene</button><span id="scene-status" role="status">Loading saved scene…</span>';
      const history=document.createElement('div');history.id='ai-history';history.setAttribute('aria-label','AI conversation history');
      const historyNote=document.createElement('p');historyNote.id='ai-history-note';historyNote.className='ai-footnote';
      root.querySelector('#ai-panel').insertBefore(history,root.querySelector('#ai-status'));
      root.querySelector('#ai-panel').appendChild(historyNote);
    }
    root.querySelector('.viewport-column').prepend(note);
    if(!demo){
      session=new EditorSession({editor,project,scenes:services.scenes,projects:services.projects,root,signal});
      root.classList.add('is-loading-scene');
      await session.start();root.classList.remove('is-loading-scene');if(signal.aborted)return dispose;
      editor.ai.loadHistory();
    }
    editor.ui.updateProperties();editor.ui.updateButtons();
    return dispose;
  }catch(error){dispose();throw error;}
}
