import test from 'node:test';
import assert from 'node:assert/strict';
import { ModeGuide, MODE_GUIDES, GUIDE_STORAGE_KEY } from '../src/editor/ModeGuide.js';

function memoryStorage(value = null) {
  const data = new Map(value === null ? [] : [[GUIDE_STORAGE_KEY, value]]);
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
}

function fixture(storage = memoryStorage()) {
  class Element extends EventTarget {
    constructor(tag = 'div', bounds = {left: 0, top: 0, width: 316, height: 156}) {
      super(); this.tagName = tag.toUpperCase(); this.bounds = bounds;
      this.children = []; this.hidden = false; this.dataset = {}; this.attributes = {};
      this.style = {setProperty(name, value) { this[name] = value; }};
      const classes = new Set();
      this.classList = {add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)};
    }
    appendChild(element) { this.children.push(element); element.parentElement = this; }
    setAttribute(name, value) { this.attributes[name] = value; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    matches() { return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'A'].includes(this.tagName); }
    focus() { document.activeElement = this; }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    getBoundingClientRect() {
      const left = this.style.left ? parseFloat(this.style.left) : this.bounds.left;
      const top = this.style.top ? parseFloat(this.style.top) : this.bounds.top;
      const width = this.style.width ? parseFloat(this.style.width) : this.bounds.width;
      return {left, top, width, height: this.bounds.height, right: left + width, bottom: top + this.bounds.height};
    }
    getClientRects() {
      for (let node = this; node; node = node.parentElement) if (node.hidden) return [];
      return [this.getBoundingClientRect()];
    }
  }
  const body = new Element('body'), canvas = new Element('canvas'), targets = new Map();
  const doc = new EventTarget();
  Object.assign(doc, {body, activeElement: canvas, createElement: tag => new Element(tag), querySelector: selector => targets.get(selector) ?? null});
  const win = new EventTarget();
  Object.assign(win, {innerWidth: 1280, innerHeight: 720, localStorage: storage,
    getComputedStyle: element => element.overflow ?? {overflowX: 'visible', overflowY: 'visible'}});
  globalThis.document = doc; globalThis.window = win;
  for (const selector of new Set(Object.values(MODE_GUIDES).flatMap(notes => notes.flatMap(note => note.target)))) {
    const tag = selector.includes('summary') ? 'summary' : /-mode$|-tool$/.test(selector) ? 'button' : 'div';
    const bounds = selector === '#outliner' ? {left: 10, top: 190, width: 206, height: 36}
      : /tool$|transform-title|face-tools|summary/.test(selector) ? {left: 980, top: 430, width: 130, height: 30}
      : {left: 145, top: 58, width: 220, height: 30};
    const element = new Element(tag, bounds); body.appendChild(element); targets.set(selector, element);
  }
  const controls = {mode: 'translate', dragging: false, getMode() { return this.mode; }};
  const editor = {mesh: {editMode: false, meshSelectionMode: 'vertex'},
    viewport: {transformControls: controls, renderer: {domElement: canvas}}, modifiers: {transaction: null},
    selection: [1], geometry: [0, 1, 2], history: []};
  for (const name of ['skew', 'taper', 'bend', 'bevel', 'extrude', 'inset']) editor[`${name}Tool`] = {active: false};
  const guide = new ModeGuide(editor); guide.bind();
  return {guide, editor, controls, storage, targets, win, doc, canvas, Element};
}

