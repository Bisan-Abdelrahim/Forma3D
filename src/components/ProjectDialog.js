export function projectDialog({ root, projects, signal, onCreated, onRemoved, onUpdated=onRemoved }) {
  const dialog=document.createElement('dialog');dialog.className='p-dialog';dialog.setAttribute('aria-labelledby','project-dialog-title');root.appendChild(dialog);
  let opener;
  const close=()=>{dialog.close();if(opener?.isConnected)opener.focus();};
  const openForm=async(id=null)=>{
    const project=id?await projects.get(id):null;
    if(signal.aborted||id&&!project?.canEdit)return;
    opener=document.activeElement;
    dialog.innerHTML=`<form><div class="p-dialog-heading"><h2 id="project-dialog-title">${project?'Edit project':'Create a project'}</h2><button type="button" data-close aria-label="Close dialog">×</button></div><label>Project name<input name="name" required maxlength="150" autofocus placeholder="My new project"></label><label>Description<textarea name="description" rows="3" maxlength="10000"></textarea></label>${!project?'<label>Category<select name="category"><option>Objects</option><option>Product</option><option>Architecture</option></select></label>':''}<p class="p-inline-notice">Project details are stored in Supabase. Use Save in the editor to store the complete 3D scene.</p><p id="dialog-message" role="status"></p><footer><button type="button" class="p-button p-secondary" data-close>Cancel</button><button type="submit" class="p-button p-primary">${project?'Update project':'Create project'} ↗</button></footer></form>`;
    const form=dialog.querySelector('form');form.elements.name.value=project?.name??'';form.elements.description.value=project?.description??'';
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
      try{const values=Object.fromEntries(new FormData(form));const result=project?await projects.update(project.id,values):await projects.create(values);if(signal.aborted)return;close();await(project?onUpdated(result):onCreated(result));}
      catch(error){if(!signal.aborted)dialog.querySelector('#dialog-message').textContent=error.message;}
      finally{if(!signal.aborted)button.disabled=false;}
    },{signal});dialog.showModal();
  };
  const openRemove=async id=>{
    const project=await projects.get(id);if(signal.aborted||!project?.canDelete)return;
    opener=document.activeElement;
    dialog.innerHTML='<form><div class="p-dialog-heading"><h2 id="project-dialog-title">Delete project permanently?</h2><button type="button" data-close aria-label="Close dialog">×</button></div><p id="remove-name"></p><p class="p-subtle">This deletes the project and its related database records. It cannot be undone. Cleanup of unreferenced private Storage files requires a trusted maintenance job.</p><p id="dialog-message" role="status"></p><footer><button type="button" class="p-button p-secondary" data-close>Cancel</button><button type="submit" class="p-button p-danger">Delete project</button></footer></form>';
    dialog.querySelector('#remove-name').textContent=project.name;
    dialog.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;
      try{await projects.remove(id);if(!signal.aborted){close();await onRemoved();}}
      catch(error){if(!signal.aborted)dialog.querySelector('#dialog-message').textContent=error.message;}
      finally{if(!signal.aborted)button.disabled=false;}
    },{signal});dialog.showModal();
  };
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-close]'))close();},{signal});
  root.addEventListener('keydown',event=>{const menu=event.target.closest('.p-action-menu');if(event.key==='Escape'&&menu){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();}},{signal});
  root.addEventListener('pointerdown',event=>{for(const menu of root.querySelectorAll('.p-action-menu[open]'))if(!menu.contains(event.target))menu.open=false;},{signal});
  root.addEventListener('click',event=>{
    const run=promise=>promise.catch(error=>{const status=root.querySelector('#project-message')??root.querySelector('#account-status');if(status)status.textContent=error.message;});
    if(event.target.closest('[data-create-project]'))run(openForm());
    const remove=event.target.closest('[data-remove]');if(remove)run(openRemove(remove.dataset.remove));
    const edit=event.target.closest('[data-edit]');if(edit)run(openForm(edit.dataset.edit));
  },{signal});
  return{openCreate:()=>openForm(),dispose(){if(dialog.open)dialog.close();dialog.remove();}};
}
