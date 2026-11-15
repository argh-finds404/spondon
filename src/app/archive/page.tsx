import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PlateStage } from "@/components/instrument/PlateStage";
import { Trace } from "@/components/instrument/Trace";
import { Footer } from "@/components/site/Footer";
import { LoopClip } from "@/components/site/LoopClip";
import { WORLD_ASSETS, worldAsset, type WorldAssetEntry } from "@/lib/world-assets";

export const metadata: Metadata = {
  title: "Archive",
  description:
    "Where SPONDON comes from: Chladni's sand figures of 1787, Helmholtz's resonators, Koenig's vowel apparatus of 1889. With full credits for every picture.",
};

/** Title, date, maker, licence. The date is left out when the title already carries it. */
function credit(asset: WorldAssetEntry): string {
  const year = asset.year.replace(/^c\. /, "");
  return `${asset.title}${asset.title.includes(year) ? "" : `, ${asset.year}`}. ${asset.creator}. ${asset.license}.`;
}

function Picture({ id, alt, sizes, eager }: { id: string; alt: string; sizes: string; eager?: boolean }) {
  const asset = worldAsset(id);
  return (
    <figure>
      <Image
        src={asset.src}
        alt={alt}
        width={asset.width}
        height={asset.height}
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        className="block h-auto w-full rounded-(--radius)"
      />
      <figcaption className="t-small mt-3 text-muted">
        {credit(asset)}
      </figcaption>
    </figure>
  );
}

function Chapter({
  year,
  title,
  takes,
  picture,
  flip,
  children,
}: {
  year: string;
  title: string;
  takes: ReactNode;
  picture: ReactNode;
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="wrap grid12 items-start gap-y-8 py-[calc(var(--section)/2.5)]">
      <div className={`col-span-12 lg:col-span-5 ${flip ? "lg:order-2 lg:col-start-8" : ""}`}>
        <h2 className="t-head">
          <span className="num">{year}.</span> {title}
        </h2>
        <div className="t-body mt-6 flex max-w-[56ch] flex-col gap-4 text-ink">{children}</div>
        <p className="t-body mt-6 max-w-[56ch] rounded-(--radius) bg-surface p-4 text-ink">{takes}</p>
      </div>
      <div className={`col-span-12 lg:col-span-6 ${flip ? "lg:order-1" : "lg:col-start-7"}`}>{picture}</div>
    </section>
  );
}

