import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { saveSystem } from "./storage.js";
import { buildPanel, clearActive, clearPanel } from "./panel.js";
import {
  buildPlaybackWidget,
  clearPlaybackWidget,
} from "./playback-widget.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const AU_SCALE = 100; // Three.js units per 1 AU (planet orbits)
const MOON_ORBIT_SCALE = 1; // multiplier applied on top of AU_SCALE for moon orbits
const BODY_SCALE = 0.025; // log-radius visual scale factor — halved to prevent large gas giants overlapping
const MIN_VISUAL_RADIUS = 0.015; // floor so zero-radius bodies (asteroids) always render as a visible dot
let timeScale = 1; // game-days per real second (mutable — panel slider updates this)

const POINT_LIGHT_COLOR = 0xfff5e0;
const POINT_LIGHT_INTENSITY = 50;
const AMBIENT_LIGHT_COLOR = 0x333344;
const AMBIENT_LIGHT_INTENSITY = 20;
const FLY_SPEED_AU_PER_SEC = 5; // tune me: how fast the camera flies, in AU/s
const FLY_MIN_SEC = 0.4;
const FLY_MAX_SEC = 4.0;
const FLY_ZOOM_OUT_FACTOR = 0.6; // tune me: peak mid-flight pull-back, as a fraction of camera travel distance
const FLY_OFFSET_FACTOR = 6; // visual-radius multipliers for camera standoff
const FLY_OFFSET_MIN = 0.2; // floor so tiny bodies (asteroids, moons) park at a viewable distance
const SOLAR_TO_EARTH_RADII = 109; // 1 solar radius ≈ 109 Earth radii
// ──────────────────────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  star: 0xfff5b0,
  rockyPlanet: 0xc1693a,
  gasGiant: 0xd4874e,
  iceGiant: 0x6ab0d4,
  dwarfPlanet: 0x7090b0,
  asteroid: 0x555555,
  moon: 0xaaaaaa,
};

// Star sphere color and point-light color per spectral type
const SPECTRAL_STAR_COLOR = {
  O: 0x9bb0ff, // blue
  B: 0xaabfff, // blue-white
  A: 0xcad7ff, // white-blue
  F: 0xf8f7ff, // white
  G: 0xfff5b0, // yellow-white (Sol)
  K: 0xffcc6f, // orange
  M: 0xff6633, // red-orange
};
const SPECTRAL_LIGHT_COLOR = {
  O: 0x7090ff,
  B: 0x90aaff,
  A: 0xc0d0ff,
  F: 0xfff8f0,
  G: 0xfff5e0, // current default
  K: 0xffaa44,
  M: 0xff5522,
};

function orbitParams(orbitRadius, eccentricity, isMoon) {
  const scale = isMoon ? AU_SCALE * MOON_ORBIT_SCALE : AU_SCALE;
  const a = orbitRadius * scale;
  const e = Math.min(eccentricity ?? 0, 0.999);
  const b = a * Math.sqrt(1 - e * e);
  const c = a * e; // center offset so star/parent sits at one focus
  return { a, b, c };
}

function buildOrbitLine(a, b, c, isMoon) {
  const pts = [];
  for (let i = 0; i <= 128; i++) {
    const θ = (i / 128) * Math.PI * 2;
    pts.push(new THREE.Vector3(c + a * Math.cos(θ), 0, b * Math.sin(θ)));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: isMoon ? 0x1a4a5a : 0x1a3a6a,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.LineLoop(geo, mat);
}

function visualRadius(r) {
  return Math.max(MIN_VISUAL_RADIUS, Math.log1p(r) * BODY_SCALE);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

const camera = new THREE.PerspectiveCamera(
  60,
  innerWidth / innerHeight,
  0.1,
  10000,
);
camera.position.set(0, 80, 120);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

globalThis.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

globalThis.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    lockedTarget = null;
    flyState = null;
    clearActive();
  }
});

