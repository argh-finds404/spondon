import type { Metadata } from "next";
import Link from "next/link";
import { Eq } from "@/components/docs/math";
import { EXPERIMENTS } from "@/components/experiments/experiments";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "Experiments",
  description:
    "Five experiments that each break one stage of SPONDON's analysis (the window, pre-emphasis, the model order, the pitch, a pole) and measure what changes against the normal setting.",
};

export default function ExperimentsPage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h) pb-(--section)">
        <header className="wrap grid12 items-end gap-y-6 pt-[calc(var(--section)/2)] pb-12">
          <h1 className="t-head col-span-12 lg:col-span-7">Break one stage. See what changes.</h1>
          <div className="col-span-12 lg:col-span-5">
            <p className="t-lead text-ink">
              Five experiments, each with one control. The normal result stays on the plot as a dashed line, and the
              numbers say how far you moved from it.
            </p>
            <p className="t-small mt-4 text-muted">
              Leaving an experiment puts its setting back. To see every stage of one frame instead, use{" "}
              <Link href="/lab/trace" className="link text-ink">
                trace a frame
              </Link>
              .
            </p>
          </div>
        </header>

        <ol className="wrap flex flex-col gap-3">
          {EXPERIMENTS.map((exp) => (
            <li key={exp.id}>
              <Link
                href={`/experiments/${exp.id}`}
                className="grid12 group items-center gap-y-4 rounded-(--radius) bg-surface p-6 transition-colors duration-200 hover:bg-raised lg:p-8"
              >
                <span className="col-span-12 flex items-baseline gap-4 lg:col-span-5">
                  <span className="ui-fig text-[clamp(2.5rem,4vw,3.5rem)] leading-none text-accent">{exp.id}</span>
                  <span>
                    <span className="block text-[15px] font-semibold text-muted">{exp.stage}</span>
                    <span className="mt-1 block text-[clamp(1.4rem,2.2vw,2rem)] leading-[1.15] font-[600] tracking-[-0.02em] text-ink">
                      {exp.title}
                    </span>
                  </span>
                </span>
                <div className="col-span-12 flex flex-col gap-4 lg:col-span-7">
                  <p className="t-body text-ink">{exp.task}</p>
                  <Eq ml={exp.formula.ml} label={exp.formula.label} />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </main>
      <Footer />
    </>
  );
}
