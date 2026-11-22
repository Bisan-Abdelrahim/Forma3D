import { ObjectWorkflow } from './ObjectWorkflow.js';
import { ViewService } from './ViewService.js';
import { BevelTool } from './tools/BevelTool.js';
import { BevelModifier } from './modifiers/BevelModifier.js';
import { EdgeBevelModifier } from './modifiers/EdgeBevelModifier.js';
import { InsetTool } from './tools/InsetTool.js';
import { InsetModifier } from './modifiers/InsetModifier.js';
import { BendTool } from './tools/BendTool.js';
import { BendModifier } from './modifiers/BendModifier.js';
import { ExtrudeTool } from './tools/ExtrudeTool.js';
import { ExtrudeModifier } from './modifiers/ExtrudeModifier.js';
import { TaperTool } from './tools/TaperTool.js';
import { TaperModifier } from './modifiers/TaperModifier.js';

import { EditorUI } from './EditorUI.js';
import { SceneViewport } from './SceneViewport.js';
import { EditorState } from './EditorState.js';
import { MeshEditor } from './MeshEditor.js';
import { ObjectService } from './ObjectService.js';
import { SelectionService } from './SelectionService.js';
import { HistoryService } from './HistoryService.js';
import { CommandService } from './CommandService.js';
import { AIController } from './AIController.js';
import { SkewTool } from './tools/SkewTool.js';
import { InputController } from './InputController.js';

// Modifier System
import { ModifierService } from './ModifierService.js';
import { SkewModifier } from './modifiers/SkewModifier.js';

// Composition root: create services before binding callbacks.
export class EditorApp {
  constructor({
    createViewport = editor => new SceneViewport(editor),
    requestAICommand
  } = {}) {

    this.disposed = false;
    this.events = new AbortController();
    this.listenerCleanup = [];

    // User Interface
    this.ui = new EditorUI(this);

    // Three.js Viewport
    this.viewport = createViewport(this);

    // Editor State
    this.state = new EditorState();

    // Mesh Editing
    this.mesh = new MeshEditor(this);

    // Object Management
    this.objects = new ObjectService(this);

    // Selection Management
    this.selection = new SelectionService(this);
    this.workflow = new ObjectWorkflow(this);
    this.views = new ViewService(this);

    // Undo / Redo
    this.history = new HistoryService(this);

    // Geometry Modifiers
    this.modifiers = new ModifierService(this);

    // Register available modifiers
    this.modifiers.register(
      'skew',
      new SkewModifier()
    );

    // Command Execution
    this.commands = new CommandService(this);

    // AI Integration
    this.ai = new AIController(this, requestAICommand);

    // Keyboard / Mouse Input
    this.input = new InputController(this);
    this.skewTool = new SkewTool(this);
    this.taperTool = new TaperTool(this);
    this.extrudeTool = new ExtrudeTool(this);
    this.insetTool = new InsetTool(this);
    this.bevelTool = new BevelTool(this);
    this.modifiers.register('bevel',new BevelModifier());
    this.modifiers.register('edgeBevel', new EdgeBevelModifier());
    this.modifiers.register('inset', new InsetModifier());
    this.bendTool = new BendTool(this);
    this.modifiers.register('bend', new BendModifier());
    this.modifiers.register('extrude', new ExtrudeModifier());
    this.modifiers.register('taper', new TaperModifier());
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    // Removed Outliner rows should be garbage-collected during long editing sessions.
    // Only persistent targets need explicit removal when leaving the editor.
    const localElement = typeof Element !== 'undefined' && target instanceof Element && target !== this.viewport.renderer?.domElement;
    if (!localElement) this.listenerCleanup.push(() => target.removeEventListener?.(type, handler, options));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.events.abort();
    this.ai.disposed = true;
    for (const name of ['skewTool','taperTool','extrudeTool','insetTool','bevelTool','bendTool']) {
      if (this[name]?.handle) this[name].dispose();
      else this[name]?.events?.abort();
    }
    if (this.modifiers.transaction) this.modifiers.endPreview(false);
    this.ui.guide?.dispose();
    this.selection.endTransform();
    if (this.mesh.vertexMarkers) this.mesh.clearVertexMarkers();
    for (const cleanup of this.listenerCleanup.splice(0)) cleanup();
    // Marker geometry is shared between markers, so dispose each resource once.
    const geometries = new Set();
    const materials = new Set();
    const collect = object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of [object.material].flat()) if (material) materials.add(material);
    };
    this.viewport.transformControls?.getHelper?.().removeFromParent();
    this.viewport.scene?.traverse(collect);
    for (const value of Object.values(this.mesh)) {
      if (value?.isBufferGeometry) geometries.add(value);
      if (value?.isMaterial) materials.add(value);
    }
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.viewport.dispose?.();
    this.state.objects.length = 0;
    this.state.selectedObjects.length = 0;
    this.state.selectedObject = null;
    this.history.undoHistory.length = 0;
    this.history.redoHistory.length = 0;
  }

  start() {

    // Initialize UI
    this.ui.mount();

    // Initialize Three.js scene
    this.viewport.setup();

    // Initialize Mesh Editor
    this.mesh.initialize();

    // Bind UI Events
    this.ui.bindProperties();
    this.ui.bindToolbar();

    // Bind AI Input
    this.ai.bind();

    // Bind Keyboard / Mouse Events
    this.input.bind();
    this.views.bind();
    this.skewTool.bind();
    this.taperTool.bind();
    this.extrudeTool.bind();
    this.insetTool.bind();
    this.bevelTool.bind();
    this.bendTool.bind();

    // Create default object
    this.objects.createInitialObject();

    // Start rendering
    this.viewport.start();

    return this;
  }
}
