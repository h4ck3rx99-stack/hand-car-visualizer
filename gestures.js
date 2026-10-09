import { dist } from './hand-tracking.js';

// ---------- helpers (flowy math) ----------
function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.12;
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
// framerate-independent exponential damping (like THREE.MathUtils.damp)
function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}
// soft deadzone: fades in over ~1.5x dz instead of hard cut (no popping)
function softDeadzone(v, dz) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  const t = clamp((a - dz) / (dz * 1.8 + 1e-6), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return Math.sign(v) * a * smooth;
}
// gentle precision curve: tiny moves = precise, big moves = fast
function responseCurve(v) {
  const a = Math.abs(v);
  const s = Math.sign(v);
  return s * Math.pow(a, 1.12) * 1.0;
}

export function classifyHand(lm) {
  if (!lm) return { pose: 'none', pinchDist: 1, openScore: 0, openCount: 0 };
  const pinchDist = dist(lm[4], lm[8]);
  const ext = [
    fingerExtended(lm, 8, 6),
    fingerExtended(lm, 12, 10),
    fingerExtended(lm, 16, 14),
    fingerExtended(lm, 20, 18)
  ];
  const openCount = ext.filter(Boolean).length;
  const palmSize = Math.max(1e-6, dist(lm[0], lm[9]));
  const spread = (dist(lm[8], lm[0]) + dist(lm[12], lm[0]) + dist(lm[16], lm[0]) + dist(lm[20], lm[0])) / 4 / palmSize;
  let pose = 'unknown';
  if (pinchDist < 0.085 && openCount <= 2) pose = 'pinch';
  else if (pinchDist < 0.055) pose = 'pinch';
  else if (openCount >= 3 && spread > 1.32) pose = 'open';
  else if (openCount <= 1 && spread < 1.18) pose = 'fist';
  else pose = openCount >= 2 ? 'open' : 'fist';
  return { pose, pinchDist, openScore: spread, openCount };
}

export class GestureController {
  constructor(opts = {}) {
    this.sensitivity = opts.sensitivity ?? 1.0;
    this.smoothing = opts.smoothing ?? 0.55; // 0 = snappy, 0.9 = floaty
    this.swapHands = false;
    this.deadzone = 0.0032;

    // filtered (low-passed) raw inputs — jitter never reaches the physics
    this.filt = { rW: null, lW: null, pinch: null, inter: null };
    // velocities give momentum + glide (the "flowy" feel)
    this.vel = { rotX: 0, rotY: 0, panX: 0, panY: 0, zoom: 0 };
    // pose hysteresis — stops flicker between open/fist/pinch
    this.stable = { R: 'none', L: 'none', rCand: null, rN: 0, lCand: null, lN: 0 };

    this.state = {
      rotX: 0.35, rotY: 0.6, zoom: 4.8, panX: 0, panY: 0.6, explode: 0,
      rightPose: 'none', leftPose: 'none', hands: 0
    };
    this.manualOverride = { zoom: false, explode: false };
  }

  reset() {
    this.state.rotX = 0.35; this.state.rotY = 0.6;
    this.state.zoom = 4.8; this.state.panX = 0; this.state.panY = 0.6;
    this.state.explode = 0;
    this.vel.rotX = this.vel.rotY = this.vel.panX = this.vel.panY = this.vel.zoom = 0;
    this.filt.rW = this.filt.lW = this.filt.pinch = this.filt.inter = null;
  }

  // higher smoothing slider -> lower lambdas -> slower, floatier
  lambdas() {
    const s = clamp(this.smoothing, 0, 0.92);
    return {
      pos: 24 - s * 15,      // input position low-pass  (24 snappy → 9 floaty)
      vel: 17 - s * 11.5,    // velocity tracking       (17 → 5.5)
      drift: 7 - s * 3,      // momentum decay when hand still (7 → 4)
      zoom: 11 - s * 7,      // zoom velocity           (11 → 4)
      explode: 8 - s * 5.2   // explode absolute damp   (8 → 2.8, slowest = floatiest)
    };
  }

