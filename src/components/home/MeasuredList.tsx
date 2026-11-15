import Image from "next/image";
import { Prov, type Provenance } from "@/components/instrument/controls";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Reveal } from "@/components/site/Reveal";
import { worldAsset } from "@/lib/world-assets";

const GROUPS: {
  word: string;
  kind: Provenance;
  rows: { name: string; field: ReadoutField; unit?: string; bangla?: boolean }[];
}[] = [
  {
    word: "Measured",
    kind: "measured",
    rows: [
      { name: "Fundamental frequency, F0", field: "f0", unit: "Hz" },
      { name: "Jitter, cycle to cycle", field: "jitter", unit: "%" },
      { name: "Shimmer", field: "shimmer", unit: "dB" },
      { name: "Level", field: "level", unit: "dB FS" },
      { name: "Syllable rate", field: "syllables", unit: "per s" },
    ],
  },
  {
    word: "Derived",
    kind: "derived",
    rows: [
      { name: "First formant, F1", field: "f1", unit: "Hz" },
      { name: "Second formant, F2", field: "f2", unit: "Hz" },
      { name: "Third formant, F3", field: "f3", unit: "Hz" },
      { name: "Bandwidth of F1", field: "b1", unit: "Hz" },
      { name: "Pole radius of F1", field: "poleRadius" },
      { name: "Nearest reference vowel", field: "vowel", bangla: true },
      { name: "Distance to the target", field: "bark", unit: "Bark" },
    ],
  },
  {
    word: "Mapped",
    kind: "mapped",
    rows: [
      { name: "Plate mode m, chosen by F1", field: "modeM" },
      { name: "Plate mode n, chosen by F2", field: "modeN" },
    ],
  },
];

/** Two-ended rows: what the instrument reports, grouped by how far each number is from the signal. */
export function MeasuredList() {
  const plates = worldAsset("chladni-plate-10");
  return (
    <Reveal as="section" id="honest" className="section wrap grid12 gap-y-12">
      <div className="col-span-12 lg:col-span-5 lg:col-start-2">
        <h2 className="t-head reveal">Measured, derived, or drawn.</h2>
        <div data-ui className="reveal mt-10 max-w-[540px]" style={{ "--i": 1 } as React.CSSProperties}>
          {GROUPS.map((group) => (
            <div key={group.word} className="mb-10 last:mb-0">
              <h3 className="mb-1 text-[15px] text-muted">{group.word}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.field} className="flex min-h-11 items-center justify-between gap-6 sm:min-h-9">
                    <span className="flex items-center gap-2.5 text-[16px] text-ink">
                      <Prov kind={group.kind}>{row.name}</Prov>
                    </span>
                    <span className={`text-[13px] whitespace-nowrap text-ink ${row.bangla ? "bn text-[16px]" : "ui-fig"}`}>
                      <Readout field={row.field} />
                      {row.unit ? <span className="text-muted"> {row.unit}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <figure className="reveal col-span-12 lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:col-span-5 lg:col-start-8 lg:self-start" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="overflow-hidden rounded-(--radius) bg-surface">
          <Image
            src={plates.src}
            alt="Four brass plates of different shapes on wooden stands, each with sand gathered into a pattern of lines"
            width={plates.width}
            height={plates.height}
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="drift h-auto w-full"
          />
        </div>
        <figcaption className="mt-5">
          <p className="t-body max-w-[46ch] text-ink">
            Every number here is labelled by how it was obtained. Pitch is read off the wave. Formants come from a
            model fitted to it. The sand figure is neither: it is a rule that turns two formants into a picture, in
            the manner of these plates.
          </p>
          <p className="t-small mt-3 text-muted">
            Chladni plates, photographed in 2016. {plates.creator}, {plates.license}.
          </p>
        </figcaption>
      </figure>
    </Reveal>
  );
}
