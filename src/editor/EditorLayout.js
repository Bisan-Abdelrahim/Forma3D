// Small inline SVGs keep the interface independent of icon libraries.
export function icon(name) {
  const paths = {
    cube: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9"/>',
    sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    cylinder: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 18c0 4 16 4 16 0"/>',
    group: '<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="m3 3 18 18M9 5c7-2 13 7 13 7l-4 4M6 6l-4 6s5 9 14 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3"/>',
    move: '<path d="M12 2v20M2 12h20m-13-7 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>',
    rotate: '<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',
    scale: '<rect x="3" y="12" width="9" height="9" rx="1"/><path d="m11 13 10-10M14 3h7v7"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
    redo: '<path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
    send: '<path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/>',
    frame: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    magnet: '<path d="M5 3v10a7 7 0 0 0 14 0V3h-5v10a2 2 0 0 1-4 0V3H5ZM5 7h5m4 0h5"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.cube}</svg>`;
}

export function editorLayout() {
  return `
  <header id="toolbar">
    <a class="brand" href="#" aria-label="Forma3D editor">${icon('cube')}<strong>Forma3D</strong></a>
    <span class="project-title">Untitled project</span>
    <nav class="main-menus" aria-label="Editor menus">
      <details class="dropdown" id="add-menu"><summary>Add ${icon('chevron')}</summary>
        <div class="menu-panel"><p class="menu-heading">Primitives</p>
          <button id="add-cube">${icon('cube')}<span>Cube</span></button>
          <button id="add-sphere">${icon('sphere')}<span>Sphere</span></button>
          <button id="add-cylinder">${icon('cylinder')}<span>Cylinder</span></button>
        </div>
      </details>
      <details class="dropdown" id="object-menu"><summary>Object ${icon('chevron')}</summary>
        <div class="menu-panel"><p class="menu-heading">Organize selection</p>
          <button id="group">${icon('group')}<span>Group Selection</span><small>2+ objects</small></button>
          <button id="ungroup">${icon('group')}<span>Ungroup</span></button>
          <hr><button id="duplicate"><span class="menu-symbol">⧉</span><span>Duplicate</span></button>
          <button id="delete" class="danger"><span class="menu-symbol">×</span><span>Delete</span></button>
          <p class="menu-note">Ctrl + click objects to select several.</p>
        </div>
      </details>
      <details class="dropdown" id="view-menu"><summary>View ${icon('chevron')}</summary>
        <div class="menu-panel"><label>Camera<select id="view-preset"><option value="perspective">Perspective</option><option value="front">Front</option><option value="back">Back</option><option value="left">Left</option><option value="right">Right</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
          <label>Display<select id="view-mode"><option value="solid">Solid</option><option value="wireframe">Wireframe</option><option value="xray">X-Ray</option></select></label>
          <hr><button id="frame-selected">${icon('frame')}<span>Frame Selected</span><kbd>F</kbd></button>
        </div>
      </details>
    </nav>
    <div class="history-actions"><button id="undo" class="icon-button" title="Undo" aria-label="Undo">${icon('undo')}</button><button id="redo" class="icon-button" title="Redo" aria-label="Redo">${icon('redo')}</button></div>
    <span class="workspace-badge">Local</span>
  </header>
  <nav id="tool-shelf" aria-label="Modeling tools">
    <button id="edit-mode" class="mode-button" title="Switch Object / Edit Mode (Tab)">Object Mode</button>
    <div class="transform-tools" role="group" aria-label="Transform mode">
      <button id="move-mode" aria-pressed="true" title="Move (M)">${icon('move')}<span>Move</span><kbd>M</kbd></button>
      <button id="rotate-mode" aria-pressed="false" title="Rotate (R)">${icon('rotate')}<span>Rotate</span><kbd>R</kbd></button>
      <button id="scale-mode" aria-pressed="false" title="Scale (S)">${icon('scale')}<span>Scale</span><kbd>S</kbd></button>
    </div>
    <label class="space-control"><span class="sr-only">Transform space</span><select id="transform-space" aria-label="Transform space"><option value="world">World</option><option value="local">Local</option></select></label>
    <details class="dropdown" id="snap-menu"><summary>${icon('magnet')} Snap ${icon('chevron')}</summary><div class="menu-panel">
      <p class="menu-heading">Transform snapping</p>
      <label>Translation<select id="translation-snap"><option value="0">Off</option><option>1</option><option>5</option><option>10</option></select></label>
      <label>Rotation<select id="rotation-snap"><option value="0">Off</option><option value="5">5°</option><option value="15">15°</option><option value="45">45°</option></select></label>
      <label>Scale<select id="scale-snap"><option value="0">Off</option><option>0.1</option><option>0.25</option><option>0.5</option></select></label>
    </div></details>
    <div id="mesh-tools" class="mesh-tools" hidden><span class="group-label">Select</span><button id="vertex-mode">Vertex <kbd>1</kbd></button><button id="edge-mode">Edge <kbd>2</kbd></button><button id="face-mode">Face <kbd>3</kbd></button></div>
    <span class="toolbar-hint">Orbit: drag · Zoom: scroll</span>
    <label hidden><input id="snap" type="checkbox">Snap 1 unit</label>
  </nav>
  <main id="editor">
    <aside class="objects-panel" aria-label="Scene objects">
      <div class="panel-heading"><h2>Objects</h2><span id="object-count" class="count-badge">0</span></div>
      <label class="search-box">${icon('search')}<input id="object-search" type="search" placeholder="Search objects…" aria-label="Search objects" autocomplete="off"></label>
      <div id="outliner" aria-label="Editable objects"></div>
      <p id="outliner-empty" class="empty-message" hidden>No matching objects.</p>
      <footer class="outliner-footer"><p><kbd>Ctrl</kbd> + click to select multiple</p><span id="selection-count">No objects selected</span></footer>
    </aside>
    <section class="viewport-column" aria-label="3D workspace">
      <div id="viewport"></div>
      <footer class="viewport-footer"><p id="tool-status" role="status" aria-live="polite"></p><span><kbd>F</kbd> Frame selected</span></footer>
    </section>
    <aside class="inspector" aria-label="Selection and AI assistant">
      <div class="inspector-properties">
        <div class="panel-heading"><h2>Selection</h2></div>
        <p id="selection-name">No selection</p>
        <p id="property-hint" class="property-hint">Select an object in the scene or Objects list.</p>
        <details class="panel-section" open><summary><span id="transform-title">Object transform</span><small id="transform-context">XYZ</small></summary><div id="properties"></div></details>
        <details class="panel-section" id="shape-tools-panel"><summary>Shape tools <small id="active-shape-tool">Choose a tool</small></summary>
          <div class="shape-tool-groups">
          <div id="object-tools" class="shape-tools"><button id="skew-tool" aria-pressed="false">Skew</button><button id="taper-tool" aria-pressed="false">Taper</button><button id="bend-tool" aria-pressed="false">Bend</button></div>
          <div id="bevel-tools" class="shape-tools"><button id="bevel-tool" aria-pressed="false" title="Chamfer all edges of an unsubdivided cube">Bevel</button></div>
          <div id="face-tools" class="shape-tools" hidden><button id="inset-tool" aria-pressed="false">Inset</button><button id="extrude-tool" aria-pressed="false">Extrude</button></div>
          </div>
          <div id="tool-options"><div id="skew-axes" hidden><label>Tilt<select id="skew-axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label><label>Along<select id="skew-relativeTo"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select></label></div>
          <div id="taper-options" hidden><label>Axis<select id="taper-axis"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select></label><label>End<select id="taper-end"><option value="positive">Positive (+)</option><option value="negative">Negative (−)</option></select></label></div>
          <div id="bend-options" hidden><label>Along<select id="bend-axis"><option value="x">X</option><option value="y" selected>Y</option><option value="z">Z</option></select></label><label>Toward<select id="bend-direction"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label></div></div>
          <p class="section-help">Drag the yellow handle to shape. Esc cancels.</p>
        </details>
      </div>
      <section id="ai-panel" aria-labelledby="ai-title">
        <div class="ai-heading"><h2 id="ai-title">AI Assistant</h2><span class="local-badge">Ollama</span></div>
        <div class="ai-welcome"><p>Create or edit an object with a short instruction.</p></div>
        <p id="ai-status" role="status" aria-live="polite">Ready for your instruction.</p>
        <div class="ai-composer"><label class="sr-only" for="ai-instruction">AI instruction</label><textarea id="ai-instruction" rows="3" maxlength="2000" placeholder="Create a cube 4 units wide…"></textarea><div class="composer-footer"><span>Enter to send · Shift+Enter for newline</span><button id="ai-send" title="Send instruction to local Ollama" aria-label="Send AI instruction">${icon('send')}</button></div></div>
        <p class="ai-footnote">Runs locally. One action at a time.</p>
      </section>
    </aside>
  </main>`;
}
