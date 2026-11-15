import Link from "next/link";
import { Prov } from "@/components/instrument/controls";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Readout } from "@/components/instrument/Readout";
import { Trace } from "@/components/instrument/Trace";

/**
 * Sentence split by a frame. The frame is the instrument itself, running on the built-in
 * synthetic voice, and it belongs to a strip of instruments passing through the sentence:
 * the spectrum leaves at the top edge, the vowel chart arrives at the bottom.
 */
export function Hero() {
  return (
    <section className="wrap relative overflow-hidden pt-(--nav-h) lg:h-svh lg:min-h-[680px]">
      <div className="grid h-full grid-cols-1 items-center gap-x-6 pt-5 lg:grid-cols-[1fr_min(33vw,60svh)_1fr] lg:pt-0">
        <h1 className="contents text-[9vw] leading-none font-[560] tracking-[-0.03em] [font-stretch:106%] lg:text-[clamp(2.125rem,3.4vw,3.75rem)]">
          <span className="whitespace-nowrap lg:col-start-1 lg:row-start-1">Speak a vowel.</span>{" "}
          <span className="order-3 justify-self-end whitespace-nowrap lg:order-none lg:col-start-3 lg:row-start-1">
            See its figure.
          </span>
        </h1>

        <div className="order-2 flex flex-col justify-center gap-3 py-3 lg:order-none lg:col-start-2 lg:row-start-1 lg:h-full lg:gap-6 lg:py-0">
          <div aria-hidden className="flex h-7 flex-none items-end overflow-hidden lg:h-[30svh]">
            <div data-ui className="ui-panel h-[220px] w-full flex-none">
              <Trace kind="spectrum" bare label="" className="h-full w-full" />
            </div>
          </div>

          <div data-ui className="ui-panel flex-none">
            <PlateStage className="aspect-square w-full" />
            <dl className="grid grid-cols-4 border-t border-line">
              <div className="px-2 py-2.5 sm:px-3">
                <dt className="ui-label">
                  <Prov kind="measured">F0</Prov>
                </dt>
                <dd className="ui-fig mt-0.5 text-[12px] whitespace-nowrap text-ink sm:text-[13px]">
                  <Readout field="f0" /> Hz
                </dd>
              </div>
              <div className="px-2 py-2.5 sm:px-3">
                <dt className="ui-label">
                  <Prov kind="derived">F1</Prov>
                </dt>
                <dd className="ui-fig mt-0.5 text-[12px] whitespace-nowrap text-ink sm:text-[13px]">
                  <Readout field="f1" /> Hz
                </dd>
              </div>
              <div className="px-2 py-2.5 sm:px-3">
                <dt className="ui-label">
                  <Prov kind="derived">F2</Prov>
                </dt>
                <dd className="ui-fig mt-0.5 text-[12px] whitespace-nowrap text-ink sm:text-[13px]">
                  <Readout field="f2" /> Hz
                </dd>
              </div>
              <div className="px-2 py-2.5 sm:px-3">
                <dt className="ui-label">
                  <Prov kind="mapped">Vowel</Prov>
                </dt>
                <dd lang="bn" className="bn mt-0.5 text-[15px] leading-[18px] text-ink">
                  <Readout field="vowel" />
                </dd>
              </div>
            </dl>
          </div>

          <div aria-hidden className="flex h-7 flex-none items-start overflow-hidden lg:h-[30svh]">
            <div data-ui className="ui-panel h-[220px] w-full flex-none">
              <Trace kind="vowel" bare label="" className="h-full w-full" />
            </div>
          </div>
        </div>

        {/* Directly under each half of the sentence: what it is and what to do, then what you are looking at. */}
        <div className="order-4 pt-4 pb-10 lg:relative lg:top-1/2 lg:order-none lg:col-start-1 lg:row-start-1 lg:mt-[calc(clamp(2.125rem,3.4vw,3.75rem)/2+2.25rem)] lg:max-w-[25rem] lg:self-start lg:p-0">
          <p className="t-body text-ink">
            An acoustic laboratory in a browser tab. It measures the pitch, formants and poles of a voice, live, and
            draws each vowel as a Chladni sand figure.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/lab" className="btn">
              Open the lab
            </Link>
            <Link href="/method" className="link t-small font-medium">
              How it works
            </Link>
          </div>
        </div>

        <p className="t-small hidden text-muted lg:relative lg:top-1/2 lg:col-start-3 lg:row-start-1 lg:mt-[calc(clamp(2.125rem,3.4vw,3.75rem)/2+2.25rem)] lg:block lg:max-w-[21rem] lg:self-start lg:justify-self-end lg:text-right">
          What you see is a built-in synthetic voice touring eight vowels. No microphone, no sound, until you ask.
        </p>
      </div>
    </section>
  );
}
