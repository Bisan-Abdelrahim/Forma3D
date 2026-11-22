> Historical Phase 1 notes. For the current Supabase-backed services and setup, see [SUPABASE.md](./SUPABASE.md).

# Forma3D frontend platform — Phase 1

The project still uses Vite, native JavaScript modules, Three.js, HTML and CSS.
No dependencies, backend, database, authentication tokens or scene persistence were added.

## Run

- `npm run dev` starts Vite. Open its printed local URL.
- `npm test` runs the existing modeling suite and the new platform/lifecycle tests.
- `npm run build` creates `dist/`.

## Routes

| URL | Behavior |
| --- | --- |
| `/` | Responsive landing page, features and illustrative gallery. |
| `/login` | Local validation and password visibility. Authentication explicitly disconnected. |
| `/register` | Local validation, confirmation and visibility controls. No account creation. |
| `/dashboard` | Demo project counts, recent/shared examples and session activity. |
| `/projects` | Search/filter/sort, create/remove demo metadata, open editor. |
| `/editor/demo` | Always-available existing editor, starting with a fresh cube. |
| `/editor/:projectId` | Looks up session metadata, displays the name and starts a fresh editor. No scene loading. |

Vite provides SPA fallback for direct development URLs. A future static host must
rewrite non-asset routes to `index.html`. Browser back/forward are handled by the router.

## Services and data boundaries

`ProjectService` owns a copy of `mockProjects` and all project data access.
Create/remove only change memory. A full refresh resets metadata and activity.
No scene is stored in these records. Thumbnails are vector illustrations, not saved
scene previews. Missing/expired IDs show an explicit message and demo-editor link.

`AuthService` exposes `login`, `register` and `getCurrentUser`. It currently rejects
sign-in/registration with a clear not-connected message. Form validation and password
visibility work, but credentials are never submitted, persisted or logged. Later,
replace its methods with API calls backed by secure server-side sessions.
The dashboard is an openly accessible development preview, not an authenticated page.

Collaboration, asset-library browsing, public uploads, measurements and design
analysis are labeled as planned. No success claims or fake saved states are used.

## Editor lifecycle

`EditorPage` lazily imports the existing `EditorApp`; it does not recreate modeling
services or substitute another renderer. One mounted editor owns one WebGL renderer.
Leaving the route calls `EditorApp.dispose()` to abort local AI requests, remove global
and Three.js listeners, cancel modifier previews, remove guides/handles, release mesh
and helper resources, disconnect ResizeObserver, cancel animation, and dispose
OrbitControls, TransformControls, renderer and its context.

The `listen` helper tracks persistent listeners. Listeners on removed local DOM nodes
are collected with their nodes, avoiding retained Outliner rows. Existing tool and
guide AbortControllers retain their own cleanup. Late AI replies cannot mutate an
unmounted editor. The local Ollama endpoint, model, validation and commands are preserved.

Editor changes are discarded on navigation/reload. The editor shows an unsaved-demo
notice; no project saving/loading or auto-save is implied. Ollama must be running
locally, with its allowed origins configured for the Vite URL being used.

## Files

Created:
- `src/pages/LandingPage.js`, `AuthPage.js`, `DashboardPage.js`, `ProjectsPage.js`, `EditorPage.js`, `NotFoundPage.js`
- `src/components/Shell.js`, `ProjectCards.js`, `ProjectDialog.js`
- `src/routing/Router.js`
- `src/services/AuthService.js`, `ProjectService.js`, `mockProjects.js`
- `src/styles/platform.css`, `editor-theme.css`
- `tests/platform.test.js`
- `PLATFORM.md`

Modified:
- `src/main.js`, `index.html`, `src/ai.js`
- `src/editor/EditorApp.js`, `SceneViewport.js`, `EditorUI.js`, `InputController.js`, `ViewService.js`, `AIController.js`
- `tests/commands.test.js`, `README.md`

The original `src/style.css` remains intact. Theme changes are scoped overrides.

## Manual checks

1. Visit `/`, follow Features/Gallery anchors and navigate to both auth forms.
2. Submit invalid fields; check password toggles and the disconnected-backend message.
3. Open Dashboard without signing in; note that counts and shared cards are demo data.
4. On Projects, search, change filters/sort, create a demo project and remove it through its action menu.
5. Open a project: its name appears, but the viewport starts fresh. Try M/R/S, Ctrl-click,
   Group/Ungroup, Properties, Undo/Redo, Edit Mode and existing modifiers.
6. Return to Projects, reopen the editor, and use browser Back/Forward. There should only
   be one canvas and no leftover guide/handle overlays.
7. Refresh Projects to verify demo metadata resets. Directly load `/editor/demo`, and try
   an expired project ID to check its fallback.
8. Check landing/auth/projects at narrow and desktop widths. The existing editor remains
   a desktop-first workspace.
