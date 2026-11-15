import type { Metadata } from "next";
import Link from "next/link";
import { Trace } from "@/components/instrument/Trace";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <>
      <main id="content" className="wrap grid12 min-h-[72svh] items-center gap-y-10 pt-[calc(var(--nav-h)+48px)] pb-16">
        <div className="col-span-12 lg:col-span-6">
          <h1 className="t-head">No signal at this address.</h1>
          <p className="t-lead mt-6 max-w-[36ch] text-ink">
            The page you asked for does not exist, or has moved. The instrument is still running.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/lab" className="btn">
              Open the lab
            </Link>
            <Link href="/" className="link t-small font-medium">
              Back to the start
            </Link>
          </div>
        </div>
        <div data-ui className="ui-panel col-span-12 lg:col-span-5 lg:col-start-8">
          <Trace kind="voice" bare label="Waveform of the synthetic voice, still running" className="h-[220px] w-full" />
        </div>
      </main>
      <Footer />
    </>
  );
}
