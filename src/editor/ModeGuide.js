export const GUIDE_STORAGE_KEY = 'forma3d:mode-guides:v1';

const step = (target, title, text) => ({target, title, text});
export const MODE_GUIDES = {
  object: [
    step(['#outliner'], 'Select an object', 'Click a model in the viewport or the Objects list. Ctrl/Shift-click adds or removes objects from the selection.'),
    step(['.transform-tools'], 'Move, rotate and scale', 'Choose a tool and drag the coloured handles. M, R and S switch tools. World/Local changes the gizmo axes.'),
    step(['#edit-mode'], 'Edit the whole object or its parts', 'Object Mode transforms the whole model. Select a Cube and press Tab, or click Object Mode, to edit its vertices, edges and faces.')
  ],
  'edit:vertex': [
    step(['#mesh-tools'], 'Edit Mode', 'Choose Vertex, Edge or Face to work on parts of the mesh. The 1, 2 and 3 keys switch selection types.'),
    step(['#vertex-mode'], 'Select vertices', 'Click a corner point. Ctrl/Shift-click toggles more points, then use Move, Rotate or Scale to reshape the selection.'),
    step(['#transform-title'], 'Enter an exact value', 'Selection transform shows your last edit. Enter an offset, angle or scale factor, then press Enter to apply it.')
  ],
  'edit:edge': [
    step(['#edge-mode'], 'Select edges', 'Click an edge, or Ctrl/Shift-click several. Move, Rotate and Scale act on the selected edges together.'),
    step(['#bevel-tool', '#shape-tools-panel > summary'], 'Bevel selected edges', 'Open Shape tools and choose Bevel to chamfer the selected edges. Drag the yellow handle to control the width. Esc cancels a drag.')
  ],
  'edit:face': [
    step(['#face-mode'], 'Select faces', 'Click a surface, or Ctrl/Shift-click several. Keep exactly one face selected when using Extrude or Inset.'),
    step(['#face-tools', '#shape-tools-panel > summary'], 'Extrude and Inset', 'Extrude pushes a face out or pulls it in. Inset creates a smaller face with a border. Choose a tool in Shape tools and drag its yellow handle.')
  ],
  'transform:object:translate': [step(['#move-mode'], 'Move objects', 'Drag an arrow to move along one axis, or a plane handle to move along two. M selects this tool. Snap sets a fixed movement step.')],
  'transform:object:rotate': [step(['#rotate-mode'], 'Rotate objects', 'Drag a coloured ring to rotate around its axis. R selects this tool. The inspector also accepts exact angles in degrees.')],
  'transform:object:scale': [step(['#scale-mode'], 'Scale objects', 'Drag an axis handle to resize one dimension, or the centre handle to resize uniformly. S selects this tool.')],
  'transform:edit:translate': [step(['#move-mode'], 'Move selected parts', 'Drag an arrow to move the selected vertices, edges or faces. Enter an exact move offset in Selection transform if needed.')],
  'transform:edit:rotate': [step(['#rotate-mode'], 'Rotate selected parts', 'Drag a ring to rotate the selection around its shared centre. Selection transform keeps the last angle so you can adjust it numerically.')],
  'transform:edit:scale': [step(['#scale-mode'], 'Scale selected parts', 'Drag an axis or centre handle to resize the selection around its shared centre. Selection transform accepts exact scale factors.')],
  'tool:skew': [step(['#skew-tool'], 'Skew', 'Drag the yellow handle left or right to tilt the shape. Tilt and Along choose two different axes. Release to apply; Esc cancels the drag.')],
  'tool:taper': [step(['#taper-tool'], 'Taper', 'Choose an axis and the positive or negative end. Drag the yellow handle left to narrow that end, or right to widen it. Esc cancels.')],
  'tool:bend': [step(['#bend-tool'], 'Bend', 'Along chooses the length axis; Toward chooses the bend direction. Drag the yellow handle left or right to bend. Esc cancels.')],
  'tool:bevel': [step(['#bevel-tool'], 'Bevel the whole cube', 'Drag the yellow handle right to chamfer all edges, or left to reduce the width. For individual edges, use Edge selection in Edit Mode.')],
  'tool:bevel-edges': [step(['#bevel-tool'], 'Bevel selected edges', 'Drag the yellow handle right to widen the chamfer, or left to reduce it. Release to apply. The new rim edges stay selected for further editing.')],
  'tool:extrude': [step(['#extrude-tool'], 'Extrude a face', 'With one face selected, drag right to extend it outward or left to pull it inward. Release to apply; Esc cancels. Click Extrude again to return to the gizmo.')],
  'tool:inset': [step(['#inset-tool'], 'Inset a face', 'Drag the yellow handle right to shrink the selected face and create a border. Then use Extrude on the inner face to make a panel or recess. Esc cancels.')]
};