test('first-visit notes point to tools, advance, and close the entire mode without changing the model', () => {
  const f = fixture(), {guide, editor, targets} = f;
  const model = JSON.stringify({selection: editor.selection, geometry: editor.geometry, history: editor.history});
  guide.update();
  assert.equal(guide.current.key, 'object');
  assert.equal(guide.title.textContent, 'Select an object');
  assert.equal(guide.root.hidden, false);
  assert.equal(guide.root.dataset.side, 'right');
  assert.equal(targets.get('#outliner').classList.contains('mode-guide-target'), true);
  guide.nextButton.dispatchEvent(new Event('click'));
  assert.equal(guide.progress.textContent, '2 of 3');
  assert.equal(targets.get('#outliner').classList.contains('mode-guide-target'), false);
  assert.equal(targets.get('.transform-tools').classList.contains('mode-guide-target'), true);
  guide.closeButton.dispatchEvent(new Event('click'));
  assert.equal(guide.root.hidden, true);
  for (let i = 0; i < 3; i++) { editor.selection = [i + 1]; guide.update(); assert.equal(guide.current, null); }
  editor.selection = [1];
  assert.equal(JSON.stringify({selection: editor.selection, geometry: editor.geometry, history: editor.history}), model);
  assert.deepEqual(JSON.parse(f.storage.getItem(GUIDE_STORAGE_KEY)), ['object']);
  guide.dispose();
});

test('seen modes persist across editor instances, page reloads and switching objects', () => {
  const storage = memoryStorage();
  let f = fixture(storage);
  f.guide.update(); f.guide.dismiss();
  f.editor.mesh.editMode = true; f.guide.update();
  assert.equal(f.guide.current.key, 'edit:vertex');
  f.guide.dismiss(); f.guide.dispose();
  f = fixture(storage); f.guide.update();
  assert.equal(f.guide.current, null);
  f.editor.mesh.editMode = true; f.guide.update();
  assert.equal(f.guide.current, null);
  f.editor.mesh.meshSelectionMode = 'edge'; f.guide.update();
  assert.equal(f.guide.current.key, 'edit:edge');
  f.guide.dismiss(); f.editor.mesh.meshSelectionMode = 'face'; f.guide.update();
  assert.equal(f.guide.current.key, 'edit:face');
  f.guide.next(); f.guide.next();
  assert.equal(f.guide.root.hidden, true);
  f.editor.mesh.meshSelectionMode = 'edge'; f.editor.selection = [99]; f.guide.update();
  assert.equal(f.guide.current, null);
  f.guide.dispose();
});

test('transform and shaping tips are independent and do not restart on unrelated UI updates', () => {
  const {guide, editor, controls} = fixture();
  guide.update(); guide.dismiss();
  controls.mode = 'rotate'; guide.update();
  assert.equal(guide.current.key, 'transform:object:rotate');
  guide.dismiss(); editor.selection = [2]; guide.update();
  assert.equal(guide.current, null);
  editor.mesh.editMode = true; guide.update(); guide.dismiss();
  controls.mode = 'scale'; guide.update();
  assert.equal(guide.current.key, 'transform:edit:scale');
  guide.dismiss();
  editor.mesh.editMode = false; editor.bevelTool.active = true; guide.update();
  assert.equal(guide.current.key, 'tool:bevel');
  guide.dismiss(); editor.mesh.editMode = true; editor.mesh.meshSelectionMode = 'edge'; guide.update();
  assert.equal(guide.current.key, 'tool:bevel-edges');
  guide.dismiss(); editor.bevelTool.active = false; guide.update(); guide.dismiss();
  editor.bevelTool.active = true; guide.update();
  assert.equal(guide.current, null);
  guide.dispose();
});

test('hidden targets wait until visible and are persisted when revealed by scrolling or resize', () => {
  const {guide, targets, storage, win} = fixture();
  targets.get('#outliner').hidden = true;
  guide.update();
  assert.equal(guide.root.hidden, true);
  assert.equal(storage.getItem(GUIDE_STORAGE_KEY), null);
  targets.get('#outliner').hidden = false;
  win.dispatchEvent(new Event('resize'));
  assert.equal(guide.root.hidden, false);
  assert.deepEqual(JSON.parse(storage.getItem(GUIDE_STORAGE_KEY)), ['object']);
  guide.dispose();
});

