"use client";

/* eslint-disable react-hooks/immutability -- three.js buffers, materials and cameras are mutated in place every frame by design; useFrame is react-three-fiber's imperative loop */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { chladniModes, type Modes } from "@/lib/chladni";
import { labRuntime } from "@/store/lab-store";

/**
 * The figure, in sand. A visual mapping, not a measurement: F1 and F2 of the live frame choose
 * the mode numbers (m, n) of C(x, y); each grain is pushed down the slope of C² towards the
 * lines where the plate would stay still, and jostled in proportion to the level of the voice.
 */

const HALF = 0.95;
const TOP_Y = 0.016;

/** Where the camera stands on a sphere around the plate: turned by dragging, or by the arrow keys. */
interface View {
  azimuth: number;
  polar: number;
}
const VIEW_RADIUS = 2.81;
const VIEW_HOME: View = { azimuth: 0, polar: 0.818 };
const LOOK_Y = -0.06;
const clampPolar = (v: number) => Math.min(1.42, Math.max(0.12, v));

interface Sim {
  count: number;
  positions: Float32Array;
  rest: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  phase: Float32Array;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSim(count: number): Sim {
  const rand = mulberry(1787);
  const positions = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rand() * 2 - 1) * HALF;
    positions[i * 3 + 1] = TOP_Y;
    positions[i * 3 + 2] = (rand() * 2 - 1) * HALF;
    phase[i] = rand() * Math.PI * 2;
  }
  return {
    count,
    positions,
    rest: new Float32Array(count).fill(0.5),
    vx: new Float32Array(count),
    vz: new Float32Array(count),
    phase,
  };
}

const GRAIN_VERTEX = /* glsl */ `
  attribute float aRest;
  uniform float uScale;
  varying float vRest;
  void main() {
    vRest = aRest;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(mix(3.2, 2.15, aRest) * uScale / -mv.z, 1.5, 9.0);
  }
`;

// Settled grains are ivory; grains still travelling are the orange of the sand in the archive photographs.
const GRAIN_FRAGMENT = /* glsl */ `
  varying float vRest;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float edge = 1.0 - smoothstep(0.11, 0.25, r2);
    vec3 moving = vec3(1.0, 0.333, 0.0);
    vec3 settled = vec3(0.953, 0.941, 0.902);
    gl_FragColor = vec4(mix(moving, settled, smoothstep(0.25, 0.8, vRest)), edge * 0.95);
  }
`;

const NODAL_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NODAL_FRAGMENT = /* glsl */ `
  uniform float uM;
  uniform float uN;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * ${HALF.toFixed(2)};
    float a = uN * 3.14159265;
    float b = uM * 3.14159265;
    float c = cos(a * p.x) * cos(b * p.y) - cos(b * p.x) * cos(a * p.y);
    float g = max(length(vec2(dFdx(c), dFdy(c))), 1e-4);
    float line = 1.0 - smoothstep(0.5, 1.4, abs(c) / g);
    if (line * uOpacity <= 0.01) discard;
    gl_FragColor = vec4(0.953, 0.941, 0.902, line * uOpacity);
  }
`;

