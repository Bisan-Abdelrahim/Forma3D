# Forma3D architecture

## Migration basis

The local checkout was based on `31fa091`, with additional uncommitted AI work.
The fetched GitHub `main` was `6b8ec7f` (2026-10-18). This refactor combines its
cube vertex/edge/face editing with the local strict AI validator, request length
limit, stale-response protection and scale-based dimensions. No remote branch
was merged, reset or pushed. Files under the project's `sources/` were not edited.
Local before/after-reference inputs remain in the ignored `.refactor-reference/`
folder; production code does not import them.

## Files and responsibilities

| File under `src/editor/` | Responsibility |
| --- | --- |
| `EditorApp.js` | Composition and startup order; one shared editor context per app. |
| `EditorState.js` | Editable objects, selected object, names, IDs and selection colors. |
| `SceneViewport.js` | Three.js scene, camera, renderer, OrbitControls, TransformControls, grid, resize and render loop. |
| `ShapeFactory.js` | Geometry/material construction and base geometry dimensions, independent of DOM/history. |
| `ObjectService.js` | Add, duplicate and delete; assigns IDs, updates scene, disposes removed GPU resources. |
| `SelectionService.js` | Selection color, gizmo attachment, leaving Edit Mode and refreshing panels. |
| `MeshEditor.js` | Cube vertex groups, edge and face selection, marker visuals and deformation. |
| `HistoryService.js` | Plain snapshots, undo/redo stacks and reconstruction of deformed meshes. |
| `EditorUI.js` | HTML, toolbar wiring, Outliner, Properties and enabled/disabled states. |
| `InputController.js` | Keyboard/pointer input, raycasting, drag boundaries and snap. |
| `CommandService.js` | Validated AI commands and AI scene context; delegates mutations to editor services. |
| `AIController.js` | Request lifecycle, busy/error feedback and stale-scene detection. |

`src/main.js` is the four-line entry point. `src/ai.js` remains the Ollama
transport and strict command schema. There are no new runtime or development
dependencies: only Vanilla JavaScript ES Modules, Three.js and Vite. Tests use
Node's built-in test runner and real Three.js geometry.

## Practical SOLID boundaries

Each service owns one editor concern. `ShapeFactory` is separate from object
lifecycle. The AI command boundary validates before mutation, including callers
that bypass the transport. The request function and viewport can be injected
through `EditorApp` options, allowing tests without Ollama or WebGL.

Services share the `EditorApp` context to coordinate selection, geometry and UI.
This is a deliberate first migration, not a claim of complete dependency
isolation. UI refreshes are still direct calls, and `MeshEditor` remains the
largest cohesive unit. There is no abstract base-class hierarchy, generic command
framework or event bus. Split topology/visuals and introduce narrow event ports
only when another tool or UI actually needs those boundaries.

## Invariants to preserve

- Only `state.objects` participate in object selection; helpers are excluded.
- TransformControls registers before OrbitControls so a gizmo drag owns input.
- Object actions, property input and a complete gizmo drag each record snapshots.
  Selection alone and no-op transforms do not erase redo history.
- Snapshots contain IDs, counters, geometry dimensions, cube position buffers,
  transforms and selected ID. Restoring disposes replaced meshes, exits Edit Mode
  and reattaches the gizmo to the restored object. Duplicate clones geometry and
  material without copying editing helpers.
- AI dimensions retain the local representation: a cube has base dimensions
  2×2×2, and requested 4×2×3 dimensions produce scale 2×1×1.5. AI scale commands
  are absolute factors relative to base geometry. `getDimensions()` reports base
  parameters, not a deformed mesh's bounding box; tools needing physical extents
  should calculate a bounding box and apply the object transform.
- Properties display degrees; Three.js stores radians. Input fields do not
  trigger tool shortcuts. Grid snap affects the translation gizmo, including
  mesh editing; explicit AI coordinates remain independent of snap.
- AI supports one create/move/rotate/scale/delete action. It cannot run during
  Edit Mode or dragging. Replies are rejected when the full scene/selection
  snapshot differs from the request's snapshot. No generated code is evaluated.

## Adding advanced geometry tools

1. Start with a concrete `tools/ExtrudeTool.js` or `tools/BevelTool.js` exposing
   `canApply(selection)` and `apply(selection, options)`. Keep geometry math out
   of `main.js`, DOM handlers and the AI transport.
2. Before topology-changing operations, introduce `geometry/MeshTopology.js` to
   own stable vertex/edge/face identifiers and adjacency. Current cube selection
   groups duplicated BoxGeometry vertices and assumes 24 buffer positions with
   six quad faces. It is not suitable for arbitrary topology after extrusion.
3. Extend history serialization *before* adding/removing vertices. Current
   snapshots restore cube position buffers onto original primitive topology;
   extrusion needs position, index, normals/UVs/groups and tool metadata, or a
   complete BufferGeometry serializer. Restoring into an unchanged primitive
   buffer will not be sufficient.
4. Wrap one tool operation in `takeSnapshot()` / `recordAction(before)`, roll back
   on failure, then rebuild markers and refresh Properties/Outliner. Recompute
   normals and bounding volumes. A full drag is still one undo step.
5. Expose the tool through `EditorUI` and `InputController`. If adding an AI action,
   extend `validateCommand`, the Ollama instructions and `CommandService` together;
   never let the model call arbitrary methods or return executable JavaScript.
6. Test topology, transformed/scaled meshes, duplicate, selection, undo/redo,
   invalid inputs and stale AI replies with real Three.js buffers.

## Verification

Run `npm.cmd test` and `npm.cmd run build`. Automated tests cover AI validation,
all primitive/action types, undo/redo, cube vertex/edge/face deformation,
duplication, multiselection, Properties, snap, drag locks, keyboard shortcuts,
raycast click-versus-drag and stale AI replies. The DOM/renderer boundary is a
small test adapter; these tests do not substitute for visual GPU interaction.
For a manual check, focus the canvas and test M/R/S, Tab, 1/2/3, Shift-click,
gizmo dragging, camera orbit, Undo/Redo and Ollama success/failure.
