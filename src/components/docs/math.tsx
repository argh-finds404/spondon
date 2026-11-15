/**
 * Equations as native MathML: typeset by the browser, read by screen readers, no library.
 * `m()` tokenises a flat run ("y[n] = x[n] − 0.97 x[n−1]"); the helpers build structure.
 */

const UPRIGHT = new Set(["cos", "sin", "ln", "log", "exp", "mean", "max", "min", "clamp"]);

export function m(source: string): string {
  let out = "";
  for (const token of source.match(/\d+(?:[.,]\d+)*|[A-Za-zα-ωΑ-Ω]+|\S/g) ?? []) {
    if (/^\d/.test(token)) out += `<mn>${token}</mn>`;
    else if (/^[A-Za-zα-ωΑ-Ω]+$/.test(token)) {
      if (token.length === 1 || !UPRIGHT.has(token)) for (const ch of token) out += `<mi>${ch}</mi>`;
      else out += `<mi mathvariant="normal">${token}</mi>`;
    } else if ("[]()".includes(token)) out += `<mo stretchy="false" lspace="0" rspace="0">${token}</mo>`;
    else out += `<mo>${token === "<" ? "&lt;" : token === ">" ? "&gt;" : token}</mo>`;
  }
  return out;
}

const row = (s: string) => `<mrow>${s}</mrow>`;
export const frac = (a: string, b: string) => `<mfrac>${row(a)}${row(b)}</mfrac>`;
export const sub = (a: string, b: string) => `<msub>${row(a)}${row(b)}</msub>`;
export const sup = (a: string, b: string) => `<msup>${row(a)}${row(b)}</msup>`;
export const sum = (from: string, to: string) => `<munderover><mo>∑</mo>${row(from)}${row(to)}</munderover>`;
export const sqrt = (a: string) => `<msqrt>${a}</msqrt>`;
export const hat = (a: string) => `<mover>${row(a)}<mo>^</mo></mover>`;
export const paren = (a: string) => `<mrow><mo>(</mo>${a}<mo>)</mo></mrow>`;
export const abs = (a: string) => `<mrow><mo>|</mo>${a}<mo>|</mo></mrow>`;
export const text = (s: string) => `<mtext>${s}</mtext>`;
/** A gap between two equations set on one line. */
export const gap = `<mspace width="2em"/>`;

/** One displayed equation. `label` says it in words for anyone who cannot see it. */
export function Eq({ ml, label }: { ml: string; label: string }) {
  return (
    <div
      className="eq"
      role="math"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: `<math display="block">${ml}</math>` }}
    />
  );
}