const pointLight = new THREE.PointLight(
  POINT_LIGHT_COLOR,
  POINT_LIGHT_INTENSITY,
  0,
);
scene.add(pointLight);
const ambientLight = new THREE.AmbientLight(
  AMBIENT_LIGHT_COLOR,
  AMBIENT_LIGHT_INTENSITY,
);
scene.add(ambientLight);

let animObjects = []; // { mesh, a, b, c, initialAngle, orbitPeriod, flyOffset }
let starFlyOffset = FLY_OFFSET_MIN;
let systemRoot = null;
let elapsedDays = 0;
let lastTime = null;
let paused = false;
let lockedTarget = null; // animObj being tracked, or null
let flyState = null; // { startCamPos, startTarget, animObj, progress } or null
const tmpVec = new THREE.Vector3();
const flyEndTarget = new THREE.Vector3();
const flyTmpTarget = new THREE.Vector3();
const flyTmpDir = new THREE.Vector3();
const FLY_END_DIR = new THREE.Vector3(1, 1, 1).normalize();
const lockedPrevPos = new THREE.Vector3();
const lockDelta = new THREE.Vector3();

function animate(time) {
  requestAnimationFrame(animate);
  if (lastTime === null) {
    lastTime = time;
    controls.update();
    renderer.render(scene, camera);
    return;
  }
  const delta = (time - lastTime) / 1000;
  lastTime = time;
  if (delta > 0 && delta < 1) {
    if (!paused) elapsedDays += delta * timeScale;
    // animObjects must be iterated parent-before-child: planets push before their moons (see buildObject)
    for (const obj of animObjects) {
      if (obj.type === "star") continue;
      const angle = obj.initialAngle +
        ((Math.PI * 2) / obj.orbitPeriod) * elapsedDays;
      obj.mesh.position.copy(orbitPosition(obj.a, obj.b, obj.c, angle));
    }
    // Fly-in animation
    if (flyState !== null) {
      flyState.progress = Math.min(flyState.progress + delta / flyState.duration, 1);
      const t = easeInOutCubic(flyState.progress);

      if (flyState.animObj) {
        flyState.animObj.mesh.getWorldPosition(flyEndTarget);
      } else {
        flyEndTarget.set(0, 0, 0);
      }

      // Interpolate the target (what the camera is looking at).
      flyTmpTarget.lerpVectors(flyState.startTarget, flyEndTarget, t);
      controls.target.copy(flyTmpTarget);

      // Interpolate the direction from target to camera, then normalize.
      flyTmpDir.lerpVectors(flyState.startOffsetDir, FLY_END_DIR, t).normalize();

      // Interpolate distance with a mid-flight zoom-out bump.
      const baseDist = flyState.startOffsetDist * (1 - t) + flyState.flyOffset * t;
      const bump = flyState.zoomOutBoost * Math.sin(Math.PI * t);
      const dist = baseDist + bump;

      camera.position.copy(flyTmpTarget).addScaledVector(flyTmpDir, dist);

      if (flyState.progress >= 1) {
        lockedTarget = flyState.animObj;
        if (lockedTarget) lockedTarget.mesh.getWorldPosition(lockedPrevPos);
        flyState = null;
      }
    }
    // Lock tracking — move both target and camera by the object's delta each frame
    if (lockedTarget !== null && flyState === null) {
      lockedTarget.mesh.getWorldPosition(tmpVec);
      lockDelta.subVectors(tmpVec, lockedPrevPos);
      controls.target.add(lockDelta);
      camera.position.add(lockDelta);
      lockedPrevPos.copy(tmpVec);
    }
  }
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

function orbitPosition(a, b, c, angle) {
  return new THREE.Vector3(c + a * Math.cos(angle), 0, b * Math.sin(angle));
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function handleFocus(animObj) {
  const isStar = !animObj || animObj.type === "star";
  const startCamPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const flyOffset = isStar ? starFlyOffset : animObj.flyOffset;

  // Start offset = vector from target to camera at t=0 (preserves current angle/distance).
  const startOffset = startCamPos.clone().sub(startTarget);
  const startOffsetDist = Math.max(startOffset.length(), 1e-6);
  const startOffsetDir = startOffset.clone().divideScalar(startOffsetDist);

  // Estimated end state for duration + zoom-out sizing.
  const endTarget = new THREE.Vector3();
  if (!isStar) animObj.mesh.getWorldPosition(endTarget);
  const endCamPos = endTarget.clone().addScaledVector(FLY_END_DIR, flyOffset);
  const travel = startCamPos.distanceTo(endCamPos);

  const rawDuration = travel / (FLY_SPEED_AU_PER_SEC * AU_SCALE);
  const duration = Math.max(FLY_MIN_SEC, Math.min(FLY_MAX_SEC, rawDuration));
  const zoomOutBoost = travel * FLY_ZOOM_OUT_FACTOR;

  flyState = {
    startCamPos,
    startTarget,
    startOffsetDir,
    startOffsetDist,
    animObj: isStar ? null : animObj,
    flyOffset,
    progress: 0,
    duration,
    zoomOutBoost,
  };
  lockedTarget = null;
}

function clearSystem() {
  clearPanel();
  clearPlaybackWidget();
  lockedTarget = null;
  flyState = null;
  paused = false;
  if (systemRoot) {
    scene.remove(systemRoot);
    systemRoot.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    systemRoot = null;
  }
  animObjects = [];
  elapsedDays = 0;
}

function buildObject(data, parentContainer, isMoon) {
  const { a, b, c } = orbitParams(data.orbitRadius, data.eccentricity, isMoon);
  const initialAngle = (data.orbitalPhase ?? 0) * Math.PI * 2;

  parentContainer.add(buildOrbitLine(a, b, c, isMoon));

  const geo = new THREE.SphereGeometry(visualRadius(data.radius), 16, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: TYPE_COLORS[data.type] ?? 0xffffff,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.id = data.id;
  mesh.position.copy(orbitPosition(a, b, c, initialAngle));
  parentContainer.add(mesh);

  animObjects.push({
    id: data.id,
    type: data.type,
    name: data.name,
    data,
    mesh,
    a,
    b,
    c,
    initialAngle,
    orbitPeriod: data.orbitPeriod || 1,
    flyOffset: Math.max(
      FLY_OFFSET_MIN,
      visualRadius(data.radius) * FLY_OFFSET_FACTOR,
    ),
  });

  for (const moon of data.moons ?? []) {
    buildObject(moon, mesh, true);
  }
}

export function buildSystem(seed) {
  saveSystem(seed);
  clearSystem();
  systemRoot = new THREE.Group();
  scene.add(systemRoot);

  const spectralType = seed.star.spectralType ?? "G";
  pointLight.color.set(
    SPECTRAL_LIGHT_COLOR[spectralType] ?? SPECTRAL_LIGHT_COLOR.G,
  );

  const starRadiusEarths = seed.star.radius * SOLAR_TO_EARTH_RADII;
  starFlyOffset = Math.max(
    FLY_OFFSET_MIN,
    visualRadius(starRadiusEarths) * FLY_OFFSET_FACTOR,
  );
  const starGeo = new THREE.SphereGeometry(
    visualRadius(starRadiusEarths),
    32,
    32,
  );
  const starMat = new THREE.MeshBasicMaterial({
    color: SPECTRAL_STAR_COLOR[spectralType] ?? SPECTRAL_STAR_COLOR.G,
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.userData.id = "star";
  systemRoot.add(starMesh);
  animObjects.push({
    id: "star",
    type: "star",
    name: `${spectralType}-type Star`,
    data: seed.star,
    mesh: starMesh,
    flyOffset: starFlyOffset,
  });

  for (const obj of seed.objects) {
    buildObject(obj, systemRoot, false);
  }
  buildPanel(seed, animObjects, {
    onFocus: handleFocus,
    onFlyTo: handleFocus,
  });
  buildPlaybackWidget({
    onTimeScale: (ts) => {
      timeScale = ts;
    },
    onPause: () => {
      paused = true;
    },
    onResume: () => {
      paused = false;
    },
  });
}