function Plate({
  grains,
  showNodalLines,
  view,
}: {
  grains: number;
  showNodalLines: boolean;
  /** The visitor's own view of the plate; without it the camera drifts by itself. */
  view: RefObject<View> | null;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const sim = useMemo(() => createSim(grains), [grains]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sim.positions, 3));
    g.setAttribute("aRest", new THREE.BufferAttribute(sim.rest, 1));
    return g;
  }, [sim]);
  const grainMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: GRAIN_VERTEX,
        fragmentShader: GRAIN_FRAGMENT,
        uniforms: { uScale: { value: 3 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  const nodalMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: NODAL_VERTEX,
        fragmentShader: NODAL_FRAGMENT,
        uniforms: { uM: { value: 2.8 }, uN: { value: 5.6 }, uOpacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  const target = useRef<Modes>({ m: 2.8, n: 5.6 });
  const current = useRef<Modes>({ m: 2.8, n: 5.6 });
  const clock = useRef({ time: 0, seed: 1234567 });

  useEffect(() => () => {
    geometry.dispose();
    grainMaterial.dispose();
    nodalMaterial.dispose();
  }, [geometry, grainMaterial, nodalMaterial]);

  // Render when the engine delivers a frame: live at 60 Hz, a few Hz under reduced motion, never off screen.
  useEffect(() => labRuntime.subscribe(() => invalidate()), [invalidate]);

  useFrame((state, rawDelta) => {
    const t = labRuntime.getActiveTelemetry();
    grainMaterial.uniforms.uScale.value = (state.size.height / 160) * state.viewport.dpr;
    nodalMaterial.uniforms.uOpacity.value = showNodalLines ? 0.32 : 0;

    if (view) {
      const { azimuth, polar } = view.current;
      const flat = VIEW_RADIUS * Math.sin(polar);
      state.camera.position.set(flat * Math.sin(azimuth), LOOK_Y + VIEW_RADIUS * Math.cos(polar), flat * Math.cos(azimuth));
    } else {
      const angle = Math.sin(state.clock.elapsedTime * 0.12) * 0.42;
      state.camera.position.set(Math.sin(angle) * 2.05, 1.86, Math.cos(angle) * 2.05);
    }
    state.camera.lookAt(0, LOOK_Y, 0);

    if (t.voiced && t.formants.f1 > 0 && t.formants.f2 > 0) {
      chladniModes(t.formants.f1, t.formants.f2, target.current);
    }
    if (labRuntime.isFrozen()) return;

    // When frames arrive rarely (reduced motion), take several steps so the sand still settles.
    const steps = Math.min(8, Math.max(1, Math.round(rawDelta / 0.017)));
    const dt = 0.0167;
    const energy = t.voiced ? Math.min(1, Math.max(0.18, (t.stability.rmsDb + 55) / 42)) : 0.06;
    const { positions, rest, vx, vz, phase, count } = sim;
    const force = (0.95 + 1.35 * energy) * dt;
    const shake = (0.04 + 0.36 * energy) * dt;
    const damping = Math.exp(-9.5 * dt);
    let seed = clock.current.seed;

    for (let step = 0; step < steps; step++) {
      const slew = Math.min(1, dt * 7);
      current.current.m += (target.current.m - current.current.m) * slew;
      current.current.n += (target.current.n - current.current.n) * slew;
      const m = current.current.m;
      const n = current.current.n;
      const a = n * Math.PI;
      const b = m * Math.PI;
      clock.current.time += dt;
      const time = clock.current.time;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        let x = positions[idx];
        let z = positions[idx + 2];
        // C = cos(ax)cos(bz) − cos(bx)cos(az) and its exact slope: eight trig calls, not twenty.
        const cax = Math.cos(a * x);
        const sax = Math.sin(a * x);
        const cbx = Math.cos(b * x);
        const sbx = Math.sin(b * x);
        const caz = Math.cos(a * z);
        const saz = Math.sin(a * z);
        const cbz = Math.cos(b * z);
        const sbz = Math.sin(b * z);
        const c = cax * cbz - cbx * caz;
        const absC = c < 0 ? -c : c;
        const cx = -a * sax * cbz + b * sbx * caz;
        const cz = -b * cax * sbz + a * cbx * saz;

        seed = (seed * 1664525 + 1013904223) >>> 0;
        const rx = ((seed & 0xffff) / 32768 - 1) * shake * (0.2 + absC);
        const rz = (((seed >>> 16) & 0xffff) / 32768 - 1) * shake * (0.2 + absC);
        vx[i] = vx[i] * damping - c * cx * force + rx;
        vz[i] = vz[i] * damping - c * cz * force + rz;
        x += vx[i] * dt * 16;
        z += vz[i] * dt * 16;

        // Keep grains off the clamp and on the plate.
        const radSq = x * x + z * z;
        if (radSq < 0.017) {
          const rad = Math.sqrt(radSq) || 0.001;
          x = (x / rad) * 0.132;
          z = (z / rad) * 0.132;
        }
        if (x > HALF) {
          x = HALF - (x - HALF) * 0.4;
          vx[i] *= -0.5;
        } else if (x < -HALF) {
          x = -HALF - (x + HALF) * 0.4;
          vx[i] *= -0.5;
        }
        if (z > HALF) {
          z = HALF - (z - HALF) * 0.4;
          vz[i] *= -0.5;
        } else if (z < -HALF) {
          z = -HALF - (z + HALF) * 0.4;
          vz[i] *= -0.5;
        }

        rest[i] = Math.max(0, 1 - absC * 3.4);
        positions[idx] = x;
        positions[idx + 1] = TOP_Y + absC * energy * 0.02 * Math.abs(Math.sin(time * 28 + phase[i]));
        positions[idx + 2] = z;
      }
    }

    clock.current.seed = seed;
    nodalMaterial.uniforms.uM.value = current.current.m;
    nodalMaterial.uniforms.uN.value = current.current.n;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aRest.needsUpdate = true;
  });

  return (
    <group>
      {/* Stand and clamp: the brass of the plates in the archive. */}
      <mesh position={[0, -0.36, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 0.66, 48]} />
        <meshStandardMaterial color="#1b1e25" metalness={0.5} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[2, 0.03, 2]} />
        <meshStandardMaterial color="#15181f" metalness={0.72} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.036, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.045, 64]} />
        <meshStandardMaterial color="#b38c4e" metalness={0.9} roughness={0.28} />
      </mesh>
      <mesh position={[0, TOP_Y + 0.0006, 0]} rotation={[-Math.PI / 2, 0, 0]} material={nodalMaterial}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <points geometry={geometry} material={grainMaterial} frustumCulled={false} />
    </group>
  );
}

