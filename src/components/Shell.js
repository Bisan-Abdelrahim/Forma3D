export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}
export const dateLabel = value => new Intl.DateTimeFormat('en', { month:'short', day:'numeric', year:'numeric' }).format(new Date(value));
export const logo = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 3 12 7v13l-12 7L4 23V10L16 3Z"/><path d="m4 10 12 7 12-7M16 17v13M10 6l12 7v7"/></svg>`;
export const brand = `<a class="p-brand" href="/" data-route>${logo}<span>Forma<span>3D</span></span></a>`;
export function publicHeader() {
  return `<header class="p-header p-container">${brand}<nav aria-label="Main navigation"><a href="/" data-route>Home</a><a href="/#features" data-route>Features</a><a href="/#gallery" data-route>Gallery</a></nav><div class="p-header-actions"><a href="/login" data-route class="p-login-link">Log in</a><a class="p-button p-primary p-small" href="/register" data-route>Get started <span aria-hidden="true">↗</span></a></div></header>`;
}
export function shell(content, active = 'dashboard', account = null) {
  return `<div class="p-workspace"><aside class="p-sidebar">${brand}<span class="p-nav-label">WORKSPACE</span><nav aria-label="Workspace navigation"><a href="/dashboard" data-route ${active==='dashboard'?'aria-current="page"':''}><span aria-hidden="true">◫</span> Overview</a><a href="/projects" data-route ${active==='projects'?'aria-current="page"':''}><span aria-hidden="true">▦</span> My projects</a><a href="/projects?filter=shared" data-route><span aria-hidden="true">♧</span> Shared projects</a><a href="/editor/demo" data-route><span aria-hidden="true">◇</span> Try demo editor</a></nav><div class="p-sidebar-bottom"><div class="p-preview-note"><span class="p-dot"></span> Private workspace<p>Projects are stored in Supabase. Save your scene explicitly in the editor.</p></div><a href="/" data-route>← Back to website</a><p id="account-status" role="status"></p></div></aside><div class="p-workspace-main"><header class="p-workspace-header"><span>Workspace <span class="p-breadcrumb">/ ${active==='projects'?'My projects':'Overview'}</span></span><div class="p-demo-account"><span>F</span> <span class="p-account-name">${escapeHTML(account?.user_metadata?.full_name || account?.email || 'Your workspace')}</span> <button type="button" data-logout>Sign out</button></div></header><main class="p-workspace-content">${content}</main></div></div>`;
}
export const projectNotice = `<div class="p-notice"><span aria-hidden="true">ⓘ</span><p><strong>Private projects.</strong> Your access is enforced by Supabase policies. Save scene changes explicitly in the editor; the project list is not a scene autosave.</p></div>`;
export function emptyState(title, text, action = '') {
  return `<div class="p-empty"><span aria-hidden="true">◇</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p>${action}</div>`;
}