export default function ArchivePage() {
  const clip = worldAsset("prato-de-chladni-14");
  return (
    <>
      <main id="content" className="pt-(--nav-h)">
        <header className="wrap grid12 gap-y-10 pt-[calc(var(--section)/2)] pb-8">
          <div className="col-span-12 lg:col-span-7">
            <h1 className="t-head">Sound, made visible since 1787.</h1>
            <p className="t-lead mt-6 max-w-[42ch] text-ink">
              SPONDON is three old instruments rebuilt in arithmetic. One showed the shape of a sound, one picked out
              its resonances, one built a vowel from parts.
            </p>
          </div>
        </header>

        <Chapter
          year="1787"
          title="Chladni draws sound in sand"
          picture={
            <div className="grid grid-cols-5 items-start gap-(--gutter)">
              <div className="col-span-2">
                <Picture
                  id="chladni-1787"
                  eager
                  sizes="(min-width: 1024px) 20vw, 40vw"
                  alt="Title page of Ernst Chladni's Entdeckungen über die Theorie des Klanges, in blackletter type, Leipzig 1787"
                />
              </div>
              <div className="col-span-3">
                <Picture
                  id="chladni-plate-04"
                  eager
                  sizes="(min-width: 1024px) 30vw, 60vw"
                  alt="A five-sided brass plate seen from above, clamped at its centre, with red sand gathered into ten lines radiating like a star"
                />
              </div>
            </div>
          }
          takes={
            <>
              <strong className="font-semibold">What SPONDON takes: the figure.</strong> The plate you see in the lab
              is this experiment in arithmetic, with the two formants of a vowel choosing which figure appears.
            </>
          }
        >
          <p>
            Ernst Chladni, a doctor of law in Wittenberg with a taste for acoustics, scattered sand on a plate and
            drew a violin bow down its edge. The plate rang, the sand jumped off the parts that moved and collected
            along the lines that stayed still.
          </p>
          <p>
            Each note the plate could sound left a different figure. He published them in Leipzig in 1787, in{" "}
            <cite>Entdeckungen über die Theorie des Klanges</cite>, discoveries in the theory of sound. It made a
            vibration something you could look at, and draw.
          </p>
        </Chapter>

        <section className="wrap grid12 gap-y-6 py-[calc(var(--section)/3)]">
          <figure className="col-span-12 lg:col-span-7">
            <LoopClip
              src={clip.src}
              poster={clip.poster ?? ""}
              width={clip.width}
              height={clip.height}
              label="Sand on a vibrating six-sided brass plate gathering into curved lines"
              className="block h-auto w-full rounded-(--radius) bg-surface"
            />
            <figcaption className="t-small mt-3 text-muted">
              {credit(clip)}
            </figcaption>
          </figure>
          <figure className="col-span-12 lg:col-span-5">
            <div data-ui className="ui-panel">
              <PlateStage showNodalLines className="aspect-[4/3] w-full" />
            </div>
            <figcaption className="t-small mt-3 text-muted">
              The same thing, computed: SPONDON&rsquo;s plate, driven by the vowel the synthetic voice is making now.
            </figcaption>
          </figure>
        </section>

        <Chapter
          flip
          year="1860s"
          title="Helmholtz hears a voice in parts"
          picture={
            <Picture
              id="helmholtz-resonators-1870"
              sizes="(min-width: 1024px) 50vw, 100vw"
              alt="Eight hollow brass spheres of different sizes on a white surface, each with a narrow neck at the top"
            />
          }
          takes={
            <>
              <strong className="font-semibold">What SPONDON takes: the resonances.</strong> Linear prediction finds
              the same resonances from the signal alone and reports them as F1, F2 and F3.
            </>
          }
        >
          <p>
            Hermann von Helmholtz had hollow brass spheres made, each with a wide mouth and a narrow neck to hold to
            the ear. A sphere answers to one pitch and ignores the rest, so a set of them takes a sound apart, one
            component at a time.
          </p>
          <p>
            With them he showed that vowels differ in which components the mouth strengthens, whatever note is sung.
            Those strengthened regions are what phonetics now calls formants.
          </p>
        </Chapter>

        <section className="wrap grid12 gap-y-6 pb-[calc(var(--section)/3)]">
          <figure className="col-span-12 lg:col-span-7 lg:col-start-6">
            <div data-ui className="ui-panel">
              <Trace
                kind="formants"
                inspect
                label="Linear-prediction envelope of the current frame with its first three peaks marked"
                className="h-[240px] w-full lg:h-[300px]"
              />
            </div>
            <figcaption className="t-small mt-3 text-muted">
              Helmholtz&rsquo;s result, live: the envelope of the synthetic voice, with the three resonances marked.
            </figcaption>
          </figure>
        </section>

        <Chapter
          year="1889"
          title="Koenig builds a vowel"
          picture={
            <div className="mx-auto max-w-[560px]">
              <Picture
                id="koenig-apparatus-1889"
                sizes="(min-width: 1024px) 40vw, 100vw"
                alt="Engraving of a board carrying ten electrically driven tuning forks, each in front of a cylindrical resonator, with a small keyboard at the front edge"
              />
            </div>
          }
          takes={
            <>
              <strong className="font-semibold">What SPONDON takes: the synthetic voice.</strong> A pulse train through
              three resonators. Because its resonances are set, not guessed, it is also how the analyser is tested.
            </>
          }
        >
          <p>
            If a vowel is a recipe of components, it can be cooked. Rudolph Koenig, the Paris instrument maker who
            built much of Helmholtz&rsquo;s apparatus, sold this one: ten tuning forks kept ringing by electromagnets,
            each in front of its own resonator, with keys to open and close them.
          </p>
          <p>
            Mixing the forks in the right proportions gives something close to a sung vowel. This engraving is from
            his price list of 1889.
          </p>
        </Chapter>

        <section className="wrap grid12 gap-y-8 py-[calc(var(--section)/2.5)]">
          <div className="col-span-12 lg:col-span-5">
            <h2 className="t-head">Now, in a tab.</h2>
            <p className="t-body mt-6 max-w-[52ch] text-ink">
              A browser can do all three at once, sixty times a second, with nothing to build and nothing to buy.
            </p>
            <Link href="/lab" className="btn mt-6">
              Open the lab
            </Link>
          </div>
          <figure className="col-span-12 lg:col-span-7">
            <Picture
              id="chladni-plate-10"
              sizes="(min-width: 1024px) 58vw, 100vw"
              alt="Four brass plates of different shapes on turned wooden stands, each with sand gathered into a pattern of lines"
            />
          </figure>
        </section>

        <section id="credits" className="wrap scroll-mt-[calc(var(--nav-h)+24px)] pb-(--section)">
          <h2 className="t-head">Picture credits.</h2>
          <p className="t-body mt-6 max-w-[64ch] text-ink">
            All six are from Wikimedia Commons and are shown whole and unaltered. They are pictures of the history
            around SPONDON; none of them shows SPONDON or anything made by it.
          </p>
          <div className="mt-8 overflow-x-auto">
            <table data-ui className="w-full min-w-[720px] text-left text-[13px]">
              <caption className="sr-only">Credits for the archive pictures</caption>
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="py-2 pr-5 font-normal">Picture</th>
                  <th scope="col" className="py-2 pr-5 font-normal">Date</th>
                  <th scope="col" className="py-2 pr-5 font-normal">By</th>
                  <th scope="col" className="py-2 pr-5 font-normal">Licence</th>
                  <th scope="col" className="py-2 font-normal">Source</th>
                </tr>
              </thead>
              <tbody>
                {WORLD_ASSETS.map((asset) => (
                  <tr key={asset.id} className="border-b border-line align-top text-ink last:border-0">
                    <th scope="row" className="py-2.5 pr-5 font-medium">{asset.title}</th>
                    <td className="ui-fig py-2.5 pr-5 whitespace-nowrap">{asset.year}</td>
                    <td className="py-2.5 pr-5">{asset.creator}</td>
                    <td className="py-2.5 pr-5 whitespace-nowrap">
                      <a href={asset.licenseUrl} rel="license noreferrer" className="link">
                        {asset.license}
                      </a>
                    </td>
                    <td className="py-2.5">
                      <a href={asset.pageUrl} rel="noreferrer" className="link">
                        Wikimedia Commons
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
