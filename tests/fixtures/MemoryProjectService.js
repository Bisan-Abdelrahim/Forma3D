import { mockProjects } from './mockProjects.js';

// Replace these methods with REST calls when the project API is available.
export class ProjectService {
  constructor(seed = mockProjects) {
    this.projects = seed.map(project => ({ ...project }));
    this.activity = [];
    this.storageMode = 'memory';
  }
  async list({ search = '', filter = 'all', sort = 'recent' } = {}) {
    const term = search.trim().toLowerCase();
    const projects = this.projects.filter(project =>
      `${project.name} ${project.description}`.toLowerCase().includes(term) &&
      (filter === 'all' || (filter === 'shared' ? project.shared : !project.shared)));
    projects.sort(sort === 'name' ? (a,b) => a.name.localeCompare(b.name)
      : sort === 'oldest' ? (a,b) => a.updatedAt.localeCompare(b.updatedAt)
      : (a,b) => b.updatedAt.localeCompare(a.updatedAt));
    return projects.map(project => ({ ...project }));
  }
  async get(id) { const project = this.projects.find(item => item.id === id); return project ? { ...project } : null; }
  async create({ name, description = '', category = 'Objects' }) {
    name = name.trim(); description = description.trim();
    if (!name || name.length > 80) throw new Error('Use a project name between 1 and 80 characters.');
    if (description.length > 300) throw new Error('Keep the description under 300 characters.');
    if (!['Objects','Product','Architecture'].includes(category)) throw new Error('Choose a supported category.');
    const project = { id: crypto.randomUUID(), name, description, category, shared: false, thumbnail: 'forms', updatedAt: new Date().toISOString() };
    this.projects.unshift(project);
    this.activity.unshift({ id: crypto.randomUUID(), text: `Created “${name}” in this demo session.`, at: project.updatedAt });
    return { ...project };
  }
  async remove(id) {
    const project = await this.get(id);
    if (!project) throw new Error('Project not found in this session.');
    this.projects = this.projects.filter(item => item.id !== id);
    this.activity.unshift({ id: crypto.randomUUID(), text: `Removed “${project.name}” from this demo session.`, at: new Date().toISOString() });
  }
  async recentActivity() { return this.activity.slice(0, 6).map(item => ({ ...item })); }
}
