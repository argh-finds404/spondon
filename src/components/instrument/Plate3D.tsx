"use client";

/* eslint-disable react-hooks/immutability -- three.js buffers, materials and cameras are mutated in place every frame by design; useFrame is react-three-fiber's imperative loop */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { chladniModes, type Modes } from "@/lib/chladni";
import {
  buildHarmonicTerms,
  circularModes,
  evalCircularStandingWave,
  evalHarmonicSuperposition,
  sampleVocalTractRadius,
  type CircularModes,
  type HarmonicTerm,
} from "@/lib/shapes";
import { labRuntime, useLabStore } from "@/store/lab-store";
import type { ShapeModel } from "@/types/dsp";

/**
 * Multi-geometry interactive 3D acoustic stage:
 * - "square":   Clamped square Chladni brass plate + 10,000 sand grains on C(x,z) = 0
 * - "circular": Circular Bessel drumhead / brass disc + concentric Bessel J_m(α_{m,n}r)cos(mθ) rings
 * - "harmonic": Multi-harmonic FFT superposition field Ψ(x,z) + live 3D deformed wave mesh (works on ANY sound)
 * - "tract":    3D Kelly-Lochbaum vocal-tract resonator tube extruded live from glottis to lips with F0 pressure waves
 *
 * Interactive 3D controls:
 * - Pointer drag: inertial 3D orbit (azimuth & polar)
 * - Mouse wheel: smooth zoom in/out
 * - Click / tap on plate (or "Tap plate" button): physical radial shockwave scattering sand grains + expanding brass ring
 */

const HALF = 0.95;
const DISC_R = 0.94;
const TOP_Y = 0.018;

interface View {
  azimuth: number;
  polar: number;
  radius: number;
}

const VIEW_HOME: View = { azimuth: 0.18, polar: 0.82, radius: 2.78 };
const VIEW_TRACT: View = { azimuth: 0.42, polar: 1.08, radius: 2.75 };
const LOOK_Y = -0.04;
const clampPolar = (v: number) => Math.min(1.46, Math.max(0.14, v));
const clampRadius = (v: number) => Math.min(4.1, Math.max(1.75, v));

interface ImpulseState {
  active: boolean;
  x: number;
  z: number;
  age: number;
  lastCount: number;
}

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
    gl_PointSize = clamp(mix(3.4, 2.15, aRest) * uScale / -mv.z, 1.5, 9.5);
  }
`;

const GRAIN_FRAGMENT = /* glsl */ `
  varying float vRest;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float edge = 1.0 - smoothstep(0.11, 0.25, r2);
    vec3 moving = vec3(1.0, 0.333, 0.0);
    vec3 settled = vec3(0.953, 0.941, 0.902);
    gl_FragColor = vec4(mix(moving, settled, smoothstep(0.22, 0.82, vRest)), edge * 0.95);
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
  uniform float uCircular;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv * 2.0 - 1.0) * ${HALF.toFixed(2)};
    if (uCircular > 0.5 && length(p) > ${DISC_R.toFixed(2)}) discard;
    float a = uN * 3.14159265;
    float b = uM * 3.14159265;
    float c;
    if (uCircular > 0.5) {
      float r = length(p) / ${DISC_R.toFixed(2)};
      float th = atan(p.y, p.x);
      c = cos(uM * th) * sin(3.14159265 * uN * r);
    } else {
      c = cos(a * p.x) * cos(b * p.y) - cos(b * p.x) * cos(a * p.y);
    }
    float g = max(length(vec2(dFdx(c), dFdy(c))), 1e-4);
    float line = 1.0 - smoothstep(0.45, 1.35, abs(c) / g);
    if (line * uOpacity <= 0.01) discard;
    gl_FragColor = vec4(0.953, 0.941, 0.902, line * uOpacity);
  }