test('notes wait for a busy operation and disappear when a user starts a gesture', () => {
  const {guide, editor, controls, storage, win} = fixture();
  controls.dragging = true; guide.update();
  win.dispatchEvent(new Event('resize'));
  assert.equal(guide.root.hidden, true);
  assert.equal(storage.getItem(GUIDE_STORAGE_KEY), null);
  controls.dragging = false; guide.update();
  assert.equal(guide.root.hidden, false);
  editor.modifiers.transaction = {}; guide.update();
  assert.equal(guide.root.hidden, true);
  assert.equal(guide.current, null);
  editor.modifiers.transaction = null; guide.update();
  assert.equal(guide.current, null);
  guide.dispose();
});

test('notes use a visible panel fallback and reposition within the viewport as tools are revealed', () => {
  const {guide, editor, targets, win} = fixture();
  editor.mesh.editMode = true; editor.mesh.meshSelectionMode = 'edge';
  targets.get('#bevel-tool').hidden = true;
  guide.update(); guide.next();
  assert.equal(guide.current.target, targets.get('#shape-tools-panel > summary'));
  targets.get('#bevel-tool').hidden = false;
  win.dispatchEvent(new Event('scroll'));
  assert.equal(guide.current.target, targets.get('#bevel-tool'));
  assert.equal(guide.root.dataset.side, 'left');
  assert.equal(targets.get('#shape-tools-panel > summary').classList.contains('mode-guide-target'), false);
  const rect = guide.root.getBoundingClientRect();
  assert.ok(rect.left >= 12 && rect.right <= win.innerWidth - 12);
  assert.ok(rect.top >= 12 && rect.bottom <= win.innerHeight - 12);
  assert.ok(parseFloat(guide.root.style['--guide-arrow-offset']) >= 16);
  guide.dispose();
});

test('closing a note restores keyboard focus; handled Escape keys retain existing tool behavior', () => {
  const {guide, canvas, win} = fixture(); guide.update();
  const handled = new Event('keydown', {cancelable: true});
  Object.defineProperty(handled, 'key', {value: 'Escape'}); handled.preventDefault();
  win.dispatchEvent(handled);
  assert.equal(guide.root.hidden, false);
  guide.closeButton.focus(); guide.closeButton.dispatchEvent(new Event('click'));
  assert.equal(document.activeElement, canvas);
  const {guide: next, win: nextWin} = fixture(); next.update();
  const escape = new Event('keydown'); Object.defineProperty(escape, 'code', {value: 'Escape'});
  nextWin.dispatchEvent(escape);
  assert.equal(next.root.hidden, true);
  guide.dispose(); next.dispose();
});

test('malformed or blocked browser storage never prevents using the editor', () => {
  for (const value of ['broken JSON', '{}', '["__proto__", "unknown", 9]']) {
    const {guide} = fixture(memoryStorage(value));
    assert.doesNotThrow(() => guide.update());
    assert.equal(guide.current.key, 'object'); guide.dispose();
  }
  const {guide, editor} = fixture({getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }});
  assert.doesNotThrow(() => guide.update()); guide.dismiss();
  editor.mesh.editMode = true; guide.update(); guide.dismiss();
  editor.mesh.editMode = false; guide.update();
  assert.equal(guide.current, null);
  guide.dispose();
});

test('saving a newly seen mode merges other tabs and disposed guides remove their UI', () => {
  const storage = memoryStorage('["object"]');
  const {guide, editor, doc, targets} = fixture(storage);
  guide.update(); assert.equal(guide.current, null);
  storage.setItem(GUIDE_STORAGE_KEY, '["object","edit:face"]');
  editor.mesh.editMode = true; editor.mesh.meshSelectionMode = 'edge'; guide.update();
  assert.deepEqual(new Set(JSON.parse(storage.getItem(GUIDE_STORAGE_KEY))), new Set(['object', 'edit:face', 'edit:edge']));
  const root = guide.root; guide.dispose();
  assert.equal(doc.body.contains(root), false);
  assert.equal(targets.get('#edge-mode').classList.contains('mode-guide-target'), false);
});
