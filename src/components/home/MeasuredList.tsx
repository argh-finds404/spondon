import { Prov, type Provenance } from "@/components/instrument/controls";
import { Readout, type ReadoutField } from "@/components/instrument/Readout";
import { Reveal } from "@/components/site/Reveal";

const GROUPS: {
  word: string;
  kind: Provenance;
  note: string;
  rows: { name: string; field: ReadoutField; unit?: string; bangla?: boolean }[];
}[] = [
  {
    word: "Measured",
    kind: "measured",
    note: "Read straight off the wave.",
    rows: [
      { name: "Pitch, F0", field: "f0", unit: "Hz" },
      { name: "Jitter, cycle to cycle", field: "jitter", unit: "%" },
      { name: "Shimmer", field: "shimmer", unit: "dB" },
      { name: "Level", field: "level", unit: "dB FS" },
      { name: "Syllable rate", field: "syllables", unit: "per s" },
    ],
  },
  {
    word: "Derived",
    kind: "derived",
    note: "From a model fitted to the wave.",
    rows: [
      { name: "First formant, F1", field: "f1", unit: "Hz" },
      { name: "Second formant, F2", field: "f2", unit: "Hz" },
      { name: "Third formant, F3", field: "f3", unit: "Hz" },
      { name: "Pole radius of F1", field: "poleRadius" },
      { name: "Nearest vowel", field: "vowel", bangla: true },
    ],
  },
  {
    word: "Drawn",
    kind: "mapped",
    note: "A rule that turns numbers into a picture.",
    rows: [
      { name: "Plate mode m, from F1", field: "modeM" },
      { name: "Plate mode n, from F2", field: "modeN" },
      { name: "Distance to the target", field: "bark", unit: "Bark" },
      { name: "Match", field: "score", unit: "of 100" },
    ],
  },
];

/** Three columns across one loud field: what the instrument reports, by how far each number is from the signal. */
export function MeasuredList() {
  return (
    <Reveal as="section" id="honest" className="on-accent bg-accent py-[calc(var(--section)/2)] text-accent-ink">
      <div className="wrap grid12 items-end gap-y-6">
        <h2 className="t-head reveal col-span-12 lg:col-span-7">Measured, derived, or drawn.</h2>
        <div className="col-span-12 lg:col-span-5">
          <p className="t-lead reveal max-w-[40ch]" style={{ "--i": 1 } as React.CSSProperties}>
            Every number on this site says how it was obtained. The sand figure is the only one that is a picture, and
            it says so.
          </p>
        </div>
      </div>
      <div className="wrap mt-10 lg:mt-14">
        <div data-ui className="grid gap-x-(--gutter) gap-y-5 md:grid-cols-3">
          {GROUPS.map((group, k) => (
            <div key={group.word} className="reveal rounded-(--radius) bg-accent-ink p-5 text-[#f7f4ec]" style={{ "--i": k + 1 } as React.CSSProperties}>
              <h3 className="flex items-center gap-2.5 text-[20px] font-semibold">
                <Prov kind={group.kind}>{group.word}</Prov>
              </h3>
              <p className="mt-1 text-[14px] opacity-70">{group.note}</p>
              <ul className="mt-4">
                {group.rows.map((row) => (
                  <li key={row.field} className="flex min-h-10 items-center justify-between gap-4">
                    <span className="text-[15px]">{row.name}</span>
                    <span className={`text-[14px] whitespace-nowrap ${row.bangla ? "bn text-[18px] leading-none" : "ui-fig"}`}>
                      <Readout field={row.field} />
                      {row.unit ? <span className="opacity-60"> {row.unit}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
