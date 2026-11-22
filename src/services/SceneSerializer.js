import * as THREE from 'three';
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUUID=value=>typeof value==='string'&&uuidPattern.test(value);

export function materialSnapshot(material, editor) {
  if (Object.values(material).some(value=>value?.isTexture)) throw new Error('Texture-backed materials require the project asset pipeline before they can be saved.');
  const copy=material.clone(); copy.uuid=material.uuid;
  Object.assign(copy,editor.views?.materialDefaults?.get(material)??{});
  if (copy.color) copy.color.copy(editor.selection.baseColor(material));
  const json=copy.toJSON(); copy.dispose(); return json;
}
export function serializeScene(editor) {
  if (editor.viewport.transformControls.dragging || editor.modifiers.transaction) throw new Error('Finish the active modeling operation before saving.');
  const objects=editor.state.objects.map(object=>{
    object.userData.persistentId ??= crypto.randomUUID();
    let geometry=null;
    if (object.isMesh) {
      // Primitive toJSON() only saves its constructor parameters, losing edited vertices.
      const buffer=new THREE.BufferGeometry().copy(object.geometry); buffer.uuid=object.geometry.uuid;
      geometry=buffer.toJSON(); buffer.dispose();
    }
    return {id:object.userData.editorId,persistentId:object.userData.persistentId,type:object.userData.type,name:object.name,
      parentId:editor.state.objects.includes(object.parent)?object.parent.userData.persistentId:null,
      position:object.position.toArray(),rotation:object.rotation.toArray(),scale:object.scale.toArray(),
      visible:object.visible,locked:!!object.userData.locked,dimensions:object.isMesh?editor.objects.getDimensions(object):{},
      geometry,materials:object.isMesh?[object.material].flat().map(material=>materialSnapshot(material,editor)):[],
      drawRange:object.isMesh?{start:object.geometry.drawRange.start,count:Number.isFinite(object.geometry.drawRange.count)?object.geometry.drawRange.count:null}:null};
  });
  const camera=editor.viewport.camera;
  const snapshot={format:'forma3d-scene',version:1,objects,nameCounts:{...editor.state.nameCounts},nextObjectId:editor.state.nextObjectId,
    selectedIds:editor.state.selectedObjects.map(object=>object.userData.editorId),
    camera:{near:camera.near,far:camera.far,fov:camera.isPerspectiveCamera?camera.fov:null,orthographic:!!camera.isOrthographicCamera,position:camera.position.toArray(),up:camera.up.toArray(),target:editor.viewport.controls.target?.toArray()??[0,0,0],zoom:camera.zoom,orthoHeight:editor.viewport.orthoHeight??10}};
  validateScene(snapshot); return snapshot;
}
function finiteArray(value,size) { return Array.isArray(value)&&value.length===size&&value.every(Number.isFinite); }
export function validateScene(scene) {
  if (scene?.format!=='forma3d-scene'||scene.version!==1||!Array.isArray(scene.objects)||scene.objects.length>1000) throw new Error('Unsupported or oversized Forma3D scene.');
  const ids=new Set(),persistentIds=new Set(),byId=new Map(); let vertices=0;
  for (const object of scene.objects) {
    if (!Number.isSafeInteger(object.id)||object.id<1||ids.has(object.id)||!isUUID(object.persistentId)||persistentIds.has(object.persistentId)||!['Cube','Sphere','Cylinder','Group'].includes(object.type)) throw new Error('Invalid or duplicate object identifier.');
    ids.add(object.id);persistentIds.add(object.persistentId);byId.set(object.persistentId,object);
    if (typeof object.name!=='string'||!object.name.trim()||object.name.length>150||!finiteArray(object.position,3)||!finiteArray(object.rotation.slice?.(0,3),3)||!finiteArray(object.scale,3)||!['XYZ','XZY','YXZ','YZX','ZXY','ZYX'].includes(object.rotation[3])) throw new Error('Invalid object transform.');
    if (object.type==='Group') { if(object.geometry||object.materials?.length) throw new Error('Invalid group payload.'); continue; }
    const attributes=object.geometry?.data?.attributes,position=attributes?.position;
    if (!position||position.type!=='Float32Array'||position.itemSize!==3||!Array.isArray(position.array)||position.array.length%3) throw new Error('Missing mesh positions.');
    vertices+=position.array.length/3;
    if(vertices>2000000) throw new Error('Scene has too many vertices.');
    if(Object.keys(attributes).some(name=>!['position','normal','uv','uv1','color','tangent'].includes(name))||Object.keys(object.geometry.data.morphAttributes??{}).length)throw new Error('Unsupported geometry attributes.');
    for(const attribute of Object.values(attributes)) {
      if(!['Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array'].includes(attribute.type)||!Number.isInteger(attribute.itemSize)||attribute.itemSize<1||attribute.itemSize>4||!Array.isArray(attribute.array)||attribute.array.length>8000000||!attribute.array.every(Number.isFinite)) throw new Error('Invalid geometry attribute.');
    }
    const index=object.geometry.data.index;
    if(index&&(!['Uint16Array','Uint32Array'].includes(index.type)||!Array.isArray(index.array)||index.array.length>12000000||index.array.length%3||!index.array.every(n=>Number.isSafeInteger(n)&&n>=0&&n<position.array.length/3))) throw new Error('Invalid mesh indices.');
    if(object.drawRange&&(!Number.isSafeInteger(object.drawRange.start)||object.drawRange.start<0||(object.drawRange.count!==null&&(!Number.isSafeInteger(object.drawRange.count)||object.drawRange.count<0))))throw new Error('Invalid geometry draw range.');
    if(!Array.isArray(object.materials)||!object.materials.length||object.materials.length>16) throw new Error('Missing mesh materials.');
    for(const group of object.geometry.data.groups??[])if(!Number.isSafeInteger(group.start)||group.start<0||!Number.isSafeInteger(group.count)||group.count<0||group.start+group.count>(index?.array.length??position.array.length/3)||!Number.isSafeInteger(group.materialIndex)||group.materialIndex<0||(object.materials.length>1&&group.materialIndex>=object.materials.length))throw new Error('Invalid material group.');
    for(const material of object.materials) {
      if(!['MeshStandardMaterial','MeshBasicMaterial'].includes(material.type)||Object.keys(material).some(key=>/map$/i.test(key)&&material[key])) throw new Error('Unsupported scene material.');
      for(const value of Object.values(material)) if(typeof value==='number'&&!Number.isFinite(value)) throw new Error('Invalid material parameter.');
    }
  }
  for(const object of scene.objects) {
    if(object.type==='Group' && object.parentId) throw new Error('Nested groups are not supported by this editor.');
    const seen=new Set([object.persistentId]);let parent=object.parentId;
    while(parent) {if(seen.has(parent)||!byId.has(parent)) throw new Error('Invalid or cyclic scene hierarchy.');seen.add(parent);const node=byId.get(parent);if(node.type!=='Group')throw new Error('Mesh cannot parent another editable object.');parent=node.parentId;}
  }
  if(!Array.isArray(scene.selectedIds)||!scene.selectedIds.every(id=>ids.has(id))) throw new Error('Invalid saved selection.');
  if (!Number.isSafeInteger(scene.nextObjectId)||scene.nextObjectId<=Math.max(0,...ids)||!scene.nameCounts||['Cube','Sphere','Cylinder','Group'].some(type=>!Number.isSafeInteger(scene.nameCounts[type])||scene.nameCounts[type]<0)) throw new Error('Invalid scene counters.');
  if(scene.camera&&(!finiteArray(scene.camera.position,3)||!finiteArray(scene.camera.up,3)||!finiteArray(scene.camera.target,3)||!Number.isFinite(scene.camera.zoom)||scene.camera.zoom<=0||!Number.isFinite(scene.camera.orthoHeight)||scene.camera.orthoHeight<=0))throw new Error('Invalid camera state.');
  if(scene.camera&&((scene.camera.near!==undefined&&(!Number.isFinite(scene.camera.near)||scene.camera.near<=0))||(scene.camera.far!==undefined&&(!Number.isFinite(scene.camera.far)||scene.camera.far<=(scene.camera.near??0)))||(scene.camera.fov!=null&&(!Number.isFinite(scene.camera.fov)||scene.camera.fov<=0||scene.camera.fov>=180))))throw new Error('Invalid camera clipping planes.');
  return scene;
}
export function restoreScene(editor,snapshot) {
  validateScene(snapshot);
  const loader=new THREE.BufferGeometryLoader(),materialLoader=new THREE.MaterialLoader();
  const built=[];
  try {
    for(const saved of snapshot.objects) {
      const object=saved.type==='Group'?new THREE.Group():new THREE.Mesh(loader.parse(saved.geometry),saved.materials.map(json=>materialLoader.parse(json)));
      if(object.isMesh) {
        if(object.material.length===1)object.material=object.material[0];
        object.geometry.parameters={...saved.dimensions,radiusTop:saved.dimensions.radius};
        object.geometry.computeBoundingBox();object.geometry.computeBoundingSphere();
        if(saved.drawRange)object.geometry.setDrawRange(saved.drawRange.start,saved.drawRange.count??Infinity);
      }
      object.name=saved.name;object.userData={type:saved.type,editorId:saved.id,persistentId:saved.persistentId,locked:saved.locked};
      object.position.fromArray(saved.position);object.rotation.fromArray(saved.rotation);object.scale.fromArray(saved.scale);object.visible=saved.visible!==false;built.push(object);
    }
  } catch(error) {built.forEach(object=>{object.geometry?.dispose();[object.material].flat().forEach(material=>material?.dispose());});throw error;}
  editor.selection.selectObject(null);
  for(const object of editor.state.objects){object.removeFromParent();object.geometry?.dispose();[object.material].flat().forEach(material=>material?.dispose());}
  editor.state.objects.length=0;
  built.forEach(object=>{editor.state.objects.push(object);editor.viewport.scene.add(object);});
  snapshot.objects.forEach((saved,index)=>{if(saved.parentId)built.find(object=>object.userData.persistentId===saved.parentId).add(built[index]);});
  for(const type of ['Cube','Sphere','Cylinder','Group']) editor.state.nameCounts[type]=snapshot.nameCounts[type];editor.state.nextObjectId=snapshot.nextObjectId;
  editor.viewport.scene.updateMatrixWorld(true);editor.views.applyMaterials();
  editor.selection.setSelection((snapshot.selectedIds??[]).map(id=>built.find(object=>object.userData.editorId===id)).filter(Boolean));
  editor.history.undoHistory.length=0;editor.history.redoHistory.length=0;editor.ui.updateButtons();
  const view=snapshot.camera;
  if(view&&editor.viewport.perspectiveCamera){
    const viewport=editor.viewport;const damping=viewport.controls.enableDamping;viewport.controls.enableDamping=false;viewport.controls.update();
    viewport.camera=view.orthographic?viewport.orthographicCamera:viewport.perspectiveCamera;
    if(view.near!==undefined)viewport.camera.near=view.near;if(view.far!==undefined)viewport.camera.far=view.far;if(view.fov&&viewport.camera.isPerspectiveCamera)viewport.camera.fov=view.fov;
    viewport.camera.position.fromArray(view.position);viewport.camera.up.fromArray(view.up);viewport.camera.zoom=view.zoom;viewport.orthoHeight=view.orthoHeight;
    viewport.controls.object=viewport.camera;viewport.controls.target.fromArray(view.target);viewport.transformControls.camera=viewport.camera;viewport.resizeRenderer();viewport.controls.update();viewport.controls.enableDamping=damping;
  }
}
export function sceneObjectRows(scene) {
  return scene.objects.map(object=>({id:object.persistentId,parent_object_id:object.parentId,name:object.name,object_type:object.type,
    transform:{position:object.position,rotation:object.rotation,scale:object.scale},properties:{editor_id:object.id,visible:object.visible,locked:object.locked,dimensions:object.dimensions}}));
}
export function sceneFingerprint(scene) { const {selectedIds,camera,...content}=scene;return JSON.stringify(content); }
