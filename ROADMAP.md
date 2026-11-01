# Forma3D development roadmap

Updated: 2026-11-01. Development happens in this local project folder. Commit or
push only when explicitly requested. Preserve `artifacts/` unless a task
specifically needs it.

## Current modeling work

- [x] First-visit English mode/tool notes with anchored arrows, Next/close
  controls and browser persistence, independent of object creation and history.
- [x] Ctrl/Shift-click toggles multiple vertices, edges and faces; selected
  physical vertices move together without moving shared corners twice.
- [x] Rotate and scale component selections around their shared center, with
  toolbar/keyboard controls, transform snapping and Undo/Redo.
- [x] Edit Mode inspector shows the last selection transform during/after gizmo
  dragging and supports exact numeric move/rotation/scale adjustments with history.
- [x] Bevel selected edges, extending the current whole-cube bevel, including
  adjacent/disconnected selections, corner patches and topology-aware history.

## Requested future features

- [ ] Object materials and textures, including controls for their appearance.
- [ ] Additional object shapes beyond Cube, Sphere and Cylinder. Choose the
  initial additional shapes when implementing this feature.
- [ ] Draw lines and 2D shapes and use tools such as Extrude to create 3D forms.
  Plan support for open paths and closed profiles as part of the sketch system.
- [ ] Explode a shape. Clarify the intended operation before implementation:
  separating faces/connected parts, ungrouping, or an exploded assembly view.
- [ ] Apply modeling tools and edits to supported object types generally,
  rather than limiting them to cube-derived meshes. Extend topology handling
  to support the faces used by those other shapes.
- [ ] Export STL as the first planned geometry export, with a defined unit
  convention and geometry validation. STL export does not replace saving the
  editable project or preserve object materials/textures.

## Other candidates to prioritize

- [ ] Boolean union, difference and intersection.
- [ ] Duplicate and delete multiple selected objects in one action.
- [ ] Save/open an editable project, preserving scene structure and geometry.

This is a working backlog, not a declaration that all project requirements have
been captured. Complete the current modeling work before starting export or the
future features above.
