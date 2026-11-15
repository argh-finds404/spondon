/** Minimal RIFF/WAVE reader and writer: PCM 8/16/24/32-bit and IEEE float, mixed down to mono. */

export class WavError extends Error {}

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  /** Mono mix, −1..1. */
  samples: Float32Array;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function decodeWav(input: ArrayBuffer | Uint8Array): DecodedWav {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    throw new WavError("Not a RIFF/WAVE file.");
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let p = 12; p + 8 <= bytes.byteLength; ) {
    const id = tag(view, p);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      if (size < 16 || body + size > bytes.byteLength) throw new WavError("Truncated fmt chunk.");
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in the first two bytes of its subformat GUID.
      if (format === FORMAT_EXTENSIBLE && size >= 40) format = view.getUint16(body + 24, true);
    } else if (id === "data") {
      dataOffset = body;
      // Streams written before their length was known often leave a placeholder size.
      dataLength = Math.min(size, bytes.byteLength - body);
      break;
    }
    p = body + size + (size & 1);
  }

  if (!format) throw new WavError("Missing fmt chunk.");
  if (dataOffset < 0) throw new WavError("Missing data chunk.");
  if (channels < 1 || channels > 8) throw new WavError(`Unsupported channel count: ${channels}.`);
  if (sampleRate < 4000 || sampleRate > 192000) throw new WavError(`Unsupported sample rate: ${sampleRate} Hz.`);
  const supported =
    (format === FORMAT_PCM && (bits === 8 || bits === 16 || bits === 24 || bits === 32)) ||
    (format === FORMAT_FLOAT && (bits === 32 || bits === 64));
  if (!supported) throw new WavError(`Unsupported encoding: format ${format}, ${bits}-bit.`);
  const bytesPerSample = bits / 8;
  if (blockAlign !== bytesPerSample * channels) throw new WavError("Inconsistent block alignment.");

  const frames = Math.floor(dataLength / blockAlign);
  const samples = new Float32Array(frames);
  const scale = 1 / channels;
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataOffset + i * blockAlign + c * bytesPerSample;
      let v: number;
      if (format === FORMAT_FLOAT) v = bits === 32 ? view.getFloat32(o, true) : view.getFloat64(o, true);
      else if (bits === 8) v = (view.getUint8(o) - 128) / 128;
      else if (bits === 16) v = view.getInt16(o, true) / 32768;
      else if (bits === 24) v = (((view.getUint8(o + 2) << 24) | (view.getUint8(o + 1) << 16) | (view.getUint8(o) << 8)) >> 8) / 8388608;
      else v = view.getInt32(o, true) / 2147483648;
      acc += v;
    }
    samples[i] = acc * scale;
  }
  return { sampleRate, channels, samples };
}

/** 16-bit PCM, mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out;
}
