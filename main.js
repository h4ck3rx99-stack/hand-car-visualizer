import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { buildCar } from './car-model.js';
import { HandTracker } from './hand-tracking.js';
import { GestureController } from './gestures.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const container = $('scene-container');
const video = $('webcam');
const overlay = $('overlay');
const statusEl = $('status');
const gestureEl = $('gesture-readout');
const fpsEl = $('fps');
const btnCamera = $('btn-camera');
const btnXray = $('btn-xray');
const btnSpin = $('btn-spin');
const btnReset = $('btn-reset');
const btnSwap = $('btn-swap');
const sliderExplode = $('slider-explode');
const sliderSens = $('slider-sens');
const sliderSmooth = $('slider-smooth');
const fileInput = $('file-upload');
const dropZone = $('drop-zone');

const setStatus = (t) => { statusEl.textContent = t; };

// ---------- Three.js scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05090f, 0.045);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(3.4, 2.2, 4.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.7, 0);

// Lights — Jarvis lab
scene.add(new THREE.HemisphereLight(0x8fd8ff, 0x0a0f16, 0.7));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
scene.add(key);
const cyanRim = new THREE.DirectionalLight(0x00e5ff, 1.2);
cyanRim.position.set(-5, 3, -4);
scene.add(cyanRim);
const underGlow = new THREE.PointLight(0x00e5ff, 12, 8);
underGlow.position.set(0, 0.15, 0);
scene.add(underGlow);

// Floor grid + disc
const grid = new THREE.GridHelper(24, 48, 0x00e5ff, 0x0e2a38);
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 64),
  new THREE.MeshStandardMaterial({ color: 0x070c12, roughness: 0.9, metalness: 0.1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01;
floor.receiveShadow = true;
scene.add(floor);

// Model root (hand control transforms this)
const modelRoot = new THREE.Group();
scene.add(modelRoot);

const car = buildCar();
modelRoot.add(car.group);

let uploadedRoot = null;
let showingUploaded = false;
let autoSpin = false;
let xrayOn = false;

function setXray(on) {
  xrayOn = on;
  car.setXray(on);
  btnXray.classList.toggle('active', on);
  btnXray.textContent = on ? 'X-RAY: ON' : 'X-RAY';
}

// ---------- Gestures + tracking ----------
const gestures = new GestureController({ sensitivity: 1.0, smoothing: 0.55 });
gestures.reset();
const tracker = new HandTracker(video, overlay);
let tracking = false;

tracker.onFrame = (hands) => {
  // dt-aware so flow stays consistent across refresh rates
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(1 / 120, (now - (tracker._lastT ?? now)) / 1000));
  tracker._lastT = now;
  gestures.update(hands, dt);
  const st = gestures.state;
  if (!gestures.manualOverride.explode) sliderExplode.value = String(Math.round(st.explode * 100));
  gestureEl.innerHTML =
    `L:<b>${st.leftPose}</b> · R:<b>${st.rightPose}</b> · hands:<b>${st.hands}</b><br>` +
    `zoom:<b>${st.zoom.toFixed(2)}</b> · explode:<b>${st.explode.toFixed(2)}</b> · ` +
    `rot:<b>${st.rotX.toFixed(2)},${st.rotY.toFixed(2)}</b>`;
};

btnCamera.onclick = async () => {
  try {
    btnCamera.disabled = true;
    if (!tracker.landmarker) await tracker.init(setStatus);
    if (!tracking) {
      await tracker.startCamera(setStatus);
      tracking = true;
      btnCamera.textContent = 'STOP CAMERA';
      btnCamera.classList.add('active');
    } else {
      tracker.stopCamera();
      tracking = false;
      btnCamera.textContent = 'START CAMERA';
      btnCamera.classList.remove('active');
      setStatus('camera stopped');
    }
  } catch (e) {
    console.error(e);
    setStatus('camera error: ' + e.message + ' — use localhost/HTTPS + allow permission');
  } finally {
    btnCamera.disabled = false;
  }
};

btnXray.onclick = () => setXray(!xrayOn);
btnSpin.onclick = () => {
  autoSpin = !autoSpin;
  btnSpin.classList.toggle('active', autoSpin);
};
btnReset.onclick = () => {
  gestures.reset();
  gestures.manualOverride.explode = false;
  sliderExplode.value = '0';
  controls.reset?.();
  camera.position.set(3.4, 2.2, 4.8);
  controls.target.set(0, 0.7, 0);
};
btnSwap.onclick = () => {
  gestures.swapHands = !gestures.swapHands;
  btnSwap.classList.toggle('active', gestures.swapHands);
};

sliderSens.oninput = () => { gestures.sensitivity = Number(sliderSens.value) / 100; };
sliderSmooth.oninput = () => { gestures.smoothing = Number(sliderSmooth.value) / 100; };
sliderExplode.oninput = () => {
  gestures.state.explode = Number(sliderExplode.value) / 100;
  gestures.manualOverride.explode = true;
};
sliderExplode.ondblclick = () => { gestures.manualOverride.explode = false; };

// ---------- Upload (GLB/OBJ/STL) ----------
const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();
const stlLoader = new STLLoader();

function clearUploaded() {
  if (uploadedRoot) { modelRoot.remove(uploadedRoot); uploadedRoot = null; }
  showingUploaded = false;
  car.group.visible = true;
}

function frameObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  const s = 4.2 / Math.max(size, 0.001);
  obj.scale.multiplyScalar(s);
  obj.position.sub(center.multiplyScalar(s));
}

