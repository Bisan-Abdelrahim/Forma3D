import { shell, projectNotice, emptyState } from '../components/Shell.js';
import { projectCard } from '../components/ProjectCards.js';
import { projectDialog } from '../components/ProjectDialog.js';

export async function mountProjects({ root, services, signal, url, user }) {
  root.innerHTML = shell(`<div class="p-page-title"><div><p class="p-eyebrow">IDEAS IN PROGRESS</p><h1>My projects<span class="p-title-dot">.</span></h1><p class="p-subtle">A home for your experiments and your next big thing.</p></div><button class="p-button p-primary" data-create-project>＋ New project</button></div>${projectNotice}<div class="p-project-controls"><label class="p-project-search"><span aria-hidden="true">⌕</span><input type="search" id="project-search" placeholder="Search projects by name…" aria-label="Search projects"></label><label><span class="p-sr-only">Filter projects</span><select id="project-filter" aria-label="Filter projects"><option value="all">All projects</option><option value="personal">Personal</option><option value="shared">Shared</option></select></label><label><span class="p-sr-only">Sort projects</span><select id="project-sort" aria-label="Sort projects"><option value="recent">Recently updated</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option></select></label></div><div class="p-list-heading"><span id="project-results" role="status" aria-live="polite"></span><span class="p-subtle p-small-text">Private project metadata</span></div><section id="project-grid" class="p-project-grid" aria-label="Project results"></section><p id="project-message" class="p-subtle" role="status"></p>`, 'projects', user);
  const search = root.querySelector('#project-search'), filter = root.querySelector('#project-filter'), sort = root.querySelector('#project-sort');
  filter.value = ['all','personal','shared'].includes(url.searchParams.get('filter')) ? url.searchParams.get('filter') : 'all';
  let revision = 0;
  const refresh = async () => {
    const current = ++revision;
    const list = await services.projects.list({ search:search.value, filter:filter.value, sort:sort.value });
    if (signal.aborted || current !== revision) return;
    root.querySelector('#project-results').textContent = `${list.length} project${list.length===1?'':'s'}`;
    root.querySelector('#project-grid').innerHTML = list.length ? list.map(projectCard).join('') : emptyState('No projects here yet.','Try another search or filter, or start a new project.','<button class="p-button p-primary" data-create-project>＋ New project</button>');
  };
  search.addEventListener('input',refresh,{signal}); filter.addEventListener('change',refresh,{signal}); sort.addEventListener('change',refresh,{signal});
  const dialog = projectDialog({root, projects:services.projects, signal, onCreated:async project=>{
    search.value=''; filter.value='all'; sort.value='recent'; await refresh();
    if (!signal.aborted) root.querySelector('#project-message').textContent = `“${project.name}” created in Supabase. Open it and save your first scene.`;
  },onRemoved:refresh});
  await refresh();
  if (signal.aborted) { dialog.dispose(); return; }
  return () => dialog.dispose();
}
