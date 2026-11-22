import { publicHeader, emptyState } from '../components/Shell.js';
export function mountNotFound({ root }) {
  root.innerHTML = `${publicHeader()}<main class="p-container p-missing">${emptyState('A little outside the workspace.','This page doesn’t exist. Let’s get you back to creating.','<a class="p-button p-primary" href="/" data-route>Back home ↗</a><a class="p-button p-secondary" href="/editor/demo" data-route>Open demo editor</a>')}</main>`;
}