function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const url = URL.createObjectURL(file);
  setStatus('loading ' + file.name + '…');
  const done = (obj) => {
    clearUploaded();
    uploadedRoot = new THREE.Group();
    uploadedRoot.add(obj);
    frameObject(uploadedRoot);
    modelRoot.add(uploadedRoot);
    car.group.visible = false;
    showingUploaded = true;
    setStatus('loaded: ' + file.name + ' (explode/X-ray N/A for uploads)');
    URL.revokeObjectURL(url);
  };
  if (ext === 'glb' || ext === 'gltf') {
    gltfLoader.load(url, (g) => done(g.scene), undefined, (e) => setStatus('GLB error: ' + e.message));
  } else if (ext === 'obj') {
    objLoader.load(url, done, undefined, (e) => setStatus('OBJ error: ' + e.message));
  } else if (ext === 'stl') {
    stlLoader.load(url, (geo) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9fb3c8, metalness: 0.6, roughness: 0.4 }));
      done(mesh);
    }, undefined, (e) => setStatus('STL error: ' + e.message));
  } else {
    setStatus('unsupported: .' + ext + ' — use .glb / .obj / .stl');
  }
}
fileInput.onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
dropZone.onclick = () => fileInput.click();
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

// ---------- Resize + loop ----------
function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let frames = 0, lastFpsT = performance.now();
let lastAnimateT = performance.now();
// Display (render-side) values critically-damped toward hand state.
// This 2nd smoothing stage is what makes it feel floaty instead of rigid.
const disp = { rotX: 0.35, rotY: 0.6, panX: 0, panY: 0.6, zoom: 4.8, explode: 0 };
const dampR = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
function animate() {
  requestAnimationFrame(animate);
  const nowMs = performance.now();
  const dt = Math.min(0.05, Math.max(1 / 120, (nowMs - lastAnimateT) / 1000));
  lastAnimateT = nowMs;
  const st = gestures.state;

  // ease display toward targets (explode slowest = floatiest)
  disp.rotX = dampR(disp.rotX, st.rotX, 11, dt);
  disp.rotY = dampR(disp.rotY, st.rotY, 11, dt);
  disp.panX = dampR(disp.panX, st.panX, 8, dt);
  disp.panY = dampR(disp.panY, st.panY, 8, dt);
  disp.zoom = dampR(disp.zoom, st.zoom, 6, dt);
  disp.explode = dampR(disp.explode, st.explode, 4.5, dt);

  // Apply hand state -> scene
  const target = showingUploaded ? uploadedRoot : car.group;
  if (target) {
    target.rotation.x = disp.rotX * 0.9;
    target.rotation.y = disp.rotY;
    target.position.x = disp.panX;
    target.position.y = disp.panY - 0.6;
    if (!showingUploaded) car.setExplode(disp.explode);
    if (autoSpin) st.rotY += 0.008;
  }
  // zoom = camera distance along current dir (also damped)
  const dir = camera.position.clone().sub(controls.target).normalize();
  const desired = dir.multiplyScalar(disp.zoom).add(controls.target);
  camera.position.lerp(desired, 1 - Math.exp(-7 * dt));
  controls.update();

  if (!showingUploaded && autoSpin) car.spinWheels(0.06);
  underGlow.intensity = 10 + Math.sin(performance.now() / 500) * 3;

  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - lastFpsT > 500) {
    fpsEl.textContent = Math.round(frames * 1000 / (now - lastFpsT)) + ' FPS';
    frames = 0; lastFpsT = now;
  }
}
animate();
setStatus('ready — click START CAMERA (needs localhost/HTTPS)');
gestureEl.innerHTML = 'L:<b>none</b> · R:<b>none</b><br>allow camera, then: right-open=rotate · pinch=zoom · left-fist=pan · both-open spread=explode';
