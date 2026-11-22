export function matchRoute(pathname) {
  const path = pathname.replace(/\/$/, '') || '/';
  if (['/','/login','/register','/dashboard','/projects'].includes(path)) return { path, params: {} };
  const editor = /^\/editor\/([^/]+)$/.exec(path);
  if (editor) {
    try { return { path: '/editor/:projectId', params: { projectId: decodeURIComponent(editor[1]) } }; }
    catch { return { path: '404', params: {} }; }
  }
  return { path: '404', params: {} };
}

export class Router {
  constructor({ root, routes, services }) { this.root = root; this.routes = routes; this.services = services; this.events = new AbortController(); this.version = 0; }
  start() {
    this.authUnsubscribe = this.services.auth?.onAuthStateChange?.(event => {
      if (this.events.signal.aborted) return;
      if (event==='SIGNED_OUT' && this.isProtectedRoute()) this.render();
    });
    document.addEventListener('click', async event => {
      const button=event.target.closest('[data-logout]');
      if(!button)return;
      button.disabled=true;
      try { await this.services.auth.logout(); this.navigate('/login'); }
      catch(error){const status=this.root.querySelector('#account-status');if(status)status.textContent=error.message;button.disabled=false;}
    }, {signal:this.events.signal});
    window.addEventListener('popstate', () => this.render(), { signal: this.events.signal });
    document.addEventListener('click', event => {
      const link = event.target.closest('a[data-route]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      event.preventDefault(); this.navigate(url.pathname + url.search + url.hash);
    }, { signal: this.events.signal });
    return this.render();
  }
  isProtectedRoute() {
    const match=matchRoute(location.pathname);
    return !!this.routes[match.path]?.protected && match.params.projectId!=='demo';
  }
  navigate(url) {
    const destination = new URL(url, location.href);
    if (destination.origin !== location.origin) return;
    if (destination.href === location.href) { this.scrollToHash(); return; }
    const hashOnly = destination.pathname === location.pathname && destination.search === location.search;
    history.pushState({}, '', destination.pathname + destination.search + destination.hash);
    if (hashOnly) this.scrollToHash(); else return this.render();
  }
  scrollToHash() {
    if (location.hash) {
      try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth' }); } catch { /* An invalid anchor does not block navigation. */ }
    } else window.scrollTo(0,0);
  }
  async render() {
    const version = ++this.version;
    this.scope?.abort(); this.cleanup?.(); this.cleanup = null;
    this.scope = new AbortController();
    const signal = this.scope.signal;
    const match = matchRoute(location.pathname), page = this.routes[match.path];
    const mode = match.path === '/editor/:projectId' ? 'editor-route' : 'platform-route';
    document.documentElement.className = mode;
    document.body.className = mode;
    this.root.className = mode === 'editor-route' ? 'editor-app' : 'platform-app';
    this.root.innerHTML = '<p class="p-loading" role="status">Opening your workspace…</p>';
    document.title = `${page.title} · Forma3D`;
    try {
      let user=null;
      if(page.protected && match.params.projectId!=='demo') {
        user=await this.services.auth.getCurrentUser();
        if(signal.aborted)return;
        if(!user){history.replaceState({},'',`/login?next=${encodeURIComponent(location.pathname+location.search)}`);return this.render();}
      }
      const cleanup = await page.mount({ root: this.root, router: this, services: this.services, params: match.params, signal, user, url: new URL(location.href) });
      if (signal.aborted || version !== this.version) { cleanup?.(); return; }
      this.cleanup = cleanup;
      const heading = this.root.querySelector('h1');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      this.scrollToHash();
    } catch (error) {
      if (signal.aborted) return;
      document.documentElement.className = document.body.className = 'platform-route';
      this.root.className = 'platform-app';
      this.root.innerHTML = '<div class="p-route-error"><h1>We couldn’t open this page.</h1><p id="route-error-message"></p><a href="/" data-route>Return home</a> · <a href="/editor/demo" data-route>Try the demo editor</a></div>';
      this.root.querySelector('#route-error-message').textContent = error.message;
    }
  }
  dispose() { ++this.version; this.events.abort(); this.authUnsubscribe?.(); this.scope?.abort(); this.cleanup?.(); this.cleanup = null; }
}
