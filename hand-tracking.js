import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];

export class HandTracker {
  constructor(videoEl, overlayEl) {
    this.video = videoEl;
    this.overlay = overlayEl;
    this.ctx = overlayEl.getContext('2d');
    this.landmarker = null;
    this.running = false;
    this.lastResults = { left: null, right: null, raw: null };
    this.onFrame = null; // (result) => void
    this.status = 'idle';
  }

  async init(statusCb) {
    const set = (s) => { this.status = s; statusCb?.(s); };
    set('loading wasm…');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    set('loading hand model…');
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    set('model ready — start camera');
  }

  async startCamera(statusCb) {
    const set = (s) => { this.status = s; statusCb?.(s); };
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
    this.video.srcObject = stream;
    await this.video.play();
    // size overlay to video
    const resize = () => {
      this.overlay.width = this.video.videoWidth || 640;
      this.overlay.height = this.video.videoHeight || 480;
    };
    this.video.addEventListener('loadedmetadata', resize);
    resize();
    this.running = true;
    set('tracking');
    this.loop();
  }

  stopCamera() {
    this.running = false;
    this.video.srcObject?.getTracks().forEach(t => t.stop());
  }

  loop() {
    if (!this.running) return;
    const now = performance.now();
    let result = null;
    try {
      if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
        result = this.landmarker.detectForVideo(this.video, now);
      }
    } catch { /* transient */ }
    if (result) {
      this.lastResults = this.splitHands(result);
      this.draw(this.lastResults);
      this.onFrame?.(this.lastResults);
    }
    requestAnimationFrame(() => this.loop());
  }

  splitHands(result) {
    // result.landmarks[i] + result.handedness[i][0].categoryName ('Left'/'Right')
    // NOTE: front camera is mirrored, so swap for intuitive control.
    let left = null, right = null;
    const lms = result.landmarks ?? [];
    const handed = result.handedness ?? [];
    for (let i = 0; i < lms.length; i++) {
      const label = handed[i]?.[0]?.categoryName ?? '';
      const entry = { landmarks: lms[i], label, index: i };
      // mirror: camera 'Left' is user's right from viewer perspective... keep intuitive:
      // if model says Left, treat as Right hand on screen-right. We just assign by label
      // and let gestures.js + swap button handle it.
      if (label === 'Left') left = entry;
      else if (label === 'Right') right = entry;
      else if (!left) left = entry; else right = entry;
    }
    return { left, right, raw: result, count: lms.length };
  }

  draw({ left, right }) {
    const { width: W, height: H } = this.overlay;
    this.ctx.clearRect(0, 0, W, H);
    // mirror display (selfie view)
    this.ctx.save();
    this.ctx.scale(-1, 1);
    this.ctx.translate(-W, 0);
    for (const hand of [left, right]) {
      if (!hand) continue;
      const pts = hand.landmarks;
      const isLeft = hand === left;
      this.ctx.strokeStyle = isLeft ? '#00ff9d' : '#00e5ff';
      this.ctx.lineWidth = 2;
      this.ctx.shadowColor = isLeft ? '#00ff9d' : '#00e5ff';
      this.ctx.shadowBlur = 8;
      this.ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        this.ctx.moveTo(pts[a].x * W, pts[a].y * H);
        this.ctx.lineTo(pts[b].x * W, pts[b].y * H);
      }
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
      this.ctx.fillStyle = isLeft ? '#00ff9d' : '#00e5ff';
      for (const p of pts) {
        this.ctx.beginPath();
        this.ctx.arc(p.x * W, p.y * H, 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
      // pinch line thumb-index
      const t = pts[4], idx = pts[8];
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo(t.x * W, t.y * H);
      this.ctx.lineTo(idx.x * W, idx.y * H);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }
}

export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