`;

const WAVE_GRID = 38;
const TRACT_SLICES = 40;
const TRACT_RADIAL = 28;

function StageScene({
  grains,
  showNodalLines,
  shapeModel,
  frame,
  isPointerDownRef,
  lastInteractionRef,
  viewTarget,
  impulse,
}: {
  grains: number;
  showNodalLines: boolean;
  shapeModel: ShapeModel;
  frame: import("@/types/dsp").DSPFrameTelemetry | null;
  isPointerDownRef: RefObject<boolean>;
  lastInteractionRef: RefObject<number>;
  viewTarget: RefObject<View> | null;
  impulse: RefObject<ImpulseState>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const exciteCount = useLabStore((s) => s.plateExciteCount);

  const sim = useMemo(() => createSim(grains), [grains]);
  const grainGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sim.positions, 3));
    g.setAttribute("aRest", new THREE.BufferAttribute(sim.rest, 1));
    return g;
  }, [sim]);

  // 3D deformed harmonic wave surface (shown in "harmonic" mode)
  const waveGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2, WAVE_GRID, WAVE_GRID);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  // 3D dynamic Kelly-Lochbaum vocal-tract tube geometry (shown in "tract" mode)
  const tractData = useMemo(() => {
    const vertCount = (TRACT_SLICES + 1) * (TRACT_RADIAL + 1);
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const indices: number[] = [];
    for (let s = 0; s < TRACT_SLICES; s++) {
      for (let r = 0; r < TRACT_RADIAL; r++) {
        const a = s * (TRACT_RADIAL + 1) + r;
        const b = a + TRACT_RADIAL + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setIndex(indices);
    const smoothedArea = new Float32Array(13).fill(0.45);
    return { geom, positions, colors, smoothedArea };
  }, []);

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
        uniforms: {
          uM: { value: 2.8 },
          uN: { value: 5.6 },
          uOpacity: { value: 0 },
          uCircular: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );

  const rippleRef = useRef<THREE.Mesh>(null);
  const squareMeshRef = useRef<THREE.Mesh>(null);
  const discGroupRef = useRef<THREE.Group>(null);
  const waveMeshRef = useRef<THREE.Mesh>(null);
  const tractGroupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);

  const targetSq = useRef<Modes>({ m: 2.8, n: 5.6 });
  const currentSq = useRef<Modes>({ m: 2.8, n: 5.6 });
  const targetCirc = useRef<CircularModes>({ m: 2.2, n: 2.1 });
  const currentCirc = useRef<CircularModes>({ m: 2.2, n: 2.1 });
  const harmonicTerms = useRef<HarmonicTerm[]>(
    Array.from({ length: 6 }, () => ({ m: 2.5, n: 5.5, weight: 0 })),
  );
  const viewSmooth = useRef<View>({ ...VIEW_HOME });
  const clock = useRef({ time: 0, seed: 1234567 });
  const prevModelRef = useRef<ShapeModel>(shapeModel);

  useEffect(() => {
    if (exciteCount > impulse.current.lastCount) {
      impulse.current.lastCount = exciteCount;
      impulse.current.active = true;
      impulse.current.x = 0;
      impulse.current.z = 0;
      impulse.current.age = 0;
      invalidate();
    }
  }, [exciteCount, impulse, invalidate]);

  useEffect(() => {
    if (prevModelRef.current !== shapeModel) {
      prevModelRef.current = shapeModel;
      if (viewTarget) {
        if (shapeModel === "tract") {
          viewTarget.current.azimuth = VIEW_TRACT.azimuth;
          viewTarget.current.polar = VIEW_TRACT.polar;
        } else if (Math.abs(viewTarget.current.polar - VIEW_TRACT.polar) < 0.05) {
          viewTarget.current.polar = VIEW_HOME.polar;
        }
      }
      // Give grains a gentle physical scatter whenever switching plate geometry
      impulse.current.active = true;
      impulse.current.x = 0;
      impulse.current.z = 0;
      impulse.current.age = 0.12;
      invalidate();
    }
  }, [shapeModel, viewTarget, impulse, invalidate]);

  useEffect(
    () => () => {
      grainGeometry.dispose();
      waveGeometry.dispose();
      tractData.geom.dispose();
      grainMaterial.dispose();
      nodalMaterial.dispose();
    },
    [grainGeometry, waveGeometry, tractData, grainMaterial, nodalMaterial],
  );

  // Continuous 60 fps animation loop while mounted on screen so auto-orbit, standing-wave
  // breathing, and external morphed frames (e.g., /compare A <-> B morphing) animate fluidly.
  useEffect(() => {
    let raf = 0;
    let active = true;
    const loop = () => {
      if (!active) return;
      invalidate();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
    };
  }, [invalidate]);

  useFrame((state, rawDelta) => {
    const t = frame ?? labRuntime.getActiveTelemetry();
    const dtFrame = Math.min(0.05, Math.max(0.004, rawDelta || 0.0167));
    grainMaterial.uniforms.uScale.value = (state.size.height / 160) * state.viewport.dpr;

    // Smooth inertial camera orbit & zoom, with gentle continuous auto-orbit when idle (>1.5s)
    if (viewTarget) {
      const idleSec = (performance.now() - lastInteractionRef.current) / 1000;
      if (!isPointerDownRef.current && idleSec > 1.5) {
        viewTarget.current.azimuth += dtFrame * 0.16;
      }
      const camLerp = 1 - Math.exp(-12 * dtFrame);
      viewSmooth.current.azimuth += (viewTarget.current.azimuth - viewSmooth.current.azimuth) * camLerp;
      viewSmooth.current.polar += (viewTarget.current.polar - viewSmooth.current.polar) * camLerp;
      viewSmooth.current.radius += (viewTarget.current.radius - viewSmooth.current.radius) * camLerp;
      const { azimuth, polar, radius } = viewSmooth.current;
      const breathY = Math.sin(state.clock.elapsedTime * 1.1) * 0.025;
      const flat = radius * Math.sin(polar);
      state.camera.position.set(
        flat * Math.sin(azimuth),
        LOOK_Y + breathY + radius * Math.cos(polar),
        flat * Math.cos(azimuth),
      );
    } else {
      const angle = state.clock.elapsedTime * 0.22;
      state.camera.position.set(Math.sin(angle) * 2.1, 1.84 + Math.sin(angle * 1.5) * 0.05, Math.cos(angle) * 2.1);
    }
    state.camera.lookAt(0, shapeModel === "tract" ? 0.08 : LOOK_Y, 0);

    // Toggle active 3D sub-assemblies cleanly
    const isTract = shapeModel === "tract";
    const isCircular = shapeModel === "circular";
    const isHarmonic = shapeModel === "harmonic";
    if (squareMeshRef.current) squareMeshRef.current.visible = shapeModel === "square" || isHarmonic;
    if (discGroupRef.current) discGroupRef.current.visible = isCircular;
    if (waveMeshRef.current) waveMeshRef.current.visible = isHarmonic;
    if (tractGroupRef.current) tractGroupRef.current.visible = isTract;
    if (pointsRef.current) pointsRef.current.visible = !isTract;

    nodalMaterial.uniforms.uCircular.value = isCircular ? 1 : 0;
    nodalMaterial.uniforms.uOpacity.value = !isTract && !isHarmonic && showNodalLines ? 0.3 : 0;

    if (t.formants.f1 > 0 && t.formants.f2 > 0) {
      chladniModes(t.formants.f1, t.formants.f2, targetSq.current);
      circularModes(t.formants.f1, t.formants.f2, targetCirc.current);
    }

    // Animate click/tap shockwave ring
    const imp = impulse.current;
    if (rippleRef.current) {
      if (imp.active && !isTract) {
        imp.age += dtFrame;
        const progress = imp.age / 0.65;
        if (progress >= 1) {
          imp.active = false;
          rippleRef.current.visible = false;
        } else {
          rippleRef.current.visible = true;
          rippleRef.current.position.set(imp.x, TOP_Y + 0.004, imp.z);
          const s = 0.08 + progress * 1.25;
          rippleRef.current.scale.set(s, s, 1);
          const mat = rippleRef.current.material as THREE.MeshBasicMaterial;
          mat.opacity = (1 - progress) * 0.75;
        }
        invalidate();
      } else {
        rippleRef.current.visible = false;
      }
    }

    // ── Mode 4: 3D Vocal-Tract Acoustic Resonator Tube ──────────────────────
    if (isTract) {
      const { geom, positions, colors, smoothedArea } = tractData;
      const areaLerp = 1 - Math.exp(-10 * dtFrame);
      for (let i = 0; i < smoothedArea.length; i++) {
        const targetVal = t.vocalTractArea[i] ?? 0.45;
        smoothedArea[i] += (targetVal - smoothedArea[i]) * areaLerp;
      }
      if (!labRuntime.isFrozen()) {
        clock.current.time += dtFrame;
      }
      const f0Norm = t.voiced && t.stability.f0Hz > 0 ? t.stability.f0Hz / 130 : 0.6;
      const energy = Math.min(1, Math.max(0.08, (t.stability.rmsDb + 58) / 44));
      const wavePhase = clock.current.time * 9.5 * f0Norm;

      let ptr = 0;
      for (let s = 0; s <= TRACT_SLICES; s++) {
        const u = s / TRACT_SLICES;
        // Slight anatomical arch from vertical pharynx (-x) to horizontal oral cavity (+x)
        const x = (u * 2 - 1) * 1.04;
        const centerY = 0.1 + Math.sin(u * Math.PI) * 0.14 - (1 - u) * 0.08;
        const baseR = sampleVocalTractRadius(smoothedArea, u);
        // Traveling acoustic pressure wave from glottis (u=0) to lips (u=1)
        const pulse = 0.5 + 0.5 * Math.sin(u * 12 - wavePhase);
        const r = baseR * (1 + 0.055 * energy * (pulse - 0.5));

        for (let j = 0; j <= TRACT_RADIAL; j++) {
          const ang = (j / TRACT_RADIAL) * Math.PI * 2;
          const cy = Math.cos(ang);
          const sz = Math.sin(ang);
          positions[ptr] = x;
          positions[ptr + 1] = centerY + cy * r;
          positions[ptr + 2] = sz * r * 1.08;

          // Color encodes constriction vs expansion + acoustic wave crest in SPONDON palette
          const openRatio = Math.min(1, Math.max(0, (baseR - 0.12) / 0.38));
          const crest = pulse * energy * 0.65;
          // Warm ivory/slate chassis mixed with orange pressure crests
          colors[ptr] = 0.16 + 0.78 * crest + 0.14 * openRatio;
          colors[ptr + 1] = 0.17 + 0.24 * crest + 0.16 * openRatio;
          colors[ptr + 2] = 0.2 + 0.04 * crest + 0.15 * openRatio;
          ptr += 3;
        }
      }
      geom.attributes.position.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
      geom.computeVertexNormals();
      return;
    }

    if (labRuntime.isFrozen() && !frame && !imp.active) return;

    // ── Modes 1–3: Particle & Wave Standing-Wave Physics ───────────────────
    const steps = Math.min(6, Math.max(1, Math.round(dtFrame / 0.0167)));
    const dt = 0.0167;
    const rawEnergy = Math.min(1, Math.max(0.08, (t.stability.rmsDb + 58) / 42));
    const energy = t.voiced ? Math.max(0.22, rawEnergy) : rawEnergy * 0.85;
    const { positions, rest, vx, vz, phase, count } = sim;
    const force = (0.98 + 1.35 * energy) * dt;
    const shake = (0.035 + 0.34 * energy) * dt;
    const damping = Math.exp(-9.2 * dt);
    let seed = clock.current.seed;

    const termCount = isHarmonic
      ? buildHarmonicTerms(t.regime.topPeaks, currentSq.current.m, currentSq.current.n, harmonicTerms.current)
      : 0;

    // Apply instantaneous radial impulse scatter when user clicks/taps the plate
    const applyKick = imp.active && imp.age < 0.06;
    const grad = { c: 0, gx: 0, gz: 0 };

    for (let step = 0; step < steps; step++) {
      const slew = Math.min(1, dt * 7.5);
      currentSq.current.m += (targetSq.current.m - currentSq.current.m) * slew;
      currentSq.current.n += (targetSq.current.n - currentSq.current.n) * slew;
      currentCirc.current.m += (targetCirc.current.m - currentCirc.current.m) * slew;
      currentCirc.current.n += (targetCirc.current.n - currentCirc.current.n) * slew;

      const m = currentSq.current.m;
      const n = currentSq.current.n;
      const a = n * Math.PI;
      const b = m * Math.PI;
      const cm = currentCirc.current.m;
      const cn = currentCirc.current.n;

      clock.current.time += dt;
      const time = clock.current.time;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        let x = positions[idx];
        let z = positions[idx + 2];

        let c = 0;
        let cx = 0;
        let cz = 0;

        if (isCircular) {
          const eps = 0.012;
          c = evalCircularStandingWave(x, z, cm, cn, DISC_R);
          cx = (evalCircularStandingWave(x + eps, z, cm, cn, DISC_R) - c) / eps;
          cz = (evalCircularStandingWave(x, z + eps, cm, cn, DISC_R) - c) / eps;
        } else if (isHarmonic) {
          evalHarmonicSuperposition(x, z, harmonicTerms.current, termCount, grad);
          c = grad.c;
          cx = grad.gx;
          cz = grad.gz;
        } else {
          const cax = Math.cos(a * x);
          const sax = Math.sin(a * x);
          const cbx = Math.cos(b * x);
          const sbx = Math.sin(b * x);
          const caz = Math.cos(a * z);
          const saz = Math.sin(a * z);
          const cbz = Math.cos(b * z);
          const sbz = Math.sin(b * z);
          c = cax * cbz - cbx * caz;
          cx = -a * sax * cbz + b * sbx * caz;
          cz = -b * cax * sbz + a * cbx * saz;
        }

        const absC = c < 0 ? -c : c;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const rx = ((seed & 0xffff) / 32768 - 1) * shake * (0.2 + absC);
        const rz = (((seed >>> 16) & 0xffff) / 32768 - 1) * shake * (0.2 + absC);

        vx[i] = vx[i] * damping - c * cx * force + rx;
        vz[i] = vz[i] * damping - c * cz * force + rz;

        if (applyKick && step === 0) {
          const dx = x - imp.x;
          const dz = z - imp.z;
          const dist = Math.hypot(dx, dz) + 0.08;
          if (dist < 0.85) {
            const kick = ((0.85 - dist) / 0.85) * 0.24;
            vx[i] += (dx / dist) * kick + rx * 2.5;
            vz[i] += (dz / dist) * kick + rz * 2.5;
          }
        }

        x += vx[i] * dt * 16;
        z += vz[i] * dt * 16;

        // Center brass clamp exclusion
        const radSq = x * x + z * z;
        if (radSq < 0.016) {
          const rad = Math.sqrt(radSq) || 0.001;
          x = (x / rad) * 0.128;
          z = (z / rad) * 0.128;
        }

        // Outer boundary: circular brass rim vs square plate edge
        if (isCircular) {
          const rad = Math.hypot(x, z);
          if (rad > DISC_R - 0.015) {
            const lim = DISC_R - 0.015;
            x = (x / rad) * lim;
            z = (z / rad) * lim;
            vx[i] *= -0.45;
            vz[i] *= -0.45;
          }
        } else {
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
        }

        const hopLift = imp.active ? Math.max(0, (0.35 - imp.age) * 0.09) : 0;
        rest[i] = Math.max(0, 1 - absC * 3.4);
        positions[idx] = x;
        positions[idx + 1] =
          TOP_Y + (absC * energy * 0.024 + hopLift) * Math.abs(Math.sin(time * 28 + phase[i]));
        positions[idx + 2] = z;
      }
    }

    // Deform 3D harmonic wave mesh in "harmonic" mode
    if (isHarmonic) {
      const posAttr = waveGeometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const osc = Math.cos(clock.current.time * 12) * (0.045 + 0.065 * energy);
      for (let v = 0; v < posAttr.count; v++) {
        const vxPos = arr[v * 3];
        const vzPos = arr[v * 3 + 2];
        const val = evalHarmonicSuperposition(vxPos, vzPos, harmonicTerms.current, termCount);
        arr[v * 3 + 1] = TOP_Y + 0.004 + val * osc;
      }
      posAttr.needsUpdate = true;
    }

    clock.current.seed = seed;
    nodalMaterial.uniforms.uM.value = isCircular ? currentCirc.current.m : currentSq.current.m;
    nodalMaterial.uniforms.uN.value = isCircular ? currentCirc.current.n : currentSq.current.n;
    grainGeometry.attributes.position.needsUpdate = true;
    grainGeometry.attributes.aRest.needsUpdate = true;
  });

  return (
    <group>
      {/* Turned dark metal pedestal */}
      <mesh position={[0, -0.36, 0]}>
        <cylinderGeometry args={[0.07, 0.12, 0.66, 48]} />
        <meshStandardMaterial color="#1b1e25" metalness={0.55} roughness={0.5} />
      </mesh>

      {/* Square Chladni plate */}
      <mesh ref={squareMeshRef} position={[0, 0, 0]}>
        <boxGeometry args={[2, 0.032, 2]} />
        <meshStandardMaterial color="#15181f" metalness={0.74} roughness={0.36} />
      </mesh>

      {/* Circular Bessel drumhead / brass-rimmed disc */}
      <group ref={discGroupRef} visible={false}>
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[DISC_R + 0.03, DISC_R + 0.03, 0.032, 72]} />
          <meshStandardMaterial color="#15181f" metalness={0.74} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.017, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[DISC_R + 0.015, 0.018, 20, 80]} />
          <meshStandardMaterial color="#b38c4e" metalness={0.88} roughness={0.3} />
        </mesh>
      </group>

      {/* Central brass clamp (for plate modes) */}
      {shapeModel !== "tract" && (
        <mesh position={[0, 0.036, 0]}>
          <cylinderGeometry args={[0.105, 0.105, 0.044, 64]} />
          <meshStandardMaterial color="#b38c4e" metalness={0.9} roughness={0.28} />
        </mesh>
      )}

      {/* Deformed 3D harmonic standing-wave wireframe surface */}
      <mesh ref={waveMeshRef} geometry={waveGeometry} visible={false}>
        <meshBasicMaterial color="#1fdcff" wireframe transparent opacity={0.26} />
      </mesh>

      {/* Nodal guide shader plane */}
      <mesh position={[0, TOP_Y + 0.0008, 0]} rotation={[-Math.PI / 2, 0, 0]} material={nodalMaterial}>
        <planeGeometry args={[2, 2]} />
      </mesh>

      {/* Interactive click/tap shockwave ring */}
      <mesh ref={rippleRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.72, 0.8, 64]} />
        <meshBasicMaterial color="#ff4d00" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>

      {/* 10,000 simulated sand grains */}
      <points ref={pointsRef} geometry={grainGeometry} material={grainMaterial} frustumCulled={false} />

      {/* 3D Kelly-Lochbaum Vocal-Tract Acoustic Resonator Tube */}
      <group ref={tractGroupRef} visible={false}>
        <mesh geometry={tractData.geom}>
          <meshStandardMaterial
            vertexColors
            side={THREE.DoubleSide}
            metalness={0.35}
            roughness={0.42}
          />
        </mesh>
        <mesh geometry={tractData.geom}>
          <meshBasicMaterial color="#1fdcff" wireframe transparent opacity={0.18} />
        </mesh>
        {/* Glottis (-x) and Lip (+x) brass reference rings */}
        <mesh position={[-1.04, 0.02, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.24, 0.014, 16, 48]} />
          <meshStandardMaterial color="#b38c4e" metalness={0.88} roughness={0.3} />
        </mesh>
        <mesh position={[1.04, 0.1, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.38, 0.016, 16, 48]} />
          <meshStandardMaterial color="#ff4d00" metalness={0.7} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}

export interface Plate3DProps {
  /** Let the visitor orbit, zoom, and tap-excite the 3D stage; otherwise the camera drifts gently. */
  interactive?: boolean;
  showNodalLines?: boolean;
  shapeModel?: ShapeModel;
  grains?: number;
  /** Optional explicit telemetry frame (e.g. live A <-> B morphed frame in /compare). */
  frame?: import("@/types/dsp").DSPFrameTelemetry | null;
}

export default function Plate3D({
  interactive = false,
  showNodalLines = false,
  shapeModel = "square",
  grains = 10000,
  frame = null,
}: Plate3DProps) {
  const view = useRef<View>({ ...VIEW_HOME });
  const isPointerDownRef = useRef(false);
  const lastInteractionRef = useRef(0);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const impulse = useRef<ImpulseState>({ active: false, x: 0, z: 0, age: 0, lastCount: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteractionRef.current = performance.now();
      view.current.radius = clampRadius(view.current.radius + e.deltaY * 0.0016);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [interactive]);

  const canvas = (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      resize={{ offsetSize: true, scroll: false }}
      camera={{ position: [0.4, 1.86, 2.05], fov: 36, near: 0.1, far: 20 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[2.4, 3.6, 2.2]} intensity={2.6} color="#fff4e2" />
      <directionalLight position={[-2.8, 2, -2]} intensity={1.15} color="#c9d6ea" />
      <StageScene
        grains={grains}
        showNodalLines={showNodalLines}
        shapeModel={shapeModel}
        frame={frame}
        isPointerDownRef={isPointerDownRef}
        lastInteractionRef={lastInteractionRef}
        viewTarget={interactive ? view : null}
        impulse={impulse}
      />
    </Canvas>
  );
  if (!interactive) return canvas;

  return (
    <div
      ref={containerRef}
      role="application"
      tabIndex={0}
      data-testid="plate-3d-stage"
      aria-label="Interactive 3D acoustic stage. Drag to orbit, scroll to zoom, click to tap-excite the sand plate, or press Home to reset."
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      onPointerDown={(e) => {
        isPointerDownRef.current = true;
        lastInteractionRef.current = performance.now();
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic events in headless WebDriver */
        }
      }}
      onPointerMove={(e) => {
        const from = drag.current;
        if (!from) return;
        lastInteractionRef.current = performance.now();
        const dx = e.clientX - from.x;
        const dy = e.clientY - from.y;
        if (Math.hypot(e.clientX - from.startX, e.clientY - from.startY) > 5) {
          from.moved = true;
        }
        view.current.azimuth -= dx * 0.0085;
        view.current.polar = clampPolar(view.current.polar - dy * 0.0065);
        from.x = e.clientX;
        from.y = e.clientY;
      }}
      onPointerUp={(e) => {
        isPointerDownRef.current = false;
        lastInteractionRef.current = performance.now();
        const from = drag.current;
        drag.current = null;
        if (from && !from.moved && shapeModel !== "tract") {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const nz = ((e.clientY - rect.top) / rect.height) * 2 - 1;
            impulse.current.active = true;
            impulse.current.x = Math.max(-0.8, Math.min(0.8, nx * 0.85));
            impulse.current.z = Math.max(-0.8, Math.min(0.8, nz * 0.85));
            impulse.current.age = 0;
          }
        }
      }}
      onPointerCancel={() => {
        isPointerDownRef.current = false;
        drag.current = null;
      }}
      onDoubleClick={() => {
        Object.assign(view.current, shapeModel === "tract" ? VIEW_TRACT : VIEW_HOME);
      }}
      onKeyDown={(e) => {
        const v = view.current;
        if (e.key === "ArrowLeft") v.azimuth -= 0.12;
        else if (e.key === "ArrowRight") v.azimuth += 0.12;
        else if (e.key === "ArrowUp") v.polar = clampPolar(v.polar - 0.08);
        else if (e.key === "ArrowDown") v.polar = clampPolar(v.polar + 0.08);
        else if (e.key === "+" || e.key === "=") v.radius = clampRadius(v.radius - 0.18);
        else if (e.key === "-") v.radius = clampRadius(v.radius + 0.18);
        else if (e.key === " ") {
          impulse.current.active = true;
          impulse.current.x = 0;
          impulse.current.z = 0;
          impulse.current.age = 0;
        } else if (e.key === "Home") {
          Object.assign(v, shapeModel === "tract" ? VIEW_TRACT : VIEW_HOME);
        } else return;
        e.preventDefault();
      }}
    >
      {canvas}
    </div>
  );
}
