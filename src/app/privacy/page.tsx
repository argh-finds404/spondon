import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HostsMeter } from "@/components/docs/HostsMeter";
import { SourceSwitch } from "@/components/instrument/controls";
import { Footer, REPO_URL } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "SPONDON analyses audio in the browser tab where it is captured. Nothing you say is recorded, uploaded or stored. This page shows every host the tab has contacted.",
};

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid12 gap-y-3 py-9">
      <h2 className="t-lead col-span-12 font-semibold text-ink lg:col-span-4">{title}</h2>
      <div className="t-body col-span-12 flex max-w-[64ch] flex-col gap-4 text-ink lg:col-span-7 lg:col-start-6">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 gap-y-10 pt-[calc(var(--section)/2)] pb-10">
          <div className="col-span-12 lg:col-span-6">
            <h1 className="t-head">Your voice stays in this tab.</h1>
            <p className="t-lead mt-6 max-w-[38ch] text-ink">
              SPONDON analyses sound where it is captured: in your browser, on your device. Nothing you say is
              recorded, uploaded or stored.
            </p>
            <p className="t-body mt-5 max-w-[54ch] text-ink">
              You do not have to take that on trust. The panel beside this is the browser&rsquo;s own log of every
              request this tab has made. Switch the microphone on, speak, and watch it not change.
            </p>
            <div data-ui className="mt-6">
              <SourceSwitch />
            </div>
          </div>
          <div className="col-span-12 lg:col-span-5 lg:col-start-8">
            <HostsMeter />
          </div>
        </header>

        <div className="wrap pb-(--section)">
          <Item title="The microphone">
            <p>
              The browser asks for the microphone only when you choose it as the source. Until then the instrument
              runs on a synthetic voice that is computed in the tab.
            </p>
            <p>
              Samples go from the browser&rsquo;s audio system into the analyser&rsquo;s memory. Each frame reads the
              newest sixth of a second and the next frame overwrites it. The samples are never written to disk and
              never put in a request. Choosing another source, or closing the tab, releases the microphone.
            </p>
            <p>
              The browser&rsquo;s echo cancellation, noise suppression and automatic gain are switched off, because
              they would reshape the resonances being measured. Your microphone is never played back through the
              speakers.
            </p>
          </Item>

          <Item title="What the site keeps">
            <p>
              Nothing. There are no accounts, no cookies, no analytics and no advertising. Your settings live in the
              page&rsquo;s memory and are gone when you close it. The typefaces and pictures are served from this
              site, not from a third party.
            </p>
            <p>
              The host that serves these pages keeps ordinary access logs, as any web server does: the address a
              request came from, the page asked for, the time. Those logs never contain audio, because the pages
              never send any.
            </p>
          </Item>

          <Item title="The one exception, and it is yours to make">
            <p>
              The <Link href="/developers" className="link">HTTP API</Link> has an endpoint that analyses a recording.
              If you send a file to it, that file reaches the server. It is decoded in memory, measured, and discarded
              with the request; the application does not store or log it.
            </p>
            <p>
              The lab never calls that endpoint. The vowel atlas and the API page fetch short synthetic vowels from the
              server, which are generated sounds and contain nothing of yours.
            </p>
          </Item>

          <Item title="Not a medical device">
            <p>
              SPONDON is an educational instrument for looking at speech. It gives no diagnosis, and its jitter and
              shimmer readings run high compared with clinical tools. If you have a concern about your voice, see a
              speech and language therapist or a doctor.
            </p>
          </Item>

          <Item title="Check the source">
            <p>
              Everything said here can be read in the code. The audio path is one file,{" "}
              <a href={`${REPO_URL}/blob/main/src/lib/dsp/audio-controller.ts`} rel="noreferrer" className="link">
                audio-controller.ts
              </a>
              : the microphone stream is connected to an analyser node and to nothing else.
            </p>
          </Item>
        </div>
      </main>
      <Footer />
    </>
  );
}