  stabilizePose(prev, raw, side) {
    if (raw === 'none') {
      this.stable[side + 'Cand'] = null; this.stable[side + 'N'] = 0;
      // release immediately only after 2 empty frames (avoids blink loss)
      if (prev !== 'none') {
        const n = (this.stable[side + 'Miss'] ?? 0) + 1;
        this.stable[side + 'Miss'] = n;
        if (n >= 2) { this.stable[side + 'Miss'] = 0; return 'none'; }
        return prev;
      }
      return 'none';
    }
    this.stable[side + 'Miss'] = 0;
    if (raw === prev) { this.stable[side + 'Cand'] = null; this.stable[side + 'N'] = 0; return prev; }
    if (raw === 'unknown') return prev; // never adopt 'unknown', hold last stable
    if (this.stable[side + 'Cand'] === raw) {
      this.stable[side + 'N']++;
      const need = raw === 'pinch' ? 2 : 3; // pinch = responsive, open/fist = stable
      if (this.stable[side + 'N'] >= need) {
        this.stable[side + 'Cand'] = null; this.stable[side + 'N'] = 0;
        return raw;
      }
      return prev;
    }
    this.stable[side + 'Cand'] = raw; this.stable[side + 'N'] = 1;
    return prev;
  }

  update(hands, dtRaw = 1 / 60) {
    const dt = clamp(dtRaw, 1 / 120, 1 / 20);
    let { left, right } = hands;
    if (this.swapHands) [left, right] = [right, left];
    const L = left?.landmarks ?? null;
    const R = right?.landmarks ?? null;
    const cL = classifyHand(L);
    const cR = classifyHand(R);

    this.stable.R = this.stabilizePose(this.stable.R, R ? cR.pose : 'none', 'r');
    this.stable.L = this.stabilizePose(this.stable.L, L ? cL.pose : 'none', 'l');
    const poseR = R ? this.stable.R : 'none';
    const poseL = L ? this.stable.L : 'none';
    this.state.rightPose = poseR;
    this.state.leftPose = poseL;
    this.state.hands = (L ? 1 : 0) + (R ? 1 : 0);

    const { pos: Lpos, vel: Lvel, drift: Ldrift, zoom: Lzoom, explode: Lexplode } = this.lambdas();
    const sens = this.sensitivity;

    // ---- RIGHT: rotate (open / grab-fist) with momentum ----
    const canRotate = R && (poseR === 'open' || poseR === 'fist');
    if (canRotate) {
      const raw = R[0];
      this.filt.rW = this.filt.rW
        ? { x: damp(this.filt.rW.x, raw.x, Lpos, dt), y: damp(this.filt.rW.y, raw.y, Lpos, dt) }
        : { x: raw.x, y: raw.y };
      const prev = this._prevFR ?? this.filt.rW;
      let dx = -(this.filt.rW.x - prev.x); // mirrored selfie view
      let dy = this.filt.rW.y - prev.y;
      dx = responseCurve(softDeadzone(dx, this.deadzone));
      dy = responseCurve(softDeadzone(dy, this.deadzone));
      const grab = poseR === 'fist' ? 0.7 : 1.0;
      const kRot = 5.2 * sens * grab;
      // target velocity in units/sec
      const tvY = clamp((dx / Math.max(dt, 1e-3)) * kRot * 0.16, -7, 7);
      const tvX = clamp((dy / Math.max(dt, 1e-3)) * kRot * 0.16, -7, 7);
      this.vel.rotY = damp(this.vel.rotY, tvY, Lvel, dt);
      this.vel.rotX = damp(this.vel.rotX, tvX, Lvel, dt);
      this.state.rotY += this.vel.rotY * dt;
      this.state.rotX = clamp(this.state.rotX + this.vel.rotX * dt, -1.2, 1.2);
      this._prevFR = { ...this.filt.rW };
    } else {
      // glide to stop — momentum, no snap
      this.vel.rotY = damp(this.vel.rotY, 0, Ldrift, dt);
      this.vel.rotX = damp(this.vel.rotX, 0, Ldrift, dt);
      this.state.rotY += this.vel.rotY * dt;
      this.state.rotX = clamp(this.state.rotX + this.vel.rotX * dt, -1.2, 1.2);
      if (R) {
        this.filt.rW = { x: damp(this.filt.rW?.x ?? R[0].x, R[0].x, Lpos, dt), y: damp(this.filt.rW?.y ?? R[0].y, R[0].y, Lpos, dt) };
        this._prevFR = { ...this.filt.rW };
      } else { this.filt.rW = null; this._prevFR = null; }
    }

    // ---- RIGHT pinch: zoom via smoothed pinch velocity ----
    if (R && poseR === 'pinch') {
      const rawP = cR.pinchDist;
      const fP = this.filt.pinch == null ? rawP : damp(this.filt.pinch, rawP, Lpos, dt);
      if (this.filt.pinch != null && !this.manualOverride.zoom) {
        const dP = softDeadzone(fP - this.filt.pinch, 0.0009);
        const tvZ = clamp((-dP / Math.max(dt, 1e-3)) * 9.0 * sens, -7, 7);
        this.vel.zoom = damp(this.vel.zoom, tvZ, Lzoom, dt);
        this.state.zoom = clamp(this.state.zoom + this.vel.zoom * dt, 2.6, 9);
      }
      this.filt.pinch = fP;
    } else {
      this.vel.zoom = damp(this.vel.zoom, 0, Ldrift, dt);
      if (!this.manualOverride.zoom && Math.abs(this.vel.zoom) > 1e-4) {
        this.state.zoom = clamp(this.state.zoom + this.vel.zoom * dt, 2.6, 9);
      }
      if (!R) this.filt.pinch = null;
      else if (poseR !== 'pinch') this.filt.pinch = damp(this.filt.pinch ?? cR.pinchDist, cR.pinchDist, Lpos, dt);
    }

    // ---- LEFT fist: pan with momentum ----
    const canPan = L && poseL === 'fist';
    if (canPan) {
      const raw = L[0];
      this.filt.lW = this.filt.lW
        ? { x: damp(this.filt.lW.x, raw.x, Lpos, dt), y: damp(this.filt.lW.y, raw.y, Lpos, dt) }
        : { x: raw.x, y: raw.y };
      const prev = this._prevFL ?? this.filt.lW;
      let dx = -(this.filt.lW.x - prev.x);
      let dy = this.filt.lW.y - prev.y;
      dx = responseCurve(softDeadzone(dx, this.deadzone));
      dy = responseCurve(softDeadzone(dy, this.deadzone));
      const kPan = 3.6 * sens;
      const tvPX = clamp((dx / Math.max(dt, 1e-3)) * kPan * 0.16, -6, 6);
      const tvPY = clamp((-dy / Math.max(dt, 1e-3)) * kPan * 0.16, -6, 6);
      this.vel.panX = damp(this.vel.panX, tvPX, Lvel, dt);
      this.vel.panY = damp(this.vel.panY, tvPY, Lvel, dt);
      this.state.panX = clamp(this.state.panX + this.vel.panX * dt, -2.5, 2.5);
      this.state.panY = clamp(this.state.panY + this.vel.panY * dt, -1.5, 2.5);
      this._prevFL = { ...this.filt.lW };
    } else {
      this.vel.panX = damp(this.vel.panX, 0, Ldrift, dt);
      this.vel.panY = damp(this.vel.panY, 0, Ldrift, dt);
      this.state.panX = clamp(this.state.panX + this.vel.panX * dt, -2.5, 2.5);
      this.state.panY = clamp(this.state.panY + this.vel.panY * dt, -1.5, 2.5);
      if (L) {
        this.filt.lW = this.filt.lW
          ? { x: damp(this.filt.lW.x, L[0].x, Lpos, dt), y: damp(this.filt.lW.y, L[0].y, Lpos, dt) }
          : { x: L[0].x, y: L[0].y };
        this._prevFL = { ...this.filt.lW };
      } else { this.filt.lW = null; this._prevFL = null; }
    }

    // ---- BOTH open: exploded view (absolute target, slow floaty damp) ----
    if (L && R && poseL === 'open' && poseR === 'open') {
      const rawD = Math.hypot(L[0].x - R[0].x, L[0].y - R[0].y);
      const fD = this.filt.inter == null ? rawD : damp(this.filt.inter, rawD, Lpos, dt);
      this.filt.inter = fD;
      const target = clamp((fD - 0.18) / (0.62 - 0.18), 0, 1);
      if (!this.manualOverride.explode) {
        this.state.explode = damp(this.state.explode, target, Lexplode, dt);
      }
    } else if (L && R && poseL === 'pinch' && poseR === 'pinch' && !this.manualOverride.zoom) {
      // both-pinch spread: fine zoom, also smoothed
      const rawD = Math.hypot(L[8].x - R[8].x, L[8].y - R[8].y);
      const fD = this.filt.inter == null ? rawD : damp(this.filt.inter, rawD, Lpos, dt);
      if (this.filt.inter != null) {
        const dd = softDeadzone(fD - this.filt.inter, 0.0012);
        const tvZ = clamp((-dd / Math.max(dt, 1e-3)) * 6.0 * sens, -6, 6);
        this.vel.zoom = damp(this.vel.zoom, tvZ, Lzoom, dt);
        this.state.zoom = clamp(this.state.zoom + this.vel.zoom * dt, 2.6, 9);
      }
      this.filt.inter = fD;
    } else {
      if (L && R) {
        const rawD = Math.hypot(L[0].x - R[0].x, L[0].y - R[0].y);
        this.filt.inter = this.filt.inter == null ? rawD : damp(this.filt.inter, rawD, Lpos, dt);
      } else this.filt.inter = null;
    }

    return this.state;
  }
}
