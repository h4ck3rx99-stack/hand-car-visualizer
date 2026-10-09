import * as THREE from 'three';

// Procedural Jarvis-style car with visible internals.
// Every major part registers basePos + explodeDir so setExplode(f) can spread it.
export function buildCar() {
  const group = new THREE.Group();
  group.name = 'procedural-car';
  const parts = [];
  const register = (obj, explodeDir) => {
    obj.updateMatrix();
    parts.push({ obj, basePos: obj.position.clone(), explodeDir: new THREE.Vector3(...explodeDir) });
    group.add(obj);
  };

  // ---------- Materials ----------
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x16202b, metalness: 0.85, roughness: 0.28,
    clearcoat: 1, clearcoatRoughness: 0.15,
    emissive: 0x00e5ff, emissiveIntensity: 0.04
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.6, roughness: 0.4
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9beaff, metalness: 0.1, roughness: 0.05,
    transmission: 0.6, transparent: true, opacity: 0.55
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x9fb3c8, metalness: 0.95, roughness: 0.25,
    emissive: 0x00e5ff, emissiveIntensity: 0.25
  });
  const chassisMat = new THREE.MeshStandardMaterial({ color: 0x2a3644, metalness: 0.7, roughness: 0.5 });
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0xff9f1c, metalness: 0.6, roughness: 0.35,
    emissive: 0xff6b00, emissiveIntensity: 0.25
  });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x39434f, metalness: 0.8, roughness: 0.4 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x132433, roughness: 0.7, emissive: 0x00e5ff, emissiveIntensity: 0.12 });
  const batteryMat = new THREE.MeshStandardMaterial({ color: 0x00ff9d, emissive: 0x00ff9d, emissiveIntensity: 0.5, roughness: 0.4 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbdf3ff, emissiveIntensity: 3 });

  // ---------- Body: extruded side silhouette ----------
  const s = new THREE.Shape();
  s.moveTo(-2.1, 0.35);
  s.lineTo(-2.1, 0.75);
  s.lineTo(-1.2, 0.8);
  s.lineTo(-0.6, 1.25);   // windshield
  s.lineTo(0.6, 1.28);    // roof
  s.lineTo(1.25, 0.82);   // rear window
  s.lineTo(2.1, 0.78);
  s.lineTo(2.1, 0.35);
  s.lineTo(1.35, 0.32);
  s.absarc(1.3, 0.32, 0.42, 0, Math.PI, false); // rear wheel cutout (visual only)
  s.lineTo(-1.25, 0.32);
  s.absarc(-1.3, 0.32, 0.42, 0, Math.PI, false);
  s.lineTo(-2.1, 0.35);
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3 });
  bodyGeo.center();
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.55, 0);
  body.castShadow = true;
  register(body, [0, 1.5, 0]);

  // Neon underglow strip
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 1.75), accentMat);
  strip.position.set(0, 0.22, 0);
  register(strip, [0, -0.4, 0]);

  // ---------- Cabin glass ----------
  const cabShape = new THREE.Shape();
  cabShape.moveTo(-0.55, 0);
  cabShape.lineTo(0.55, 0);
  cabShape.lineTo(0.28, 0.42);
  cabShape.lineTo(-0.28, 0.42);
  cabShape.lineTo(-0.55, 0);
  const cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: 1.45, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  cabGeo.center();
  const cabin = new THREE.Mesh(cabGeo, glassMat);
  cabin.position.set(0, 1.62, 0);
  register(cabin, [0, 2.4, 0]);

  // ---------- Chassis ----------
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.4), chassisMat);
  chassis.position.set(0, 0.42, 0);
  register(chassis, [0, 0, 0]); // stays as reference

  // Axles
  const axleGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 12);
  axleGeo.rotateX(Math.PI / 2);
  const axleF = new THREE.Mesh(axleGeo, darkMetal);
  axleF.position.set(-1.3, 0.38, 0);
  register(axleF, [0, -0.5, 0]);
  const axleR = axleF.clone();
  axleR.position.set(1.3, 0.38, 0);
  register(axleR, [0, -0.5, 0]);

  // ---------- Wheels ----------
  const wheelPositions = [
    [-1.3, -0.95, 'FL'], [-1.3, 0.95, 'FR'],
    [1.3, -0.95, 'RL'], [1.3, 0.95, 'RR']
  ];
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 28);
  tireGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 6);
  rimGeo.rotateX(Math.PI / 2);
  for (const [x, z] of wheelPositions) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    w.add(tire, rim);
    w.position.set(x, 0.38, z);
    const dirX = x > 0 ? 1.1 : -1.1;
    const dirZ = z > 0 ? 0.9 : -0.9;
    register(w, [dirX, 0.15, dirZ]);
    wheels.push(w);
  }

  // ---------- Engine (front) ----------
  const engine = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.7), engineMat);
  block.castShadow = true;
  engine.add(block);
  for (let i = 0; i < 4; i++) {
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), darkMetal);
    piston.position.set(-0.24 + i * 0.16, 0.3, 0);
    engine.add(piston);
  }
  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.4), accentMat);
  intake.position.y = 0.44;
  engine.add(intake);
  engine.position.set(-1.35, 0.72, 0);
  register(engine, [-1.3, 0.7, 0]);

  // ---------- Battery / motor (rear, EV style) ----------
  const battery = new THREE.Group();
  const pack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 1.0), batteryMat);
  battery.add(pack);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 16), darkMetal);
  motor.rotation.z = Math.PI / 2;
  motor.position.set(0, 0.28, 0);
  battery.add(motor);
  battery.position.set(1.15, 0.58, 0);
  register(battery, [1.3, 0.5, 0]);

  // ---------- Seats ----------
  const seatGeo = new THREE.BoxGeometry(0.45, 0.55, 0.45);
  const seat1 = new THREE.Mesh(seatGeo, seatMat);
  seat1.position.set(-0.1, 0.95, -0.4);
  register(seat1, [0, 1.7, -0.5]);
  const seat2 = seat1.clone();
  seat2.position.set(-0.1, 0.95, 0.4);
  register(seat2, [0, 1.7, 0.5]);

  // ---------- Steering ----------
  const steering = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 10, 24), darkMetal);
  steering.position.set(-0.55, 1.05, -0.4);
  steering.rotation.y = -0.5;
  register(steering, [-0.6, 1.4, -0.6]);

  // ---------- Lights ----------
  const hlGeo = new THREE.SphereGeometry(0.09, 12, 12);
  const hl1 = new THREE.Mesh(hlGeo, lightMat);
  hl1.position.set(-2.12, 0.85, -0.55);
  register(hl1, [-0.8, 0.8, -0.4]);
  const hl2 = hl1.clone();
  hl2.position.set(-2.12, 0.85, 0.55);
  hl2.material = lightMat;
  parts.push({ obj: hl2, basePos: hl2.position.clone(), explodeDir: new THREE.Vector3(-0.8, 0.8, 0.4) });
  group.add(hl2);
  const tlMat = new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff2244, emissiveIntensity: 2.5 });
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 1.2), tlMat);
  tl.position.set(2.12, 0.85, 0);
  register(tl, [0.8, 0.8, 0]);

  // HUD ring under car (Jarvis pad)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 2.75, 64),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring); // not exploded

  let xray = false;
  let explodeF = 0;

  function setXray(on) {
    xray = on;
    bodyMat.transparent = true;
    bodyMat.opacity = on ? 0.15 : 1;
    bodyMat.emissiveIntensity = on ? 0.35 : 0.04;
    glassMat.opacity = on ? 0.18 : 0.55;
    strip.material = strip.material; // keep glow
  }

  function setExplode(f) {
    explodeF = THREE.MathUtils.clamp(f, 0, 1);
    for (const p of parts) {
      p.obj.position.copy(p.basePos).addScaledVector(p.explodeDir, explodeF);
    }
  }

  function spinWheels(speed = 0.05) {
    for (const w of wheels) w.rotation.z -= speed;
  }

  return { group, parts, wheels, setXray, setExplode, getExplode: () => explodeF, isXray: () => xray, spinWheels, bodyMat };
}
