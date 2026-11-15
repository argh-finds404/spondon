import type { Metadata } from "next";
import Link from "next/link";
import { Classroom } from "@/components/docs/Classroom";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "Classroom",
  description:
    "Seven short units for a first signals course, each with a live test signal: sampling, Fourier series, windows and leakage, the spectrogram, autocorrelation pitch, linear prediction and the z-plane.",
};

export default function ClassroomPage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 items-end gap-y-6 pt-[calc(var(--section)/2)] pb-12">
          <h1 className="t-head col-span-12 lg:col-span-7">A signals course you can run.</h1>
          <div className="col-span-12 lg:col-span-5">
            <p className="t-lead text-ink">
              Seven short units, from sampling to the z-plane. Each one loads a signal whose answer is known, asks one
              question, and keeps its answer folded until you want it.
            </p>
            <p className="t-small mt-4 text-muted">
              For a lecture, a lab session or revision. The equations behind each unit are on the{" "}
              <Link href="/method" className="link text-ink">
                method page
              </Link>
              .
            </p>
          </div>
        </header>
        <Classroom />
      </main>
      <Footer />
    </>
  );
}
