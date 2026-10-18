# Forma3D — modular Vanilla JavaScript editor

HTML, CSS, vanilla JavaScript, Three.js and Vite only. AI returns one JSON
command; `validateCommand` checks it before `executeCommand` touches the scene.
No generated JavaScript is evaluated. No conversation history is stored.

## Run locally (Windows)

1. Install [Ollama](https://ollama.com/) and run `ollama pull llama3.2`.
2. Keep Ollama available at `http://localhost:11434`. If the browser reports a
   CORS error, quit the Ollama tray application, then in PowerShell run:

   ```powershell
   $env:OLLAMA_ORIGINS="http://localhost:5173"
   ollama serve
   ```

   Keep its default loopback binding; do not expose it to the network.
3. In the project directory run `npm.cmd ci`, then
   `npm.cmd run dev -- --host localhost --port 5173 --strictPort`.
4. Open `http://localhost:5173`. A different installed local model can be selected
   with `VITE_OLLAMA_MODEL` in `.env.local`; restart Vite after changing it.

API reference: [Ollama chat](https://docs.ollama.com/api/chat),
[origin configuration](https://docs.ollama.com/faq).

This integration uses a local AI service with no provider secret. It requires
Ollama and a downloaded model; it is not a cloud-provider integration.
`VITE_*` variables are public browser configuration, **not secret storage**.
Do not put an AI provider key in `VITE_AI_API_KEY` or client code. Secure calls
to a cloud provider using a secret require a trusted server/proxy, which would
require revisiting the no-backend constraint.

## Try five prompts in order

1. `Create a cube with width 4, height 2 and depth 3 at x 0, y 0, z 0.`
2. `Move the selected object to x 3, y 1, z 0.`
3. `Rotate the selected object to x 0, y 90, z 0 degrees.`
4. `Set the selected object's scale to x 2, y 1, z 1.`
5. `Delete the selected object.`

After each, check Objects, selection/gizmo and Properties; try Undo and Redo.
For the create prompt, base cube dimensions are 2×2×2, so Properties shows scale
2×1×1. Scaling sets absolute factors relative to the editor's base geometry.
Also try `Create a sphere with radius 2` and `Create a cylinder with radius 1
and height 4` as alternatives to prompt 1.

Move/rotate/scale set absolute transforms; rotation is in degrees. Targets are
`selected` or an existing numeric editor ID. Missing selections, unsupported
commands, extra fields, invalid numbers, arrays, and markdown/code are rejected.
If scene or selection changes during the request, resend the instruction.
AI interpretation depends on the local model; API failures leave the scene unchanged.
AI moves use explicit coordinates, independent of the manual gizmo's snap setting.

## Verify

`npm.cmd test`

`npm.cmd run build`


## Modular editor and mesh editing

`src/main.js` now only loads CSS and starts `EditorApp`. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for service responsibilities, history rules,
and a concrete path for adding geometry tools.

The current GitHub mesh-editing features are included: select a cube, choose
**Edit Mode**, then **Vertex**, **Edge**, or **Face**. Move the selection with the
translation gizmo. Shift-click adds/removes vertices. **Tab** switches modes when
the canvas is focused; **1/2/3** switch mesh selection. **M/R/S** switch object
Move/Rotate/Scale. Mesh editing currently supports the original cube topology;
it does not implement extrusion, bevel, boolean operations, or arbitrary meshes.

Deformed vertices survive Duplicate and Undo/Redo. Undo/Redo restores objects and
selection and exits Edit Mode. Grid snap applies to manual gizmo translation.
AI commands remain object-level and are rejected during a drag or Edit Mode.


### Manual Skew (Object Mode)
Select a cube, press **Skew**, then drag the yellow **↔ Skew** handle above it
left or right. Release to commit one undo action. **Escape** during the drag
restores the exact original geometry; Escape again exits the tool. M/R/S or
Edit Mode also exit the tool. Clicking another object exits it normally.

The minimal gesture is intentionally screen-horizontal: 120 pixels = 1 unit
of shear on the selected local axes, clamped to ±10. Use the compact Tilt/along selectors shown while Skew is active to choose any of the six distinct axis pairs. Choosing the other axis swaps the pair automatically; selectors lock during dragging. This remains usable when
the local axis points toward the camera. It tilts both ends around local zero,
matching the AI skew formula; it does not pin the bottom face. Object transforms
and editor ID are preserved. The handle follows the positive reference-axis bounding-box face center.
Orbit remains available outside the handle and is suspended only while dragging.

`tools/SkewTool.js` owns the gesture/overlay and abortable listeners;
`ModifierService` owns preview/commit/cancel transactions; `SkewModifier`
owns geometry math. Preview always uses the original geometry. Intermediate
geometries are disposed; cancel retains the original, commit releases it only
when unshared. `skewTool.dispose()` cancels, removes the overlay and its listeners.
History uses the existing scene snapshot restore with stable editor IDs.


### Taper (Object Mode)
Select a cube and press **Taper**. Choose local **Axis X/Y/Z** and **End +/−**.
Drag the handle left to narrow that end, right to widen; release commits one undo
step. Escape cancels, a second Escape exits. The opposite end remains fixed.
120 horizontal pixels changes the end scale by 1: -60 px halves its width/depth,
+120 px doubles them. Scale is clamped to 0.05..4 to prevent collapse/inversion.
The two perpendicular coordinates scale around the current local bounding-box
center; the selected axis length stays unchanged. Operations compose with existing
deformations. Currently supports cubes only, matching snapshot history support.

AI supports `{"action":"taper","target":"selected","axis":"y","end":"positive","amount":-0.5}`.
TaperModifier owns geometry math, TaperTool owns its axis/end settings, and
ModifierDragTool shares pointer capture, cancellation, control isolation, projection
and disposal with SkewTool. ModifierService retains transaction/history ownership.


### Extrude (Edit Mode)
Select a cube → Edit Mode → Face → click a face → **Extrude**.
Drag its yellow handle right to extend outward along the local face normal,
left for negative extrusion. 120 screen pixels = 1 local unit; range ±10.
Release records one undo step; Escape cancels without adding history, and a
second Escape exits. A click/release without movement adds no walls or undo step.
Select another face (including a newly created wall) to repeat. Switch selection
mode or exit Edit Mode to leave the tool. Orbit works outside the handle.

The existing cap moves and four new quad walls connect it to the original rim;
this keeps the same scene object/editor ID. Vertex and edge editing, duplication,
undo/redo, Skew and Taper support the resulting quad topology. History now stores
positions, indices and UVs and rebuilds correctly sized normals on restore.
ExtrudeModifier owns topology changes, QuadTopology reads quad boundaries,
ExtrudeTool owns the selected-face gesture and marker refresh, and ModifierService
owns preview transactions. No dependencies were added. This is a manual tool;
it does not add an AI face-selection command.

Negative extrusion is a signed face extrusion, not a Boolean cut. Deep inward
moves or extrusion of already folded/nonplanar faces can intersect other surfaces;
there is no collision or self-intersection solver in this minimal version.
Validation: `npm test` includes boundary closure/orientation on all six cube faces,
repeated extrusion of a new side wall, cancel/no-op, history, duplicate, edge/face
selection, normal sizes on restore, and subsequent Skew/Taper operations.


### Bend (Object Mode)
Select a cube → **Bend** → choose **Along** (length axis) and **Toward** (different
local axis). Drag the handle horizontally: 120 pixels = 90°, signed range ±180°.
The minimum-axis end stays fixed. Release commits one undo step; Escape cancels
and restores the exact original geometry, including topology. A click or zero-angle
release adds no subdivisions/history. Options lock during dragging.

BendModifier uses cylindrical cross-section rotation in local coordinates.
QuadSubdivision refines the current quad surface along the bend axis (target 16
segments across the current length); it preserves prior Skew/Taper/Extrude edits,
UV interpolation and quad selection. It never replaces the mesh object/ID.
Subdivision is bounded at 8192 quads to limit repeated-operation memory growth.
Normals remain per-quad, so the curve is geometrically segmented rather than a
smooth shading surface. Tight bends on thick meshes may fold/intersect; there is
no collision solver. Current support is cube-derived editable meshes only.

AI example: `{"action":"bend","target":"selected","axis":"y","direction":"x","angle":90}`.
Tests cover all six axis pairs, anchored end, source preservation, automatic
refinement, cancel/no-op, single undo/redo, duplication and subsequent Extrude/Bend.


### Inset (Edit Mode)
Select a cube → Edit Mode → Face → select a face → **Inset**.
Drag right to shrink the inner face and add a four-quad border; drag back left to
reduce the inset. 60 pixels leaves the inner face at half size; maximum inset is
95% to avoid collapse. Release records one undo step, Escape restores the exact
original geometry. No movement adds no geometry/history. The inner face keeps
its selection: switch directly to **Extrude** and drag left for a recess or right
for a raised panel. New border faces can also be selected and edited.

This minimal Inset is proportional scaling about a planar convex quad's center,
not a constant-width offset on irregular faces. Nonplanar/concave/degenerate faces
are rejected with a toolbar status message and the original geometry restored.
InsetModifier owns topology/UV changes; FaceModifierTool shares selected-face
projection, marker refresh and lifecycle between InsetTool and ExtrudeTool.
The same object and editor ID are preserved, with topology-aware history and
duplication. No new dependencies; this tool is manual only.


### Bevel (Object Mode, all edges)
Select a cube → **Bevel** → drag the yellow corner handle right to widen the
chamfer, left to reduce it. 120 pixels = 25% of adjacent local edge lengths;
maximum is 45%. Release records one undo step; Escape cancels exactly. A
zero-width release preserves the original topology and creates no history.

This first version is a single-segment, all-edge chamfer on a closed convex cube
with six planar quad faces/eight corners. It supports original cubes and flat-faced
Skew/Taper results. It rejects subdivided, extruded, inset, already bevelled,
nonplanar or nonconvex meshes with a toolbar message and restores the original.
Individual-edge selection and rounded multi-segment bevels are not implemented.
The bevel is proportional to adjacent edge lengths, not a constant world-space
width. Object transforms/editor ID are preserved. Output uses independent quads
for face patches, twelve chamfer strips and eight corner patches, preserving
compatibility with selection/history/duplicate and subsequent mesh editing.
BevelModifier owns validation/topology, BevelTool owns the gesture, and the
existing ModifierDragTool/ModifierService provide preview, cleanup and history.
This tool is manual only. Tests cover closure, orientation, nondegenerate faces,
bounds, source preservation, cancel/no-op, undo/redo, duplicate and edit selection.
