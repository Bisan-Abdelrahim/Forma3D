import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class SceneViewport {
  constructor(editor) { this.editor = editor; }

  start() {
    window.addEventListener(
      'resize',
      this.resizeRenderer
    );
    this.resizeObserver = new ResizeObserver(this.resizeRenderer);
    this.resizeObserver.observe(this.editor.ui.viewport);
    this.resizeRenderer();
    this.animate();
  }

  setup() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202b38);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(4, 7, 5);
    this.scene.add(keyLight);
    this.camera = new THREE.PerspectiveCamera(
      75, 1, 0.1, 1000
    );
    this.camera.position.set(5, 4, 5);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    this.renderer.domElement.tabIndex = 0;
    this.editor.ui.viewport.appendChild(this.renderer.domElement);
    this.transformControls = new TransformControls(
      this.camera,
      this.renderer.domElement
    );
    this.transformControls.setMode('translate');
    this.scene.add(this.transformControls.getHelper());
    this.controls = new OrbitControls(
      this.camera,
      this.renderer.domElement
    );
    this.controls.enableDamping = true;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.grid = new THREE.GridHelper(20, 20);
    this.grid.position.y = -1;
    this.scene.add(this.grid);
    this.scene.add(new THREE.AxesHelper(3));
  }

  resizeRenderer = () => {
    const width = Math.max(1, this.editor.ui.viewport.clientWidth);
    const height = Math.max(1, this.editor.ui.viewport.clientHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  };

  animate = () => {
    this.animationFrame = requestAnimationFrame(this.animate);

    if (this.controls.enabled) {
      this.controls.update();
    }

    this.editor.skewTool?.update();
    this.editor.taperTool?.update();
    this.editor.extrudeTool?.update();
    this.editor.insetTool?.update();
    this.editor.bevelTool?.update();
    this.editor.bendTool?.update();
    this.renderer.render(this.scene, this.camera);
  };
}
