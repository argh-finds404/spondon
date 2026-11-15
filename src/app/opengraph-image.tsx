import { ImageResponse } from "next/og";
import { chladni, chladniModes } from "@/lib/chladni";
import { DEFAULT_TARGET } from "@/lib/dsp/vowel-targets";

export const alt = "SPONDON: speak a vowel, see its figure. The Chladni figure of the vowel আ, drawn in dots.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#f3f0e6";
const PLATE = 470;
const GRID = 58;

/** The figure of the first reference vowel as two dot paths: grains on the nodal lines, and the rest. */
function figurePaths(): { lit: string; dim: string } {
  const { m, n } = chladniModes(DEFAULT_TARGET.targetF1, DEFAULT_TARGET.targetF2);
  let lit = "";
  let dim = "";
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = ((i + 0.5) / GRID) * 2 - 1;
      const y = ((j + 0.5) / GRID) * 2 - 1;
      if (x * x + y * y < 0.012) continue;
      const dot = `M${(((i + 0.5) / GRID) * PLATE).toFixed(1)} ${(((j + 0.5) / GRID) * PLATE).toFixed(1)}h0.01`;
      if (Math.abs(chladni(x * 0.95, y * 0.95, m, n)) < 0.2) lit += dot;
      else dim += dot;
    }
  }
  return { lit, dim };
}

export default function OpengraphImage() {
  const { lit, dim } = figurePaths();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 72px",
          background: "#08090c",
          color: INK,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width="52" height="52" viewBox="0 0 32 32">
              <rect x="1" y="1" width="30" height="30" rx="1.5" fill={INK} />
              <path d="M16 0C3.5 7.5 3.5 12.5 16 16s12.5 8.5 0 16" fill="none" stroke="#08090c" strokeWidth="3.4" />
              <circle cx="16" cy="16" r="5.6" fill="#08090c" />
              <circle cx="16" cy="16" r="3.2" fill="#ff5500" />
            </svg>
            <div style={{ fontSize: 34, letterSpacing: 3 }}>SPONDON</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 64, fontSize: 82, lineHeight: 1.02, letterSpacing: -3 }}>
            <span>Speak a vowel.</span>
            <span>See its figure.</span>
          </div>
          <div style={{ marginTop: 36, fontSize: 30, lineHeight: 1.3, color: "#8a909e" }}>
            An acoustic laboratory in a browser tab. Pitch, formants and poles, measured live.
          </div>
        </div>
        <div style={{ display: "flex", width: PLATE, height: PLATE, background: "#101217", borderRadius: 3 }}>
          <svg width={PLATE} height={PLATE} viewBox={`0 0 ${PLATE} ${PLATE}`}>
            <path d={dim} stroke="#262a33" strokeWidth="3.4" strokeLinecap="round" fill="none" />
            <path d={lit} stroke={INK} strokeWidth="5.6" strokeLinecap="round" fill="none" />
            <circle cx={PLATE / 2} cy={PLATE / 2} r="13" fill="#ff5500" />
          </svg>
        </div>
      </div>
    ),
    size,
  );
}
