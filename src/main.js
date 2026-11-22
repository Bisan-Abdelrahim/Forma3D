import { ConversationService } from './services/ConversationService.js';
import './style.css';
import './styles/platform.css';
import './styles/editor-theme.css';
import { Router } from './routing/Router.js';
import { ProjectService } from './services/ProjectService.js';
import { AuthService } from './services/AuthService.js';
import { mountLanding } from './pages/LandingPage.js';
import { mountAuth } from './pages/AuthPage.js';
import { mountDashboard } from './pages/DashboardPage.js';
import { mountProjects } from './pages/ProjectsPage.js';
import { mountEditor } from './pages/EditorPage.js';
import { mountNotFound } from './pages/NotFoundPage.js';

const auth = new AuthService();
const router = new Router({
  root: document.querySelector('#app'),
  services: { projects: new ProjectService({auth}), auth, conversations: new ConversationService({auth}) },
  routes: {
    '/': { title:'Ideas take shape here', mount:mountLanding },
    '/login': { title:'Log in', mount:mountAuth },
    '/register': { title:'Create an account', mount:mountAuth },
    '/dashboard': { title:'Overview', protected:true, mount:mountDashboard },
    '/projects': { title:'My projects', protected:true, mount:mountProjects },
    '/editor/:projectId': { title:'Editor', protected:true, mount:mountEditor },
    '404': { title:'Page not found', mount:mountNotFound }
  }
});
router.start();
if (import.meta.hot) import.meta.hot.dispose(() => router.dispose());
