import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SolarSystem } from "../core/types.ts";
import { eccentricAngleAtTime, visualRadius } from "../core/kinematics.ts";
import { buildViewModel, ViewBody } from "../view/view-model.ts";

const SOLAR_TO_EARTH_RADII = 109;
const AU_SCALE = 100;
const POINT_LIGHT_INTENSITY = 50;
const AMBIENT_LIGHT_COLOR = 0x333344;
const AMBIENT_LIGHT_INTENSITY = 20;
const FLY_SPEED_AU_PER_SEC = 5;
const FLY_MIN_SEC = 0.4;
const FLY_MAX_SEC = 4.0;
const FLY_ZOOM_OUT_FACTOR = 0.6;
const FLY_OFFSET_FACTOR = 6;
const FLY_OFFSET_MIN = 0.2;

const TYPE_COLORS: Record<string, number> = {
  star: 0xfff5b0, rockyPlanet: 0xc1693a, gasGiant: 0xd4874e, iceGiant: 0x6ab0d4,
  dwarfPlanet: 0x7090b0, asteroid: 0x555555, moon: 0xaaaaaa, comet: 0x88aacc,
};
const SPECTRAL_STAR_COLOR: Record<string, number> = {
  O: 0x9bb0ff, B: 0xaabfff, A: 0xcad7ff, F: 0xf8f7ff, G: 0xfff5b0, K: 0xffcc6f, M: 0xff6633,
};
const SPECTRAL_LIGHT_COLOR: Record<string, number> = {
  O: 0x7090ff, B: 0x90aaff, A: 0xc0d0ff, F: 0xfff8f0, G: 0xfff5e0, K: 0xffaa44, M: 0xff5522,
};

export interface OrreryOptions {
  /** Fired with a body id (e.g. system.star.id or a CelestialObject id) when the user clicks a body. */
  onPick?: (id: string) => void;
}

export interface OrreryHandle {
  setSystem(system: SolarSystem): void;
  setTime(days: number): void;
  setTimeScale(scale: number): void;
  pause(): void;
  resume(): void;
  /** Fly the camera to a body id (e.g. system.star.id or a CelestialObject id). */
  focus(id: string): void;
  /** Attach an arbitrary mesh as an overlay child of a body (e.g. settlement marker). */
  addOverlay(bodyId: string, object: THREE.Object3D): void;
  dispose(): void;
}

interface AnimObj {
  id: string;
  type: string;
  mesh: THREE.Object3D;
  a: number;
  b: number;
  c: number;
  periapsisAngle: number;
  initialAngle: number;
  orbitPeriod: number;
  flyOffset: number;
}