export interface Plate3DProps {
  /** Let the visitor orbit the plate; otherwise the camera drifts by itself. */
  interactive?: boolean;
  showNodalLines?: boolean;
  grains?: number;
}

export default function Plate3D({ interactive = false, showNodalLines = false, grains = 10000 }: Plate3DProps) {
  const view = useRef<View>({ ...VIEW_HOME });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const canvas = (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      resize={{ offsetSize: true, scroll: false }}
      camera={{ position: [0, 1.86, 2.05], fov: 36, near: 0.1, far: 20 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[2.4, 3.6, 2.2]} intensity={2.6} color="#fff4e2" />
      <directionalLight position={[-2.8, 2, -2]} intensity={1.1} color="#c9d6ea" />
      <Plate grains={grains} showNodalLines={showNodalLines} view={interactive ? view : null} />
    </Canvas>
  );
  if (!interactive) return canvas;

  // The engine redraws the plate every frame, so moving the view needs no render call of its own.
  return (
    <div
      role="application"
      tabIndex={0}
      aria-label="Chladni plate. Drag, or use the arrow keys, to turn it. Home resets the view."
      className="h-full w-full cursor-grab touch-pan-y active:cursor-grabbing"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const from = drag.current;
        if (!from) return;
        view.current.azimuth -= (e.clientX - from.x) * 0.008;
        view.current.polar = clampPolar(view.current.polar - (e.clientY - from.y) * 0.006);
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const v = view.current;
        if (e.key === "ArrowLeft") v.azimuth -= 0.12;
        else if (e.key === "ArrowRight") v.azimuth += 0.12;
        else if (e.key === "ArrowUp") v.polar = clampPolar(v.polar - 0.08);
        else if (e.key === "ArrowDown") v.polar = clampPolar(v.polar + 0.08);
        else if (e.key === "Home") Object.assign(v, VIEW_HOME);
        else return;
        e.preventDefault();
      }}
    >
      {canvas}
    </div>
  );
}
