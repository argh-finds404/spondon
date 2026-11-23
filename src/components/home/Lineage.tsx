import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { LoopClip } from "@/components/site/LoopClip";
import { Reveal } from "@/components/site/Reveal";
import { worldAsset } from "@/lib/world-assets";

const STILLS = [
  {
    id: "chladni-1787",
    alt: "Title page of Ernst Chladni's Entdeckungen über die Theorie des Klanges, printed in blackletter, Leipzig 1787",
    year: "1787",
    title: "Chladni draws sound in sand",
    line: "Chladni prints the figures sand makes on a bowed plate. SPONDON takes the figure.",
    fit: "object-cover object-top bg-[#e8e1d1]",
  },
  {
    id: "helmholtz-resonators-1870",
    alt: "Eight hollow brass spheres of different sizes, each with a narrow neck: Helmholtz resonators",
    year: "c. 1870",
    title: "Helmholtz isolates the resonances",
    line: "Helmholtz picks single resonances out of a voice with tuned brass spheres. SPONDON takes the resonances.",
    fit: "object-cover bg-white",
  },
  {
    id: "koenig-apparatus-1889",
    alt: "Engraving of Koenig's apparatus: ten electrically driven tuning forks, each in front of a cylindrical resonator, with a small keyboard",
    year: "1889",
    title: "Koenig synthesizes a vowel",
    line: "Koenig builds vowels out of ten tuning forks and resonators. SPONDON takes the synthetic voice.",
    fit: "object-contain bg-[#f5f1e6] p-3",
  },
] as const;

/**
 * Where the instrument comes from: the real moving picture of sand self-organizing on a bowed brass
 * Chladni plate paired with the physical plates and the three historical instruments from the archive.
 */
export function Lineage() {
  const clip = worldAsset("prato-de-chladni-14");
  const plate04 = worldAsset("chladni-plate-04");
  const plate10 = worldAsset("chladni-plate-10");

  return (
    <Reveal as="section" id="lineage" className="section wrap">
      {/* Header */}
      <div className="grid12 items-end gap-y-6">
        <div className="col-span-12 lg:col-span-7">
          <h2 className="t-head reveal">Seeing sound since 1787.</h2>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <p className="t-lead reveal text-ink" style={{ "--i": 1 } as CSSProperties}>
            Nothing here is a new idea. It is three old instruments, rebuilt in arithmetic and put in one browser tab.
          </p>
          <Link
            href="/archive"
            className="link t-small reveal mt-4 inline-block font-medium text-ink"
            style={{ "--i": 2 } as CSSProperties}
          >
            The archive, with picture credits →
          </Link>
        </div>
      </div>

      {/* Row 1: Real Videography + Physical Bowed Brass Plates in a balanced 7/5 equal-height grid */}
      <div className="grid12 mt-10 items-stretch gap-y-(--gutter)">
        <figure
          className="reveal col-span-12 flex flex-col justify-between overflow-hidden rounded-(--radius) border border-line bg-surface lg:col-span-7"
          style={{ "--i": 1 } as CSSProperties}
        >
          <div className="relative aspect-[16/10] w-full flex-1 overflow-hidden bg-bg">
            <LoopClip
              src={clip.src}
              poster={clip.poster ?? ""}
              width={clip.width}
              height={clip.height}
              label="Sand on a vibrating brass plate gathering into a pattern of curved lines"
              className="block h-full w-full object-cover"
            />
          </div>
          <figcaption className="border-t border-line px-5 py-3.5">
            <p className="t-small text-ink">
              <span className="font-semibold">Physical instrument film.</span> Sand finding the still nodal lines of a
              vibrating octagonal brass plate.
            </p>
            <p className="t-small mt-0.5 text-muted">
              {clip.creator}, {clip.license}.
            </p>
          </figcaption>
        </figure>

        <div className="col-span-12 grid grid-cols-1 gap-(--gutter) sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
          <figure
            className="reveal flex flex-col justify-between overflow-hidden rounded-(--radius) border border-line bg-surface"
            style={{ "--i": 2 } as CSSProperties}
          >
            <div className="relative aspect-[16/9] w-full flex-1 overflow-hidden bg-bg">
              <Image
                src={plate04.src}
                alt="A five-sided brass plate seen from above, clamped at its centre, with red sand gathered into ten lines radiating like a star"
                width={plate04.width}
                height={plate04.height}
                sizes="(min-width: 1024px) 38vw, (min-width: 640px) 48vw, 100vw"
                className="block h-full w-full object-cover"
              />
            </div>
            <figcaption className="border-t border-line px-4 py-3">
              <p className="t-small text-ink">
                <span className="font-semibold">{plate04.title}.</span> Red sand gathered along ten radial nodal lines.
              </p>
              <p className="t-small mt-0.5 text-muted">
                {plate04.creator}, {plate04.license}.
              </p>
            </figcaption>
          </figure>

          <figure
            className="reveal flex flex-col justify-between overflow-hidden rounded-(--radius) border border-line bg-surface"
            style={{ "--i": 3 } as CSSProperties}
          >
            <div className="relative aspect-[16/9] w-full flex-1 overflow-hidden bg-bg">
              <Image
                src={plate10.src}
                alt="Four brass plates of different shapes on turned wooden stands, each with sand gathered into a pattern of lines"
                width={plate10.width}
                height={plate10.height}
                sizes="(min-width: 1024px) 38vw, (min-width: 640px) 48vw, 100vw"
                className="block h-full w-full object-cover"
              />
            </div>
            <figcaption className="border-t border-line px-4 py-3">
              <p className="t-small text-ink">
                <span className="font-semibold">{plate10.title}.</span> Four brass plates on turned wooden stands.
              </p>
              <p className="t-small mt-0.5 text-muted">
                {plate10.creator}, {plate10.license}.
              </p>
            </figcaption>
          </figure>
        </div>
      </div>

      {/* Row 2: Uniform 3-Column Equal-Height Grid of the Three Founding Instruments */}
      <ul className="grid12 mt-(--gutter) items-stretch gap-y-(--gutter)">
        {STILLS.map((still, k) => {
          const asset = worldAsset(still.id);
          return (
            <li
              key={still.id}
              className="reveal col-span-12 flex lg:col-span-4"
              style={{ "--i": k + 2 } as CSSProperties}
            >
              <figure className="flex w-full flex-col justify-between overflow-hidden rounded-(--radius) border border-line bg-surface">
                <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-line bg-bg">
                  <Image
                    src={asset.src}
                    alt={still.alt}
                    width={asset.width}
                    height={asset.height}
                    sizes="(min-width: 1024px) 31vw, (min-width: 640px) 50vw, 100vw"
                    className={`block h-full w-full ${still.fit}`}
                  />
                </div>
                <figcaption className="flex flex-1 flex-col justify-between p-5">
                  <div>
                    <span className="ui-fig text-[12px] font-semibold tracking-[0.05em] text-accent uppercase">
                      {still.year}
                    </span>
                    <h3 className="mt-1 text-[19px] leading-snug font-semibold tracking-[-0.015em] text-ink">
                      {still.title}
                    </h3>
                    <p className="t-small mt-2 text-ink/90">{still.line}</p>
                  </div>
                  <p className="t-small mt-4 border-t border-line pt-3 text-muted">
                    {asset.creator}, {asset.license}.
                  </p>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </Reveal>
  );
}