export function createOrrery(
  container: HTMLElement,
  opts: OrreryOptions = {},
): OrreryHandle {
  if (!container) throw new Error("createOrrery: container element is required");

  const width = () => container.clientWidth || globalThis.innerWidth;
  const height = () => container.clientHeight || globalThis.innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000008);

  const camera = new THREE.PerspectiveCamera(60, width() / height(), 0.1, 10000);
  camera.position.set(0, 80, 120);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width(), height());
  renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const pointLight = new THREE.PointLight(0xfff5e0, POINT_LIGHT_INTENSITY, 0);
  scene.add(pointLight);
  scene.add(new THREE.AmbientLight(AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY));

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let animObjects: AnimObj[] = [];
  const meshById: Record<string, THREE.Object3D> = {};
  let starFlyOffset = FLY_OFFSET_MIN;
  let systemRoot: THREE.Group | null = null;
  let elapsedDays = 0;
  let timeScale = 1;
  let paused = false;
  let lastTime: number | null = null;
  let rafId = 0;

  let lockedTarget: AnimObj | null = null;
  let flyState:
    | {
      startTarget: THREE.Vector3;
      startOffsetDir: THREE.Vector3;
      startOffsetDist: number;
      animObj: AnimObj | null;
      flyOffset: number;
      progress: number;
      duration: number;
      zoomOutBoost: number;
    }
    | null = null;

  const tmpVec = new THREE.Vector3();
  const flyEndTarget = new THREE.Vector3();
  const flyTmpTarget = new THREE.Vector3();
  const flyTmpDir = new THREE.Vector3();
  const FLY_END_DIR = new THREE.Vector3(1, 1, 1).normalize();
  const lockedPrevPos = new THREE.Vector3();
  const lockDelta = new THREE.Vector3();

  function buildOrbitLine(
    a: number,
    b: number,
    c: number,
    periapsisAngle: number,
    isMoon: boolean,
  ) {
    const cos = Math.cos(periapsisAngle);
    const sin = Math.sin(periapsisAngle);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 128; i++) {
      const t = (i / 128) * Math.PI * 2;
      // Perifocal point, then rotate about the focus (Y axis) by periapsisAngle.
      const x = c + a * Math.cos(t);
      const z = b * Math.sin(t);
      pts.push(new THREE.Vector3(x * cos - z * sin, 0, x * sin + z * cos));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: isMoon ? 0x1a4a5a : 0x1a3a6a,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.LineLoop(geo, mat);
  }

  function clearSystem() {
    lockedTarget = null;
    flyState = null;
    paused = false;
    if (systemRoot) {
      scene.remove(systemRoot);
      systemRoot.traverse((o: THREE.Object3D) => {
        // deno-lint-ignore no-explicit-any
        const m = o as any;
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      });
      systemRoot = null;
    }
    animObjects = [];
    for (const k of Object.keys(meshById)) delete meshById[k];
    elapsedDays = 0;
  }

  function addBody(body: ViewBody, parent: THREE.Object3D, isMoon: boolean) {
    const { a, b, c } = body.ellipse;
    const initialAngle = ((body.data as { orbitalPhase?: number }).orbitalPhase ?? 0) * Math.PI * 2;
    const periapsisAngle = (body.data as { periapsisAngle?: number }).periapsisAngle ?? 0;
    parent.add(buildOrbitLine(a, b, c, periapsisAngle, isMoon));
    const geo = new THREE.SphereGeometry(body.visualR, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: TYPE_COLORS[body.type] ?? 0xffffff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.id = body.id;
    mesh.position.copy(orbitPos(
      a, b, c,
      eccentricAngleAtTime(initialAngle, (body.data as { orbitPeriod?: number }).orbitPeriod || 1, 0, a > 0 ? c / a : 0),
      periapsisAngle,
    ));
    parent.add(mesh);
    meshById[body.id] = mesh;
    animObjects.push({
      id: body.id,
      type: body.type,
      mesh,
      a, b, c,
      periapsisAngle,
      initialAngle,
      orbitPeriod: (body.data as { orbitPeriod?: number }).orbitPeriod || 1,
      flyOffset: Math.max(FLY_OFFSET_MIN, body.visualR * FLY_OFFSET_FACTOR),
    });
    return mesh;
  }

  function setSystem(system: SolarSystem) {
    clearSystem();
    systemRoot = new THREE.Group();
    scene.add(systemRoot);

    const spectralType = system.star.spectralType;
    pointLight.color.set(SPECTRAL_LIGHT_COLOR[spectralType] ?? SPECTRAL_LIGHT_COLOR.G);

    const vm = buildViewModel(system, 0);
    const starBody = vm[0];
    const starRadiusEarths = system.star.radius * SOLAR_TO_EARTH_RADII;
    starFlyOffset = Math.max(FLY_OFFSET_MIN, visualRadius(starRadiusEarths) * FLY_OFFSET_FACTOR);
    const starMesh = new THREE.Mesh(
      new THREE.SphereGeometry(starBody.visualR, 32, 32),
      new THREE.MeshBasicMaterial({ color: SPECTRAL_STAR_COLOR[spectralType] ?? SPECTRAL_STAR_COLOR.G }),
    );
    starMesh.userData.id = system.star.id;
    systemRoot.add(starMesh);
    meshById[system.star.id] = starMesh;
    animObjects.push({
      id: system.star.id, type: "star", mesh: starMesh,
      a: 0, b: 0, c: 0, periapsisAngle: 0, initialAngle: 0, orbitPeriod: 1, flyOffset: starFlyOffset,
    });

    const sorted = [...system.objects].sort((a, b) => a.orbitRadius - b.orbitRadius);
    for (const obj of sorted) {
      const planetBody = vm.find((v) => v.id === obj.id)!;
      const planetMesh = addBody(planetBody, systemRoot, false);
      for (const moon of obj.moons ?? []) {
        const moonBody = vm.find((v) => v.id === moon.id)!;
        addBody(moonBody, planetMesh, true);
      }
    }
  }

  function orbitPos(a: number, b: number, c: number, angle: number, periapsisAngle = 0) {
    const x = c + a * Math.cos(angle);
    const z = b * Math.sin(angle);
    const cos = Math.cos(periapsisAngle);
    const sin = Math.sin(periapsisAngle);
    return tmpVec.set(x * cos - z * sin, 0, x * sin + z * cos);
  }

  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function focus(id: string) {
    const animObj = animObjects.find((o) => o.id === id) ?? null;
    const isStar = !animObj || animObj.type === "star";
    const startCamPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const flyOffset = isStar ? starFlyOffset : animObj!.flyOffset;
    const startOffset = startCamPos.clone().sub(startTarget);
    const startOffsetDist = Math.max(startOffset.length(), 1e-6);
    const startOffsetDir = startOffset.clone().divideScalar(startOffsetDist);
    const endTarget = new THREE.Vector3();
    if (!isStar) animObj!.mesh.getWorldPosition(endTarget);
    const endCamPos = endTarget.clone().addScaledVector(FLY_END_DIR, flyOffset);
    const travel = startCamPos.distanceTo(endCamPos);
    const rawDuration = travel / (FLY_SPEED_AU_PER_SEC * AU_SCALE);
    const duration = Math.max(FLY_MIN_SEC, Math.min(FLY_MAX_SEC, rawDuration));
    flyState = {
      startTarget, startOffsetDir, startOffsetDist,
      animObj: isStar ? null : animObj,
      flyOffset, progress: 0, duration,
      zoomOutBoost: travel * FLY_ZOOM_OUT_FACTOR,
    };
    lockedTarget = null;
  }

  function animate(time: number) {
    rafId = requestAnimationFrame(animate);
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
      for (const obj of animObjects) {
        if (obj.type === "star") continue;
        const angle = eccentricAngleAtTime(
          obj.initialAngle,
          obj.orbitPeriod,
          elapsedDays,
          obj.a > 0 ? obj.c / obj.a : 0,
        );
        obj.mesh.position.copy(orbitPos(obj.a, obj.b, obj.c, angle, obj.periapsisAngle));
      }
      if (flyState !== null) {
        flyState.progress = Math.min(flyState.progress + delta / flyState.duration, 1);
        const t = easeInOutCubic(flyState.progress);
        if (flyState.animObj) flyState.animObj.mesh.getWorldPosition(flyEndTarget);
        else flyEndTarget.set(0, 0, 0);
        flyTmpTarget.lerpVectors(flyState.startTarget, flyEndTarget, t);
        controls.target.copy(flyTmpTarget);
        flyTmpDir.lerpVectors(flyState.startOffsetDir, FLY_END_DIR, t).normalize();
        const baseDist = flyState.startOffsetDist * (1 - t) + flyState.flyOffset * t;
        const bump = flyState.zoomOutBoost * Math.sin(Math.PI * t);
        camera.position.copy(flyTmpTarget).addScaledVector(flyTmpDir, baseDist + bump);
        if (flyState.progress >= 1) {
          lockedTarget = flyState.animObj;
          if (lockedTarget) lockedTarget.mesh.getWorldPosition(lockedPrevPos);
          flyState = null;
        }
      }
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

  const onResize = () => {
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    renderer.setSize(width(), height());
  };
  globalThis.addEventListener("resize", onResize);

  const onClick = (e: MouseEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const meshes = animObjects.map((o) => o.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const id = hits[0].object.userData.id as string;
      if (id) opts.onPick?.(id);
    }
  };
  renderer.domElement.addEventListener("click", onClick);

  rafId = requestAnimationFrame(animate);

  return {
    setSystem,
    setTime(days) { elapsedDays = days; },
    setTimeScale(scale) { timeScale = scale; },
    pause() { paused = true; },
    resume() { paused = false; },
    focus,
    addOverlay(bodyId, object) {
      const mesh = meshById[bodyId];
      if (mesh) mesh.add(object);
    },
    dispose() {
      cancelAnimationFrame(rafId);
      globalThis.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      clearSystem();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    },
  };
}