function readSeen(value) {
  try {
    const keys = JSON.parse(value);
    return Array.isArray(keys) ? keys.filter(key => typeof key === 'string' && Object.hasOwn(MODE_GUIDES, key)) : [];
  } catch { return []; }
}

// A UI-only, nonmodal guide. Seen keys describe modes, never objects or projects.
export class ModeGuide {
  constructor(editor, {storage} = {}) {
    this.editor = editor;
    try { this.storage = storage === undefined ? window.localStorage : storage; } catch { this.storage = null; }
    try { this.seen = new Set(readSeen(this.storage?.getItem(GUIDE_STORAGE_KEY))); } catch { this.seen = new Set(); }
    this.previous = null;
    this.context = null;
    this.current = null;
  }

  bind() {
    if (this.root) return;
    this.events = new AbortController();
    const options = {signal: this.events.signal};
    this.root = document.createElement('aside');
    this.root.className = 'mode-guide';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'mode-guide-title');
    const header = document.createElement('div');
    header.className = 'mode-guide-header';
    this.title = document.createElement('h3');
    this.title.id = 'mode-guide-title';
    this.closeButton = document.createElement('button');
    this.closeButton.className = 'mode-guide-close';
    this.closeButton.type = 'button';
    this.closeButton.textContent = '×';
    this.closeButton.setAttribute('aria-label', 'Dismiss tips for this mode');
    this.closeButton.title = 'Close these tips';
    header.appendChild(this.title); header.appendChild(this.closeButton);
    this.text = document.createElement('p');
    this.text.className = 'mode-guide-text';
    const content = document.createElement('div');
    content.setAttribute('aria-live', 'polite');
    content.setAttribute('aria-atomic', 'true');
    content.appendChild(header); content.appendChild(this.text);
    const footer = document.createElement('div');
    footer.className = 'mode-guide-footer';
    this.progress = document.createElement('span');
    this.nextButton = document.createElement('button');
    this.nextButton.type = 'button';
    this.nextButton.className = 'mode-guide-next';
    footer.appendChild(this.progress); footer.appendChild(this.nextButton);
    this.root.appendChild(content); this.root.appendChild(footer);
    document.body.appendChild(this.root);
    this.closeButton.addEventListener('click', () => this.dismiss(true), options);
    this.nextButton.addEventListener('click', () => this.next(), options);
    window.addEventListener('keydown', event => {
      if (!event.defaultPrevented && (event.key === 'Escape' || event.code === 'Escape') && this.current) this.dismiss(true);
    }, options);
    window.addEventListener('resize', this.position, options);
    window.addEventListener('scroll', this.position, {...options, capture: true});
    document.addEventListener('toggle', this.position, {...options, capture: true});
  }

  snapshot() {
    const e = this.editor, mesh = e.mesh;
    const active = ['skew', 'taper', 'bend', 'bevel', 'extrude', 'inset'].find(name => e[`${name}Tool`]?.active);
    return {
      workspace: mesh.editMode ? `edit:${mesh.meshSelectionMode}` : 'object',
      tool: active ? `tool:${active === 'bevel' && mesh.editMode ? 'bevel-edges' : active}` : null,
      transform: e.viewport.transformControls.getMode(),
      editing: mesh.editMode
    };
  }

  update() {
    if (!this.root) return;
    const state = this.snapshot(), previous = this.previous;
    let key = this.context;
    if (!previous || state.workspace !== previous.workspace) key = state.tool ?? state.workspace;
    else if (state.tool !== previous.tool) key = state.tool ?? state.workspace;
    else if (state.transform !== previous.transform && !state.tool) key = `transform:${state.editing ? 'edit' : 'object'}:${state.transform}`;
    this.previous = state;
    if (key !== this.context) {
      this.dismiss();
      this.context = key;
      this.refreshSeen();
      if (Object.hasOwn(MODE_GUIDES, key) && !this.seen.has(key)) this.current = {key, index: 0, target: null, rendered: false};
    }
    if (this.suspendForGesture()) return;
    if (this.current) {
      if (this.current.rendered) this.position();
      else this.render();
    }
  }

  suspendForGesture() {
    if (!this.editor.viewport.transformControls.dragging && !this.editor.modifiers?.transaction) return false;
    // Starting a gesture removes the note without touching the gesture itself.
    if (this.current && !this.seen.has(this.current.key)) {
      this.current.target?.classList.remove('mode-guide-target');
      this.current.target = null;
      this.root.hidden = true;
    } else this.dismiss();
    return true;
  }

  refreshSeen() {
    try { for (const key of readSeen(this.storage?.getItem(GUIDE_STORAGE_KEY))) this.seen.add(key); } catch { /* Session memory still works. */ }
  }

  markSeen(key) {
    if (this.seen.has(key)) return;
    this.refreshSeen();
    this.seen.add(key);
    try { this.storage?.setItem(GUIDE_STORAGE_KEY, JSON.stringify([...this.seen])); } catch { /* Keep session memory when storage is unavailable. */ }
  }

  render() {
    const {key, index} = this.current, steps = MODE_GUIDES[key], note = steps[index];
    this.title.textContent = note.title;
    this.text.textContent = note.text;
    this.progress.textContent = `${index + 1} of ${steps.length}`;
    this.nextButton.textContent = index + 1 < steps.length ? 'Next' : 'Got it';
    this.current.rendered = true;
    this.position();
  }

  visibleTarget(selectors) {
    const width = window.innerWidth || 1280, height = window.innerHeight || 720;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element || element.hidden) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.right <= 0 || rect.left >= width || rect.bottom <= 0 || rect.top >= height) continue;
      if (element.getClientRects && !element.getClientRects().length) continue;
      let clipped = false;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = window.getComputedStyle(parent);
        if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const box = parent.getBoundingClientRect();
        if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) { clipped = true; break; }
      }
      if (!clipped) return element;
    }
    return null;
  }

  position = () => {
    if (!this.current || this.suspendForGesture()) return;
    const target = this.visibleTarget(MODE_GUIDES[this.current.key][this.current.index].target);
    if (this.current.target !== target) {
      this.current.target?.classList.remove('mode-guide-target');
      this.current.target = target;
    }
    if (!target) { this.root.hidden = true; return; }
    target.classList.add('mode-guide-target');
    const width = window.innerWidth || 1280, height = window.innerHeight || 720, margin = 12, gap = 14;
    this.root.style.width = `${Math.min(316, width - margin * 2)}px`;
    this.root.style.maxHeight = `${height - margin * 2}px`;
    this.root.hidden = false;
    const rect = target.getBoundingClientRect(), box = this.root.getBoundingClientRect();
    const candidates = rect.left > width * 0.65 ? ['left', 'bottom', 'top', 'right']
      : rect.top < height * 0.2 ? ['bottom', 'right', 'left', 'top'] : ['right', 'bottom', 'top', 'left'];
    const fits = {
      left: rect.left - gap - box.width >= margin,
      right: rect.right + gap + box.width <= width - margin,
      top: rect.top - gap - box.height >= margin,
      bottom: rect.bottom + gap + box.height <= height - margin
    };
    const side = candidates.find(side => fits[side]) ?? candidates[0];
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    let x = side === 'left' ? rect.left - gap - box.width : side === 'right' ? rect.right + gap : centerX - box.width / 2;
    let y = side === 'top' ? rect.top - gap - box.height : side === 'bottom' ? rect.bottom + gap : centerY - box.height / 2;
    x = Math.max(margin, Math.min(x, width - box.width - margin));
    y = Math.max(margin, Math.min(y, height - box.height - margin));
    this.root.style.left = `${x}px`; this.root.style.top = `${y}px`;
    this.root.dataset.side = side;
    const offset = side === 'left' || side === 'right' ? Math.max(16, Math.min(centerY - y, box.height - 16))
      : Math.max(16, Math.min(centerX - x, box.width - 16));
    this.root.style.setProperty('--guide-arrow-offset', `${offset}px`);
    // A hidden/closed target does not consume the first-visit explanation.
    this.markSeen(this.current.key);
  };

  next() {
    if (!this.current) return;
    if (this.current.index + 1 >= MODE_GUIDES[this.current.key].length) { this.dismiss(true); return; }
    this.current.index++;
    this.render();
  }

  dismiss(restoreFocus = false) {
    const target = this.current?.target;
    const focused = this.root?.contains(document.activeElement);
    target?.classList.remove('mode-guide-target');
    this.current = null;
    if (this.root) this.root.hidden = true;
    if (restoreFocus && focused) {
      const focusTarget = target?.matches('button, input, select, textarea, summary, a[href]') && !target.disabled
        ? target : this.editor.viewport.renderer.domElement;
      focusTarget.focus({preventScroll: true});
    }
  }

  dispose() {
    this.dismiss();
    this.events?.abort();
    this.root?.remove();
    this.root = null;
  }
}
