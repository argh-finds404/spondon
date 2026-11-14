import type { WindowType } from "@/types/dsp";

export interface WindowInfo {
  label: string;
  formula: string;
  /** Null-to-null main-lobe width in DFT bins. */
  mainLobeBins: number;
  /** Highest sidelobe relative to the main lobe. */
  peakSidelobeDb: number;
}

export const WINDOW_INFO: Record<WindowType, WindowInfo> = {
  rectangular: { label: "Rectangular", formula: "w[n] = 1", mainLobeBins: 2, peakSidelobeDb: -13.3 },
  hamming: {
    label: "Hamming",
    formula: "w[n] = 0.54 − 0.46 cos(2πn / (N − 1))",
    mainLobeBins: 4,
    peakSidelobeDb: -42.7,
  },
  hann: {
    label: "Hann",
    formula: "w[n] = 0.5 (1 − cos(2πn / (N − 1)))",
    mainLobeBins: 4,
    peakSidelobeDb: -31.5,
  },
  blackman: {
    label: "Blackman",
    formula: "w[n] = 0.42 − 0.5 cos(2πn / (N − 1)) + 0.08 cos(4πn / (N − 1))",
    mainLobeBins: 6,
    peakSidelobeDb: -58.1,
  },
};

export const WINDOW_TYPES = Object.keys(WINDOW_INFO) as WindowType[];

export interface WindowTable {
  w: Float32Array;
  /** Sum of w[n]; sum / N is the coherent gain. */
  sum: number;
}

const cache = new Map<string, WindowTable>();

/** The window as a lookup table, built once per (type, length). */
export function getWindow(type: WindowType, n: number): WindowTable {
  const key = `${type}:${n}`;
  let table = cache.get(key);
  if (table) return table;
  const w = new Float32Array(n);
  const k = (2 * Math.PI) / (n - 1);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let v = 1;
    if (type === "hamming") v = 0.54 - 0.46 * Math.cos(k * i);
    else if (type === "hann") v = 0.5 * (1 - Math.cos(k * i));
    else if (type === "blackman") v = 0.42 - 0.5 * Math.cos(k * i) + 0.08 * Math.cos(2 * k * i);
    w[i] = v;
    sum += v;
  }
  table = { w, sum };
  cache.set(key, table);
  return table;
}

/**
 * y[n] = x[n] - alpha * x[n-1]. Cancels the roughly -6 dB/octave tilt of voiced speech
 * so linear prediction spends its poles on resonances instead of on the slope.
 */
export function applyPreEmphasis(
  input: Float32Array,
  alpha = 0.97,
  out: Float32Array = new Float32Array(input.length),
): Float32Array {
  let prev = input[0];
  out[0] = input[0] * (1 - alpha);
  for (let i = 1; i < input.length; i++) {
    const x = input[i];
    out[i] = x - alpha * prev;
    prev = x;
  }
  return out;
}
