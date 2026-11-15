import Image from "next/image";
import Link from "next/link";
import { LoopClip } from "@/components/site/LoopClip";
import { Reveal } from "@/components/site/Reveal";
import { worldAsset } from "@/lib/world-assets";

const STILLS = [
  {
    id: "chladni-1787",
    alt: "Title page of Ernst Chladni's Entdeckungen über die Theorie des Klanges, printed in blackletter, Leipzig 1787",
    year: "1787",
    line: "Chladni prints the figures sand makes on a bowed plate. SPONDON takes the figure.",
  },
  {
    id: "helmholtz-resonators-1870",
    alt: "Eight hollow brass spheres of different sizes, each with a narrow neck: Helmholtz resonators",
    year: "c. 1870",
    line: "Helmholtz picks single resonances out of a voice with tuned brass spheres. SPONDON takes the resonances.",
  },
  {
    id: "koenig-apparatus-1889",
    alt: "Engraving of Koenig's apparatus: ten electrically driven tuning forks, each in front of a cylindrical resonator, with a small keyboard",
    year: "1889",
    line: "Koenig builds vowels out of ten tuning forks and resonators. SPONDON takes the synthetic voice.",
  },
] as const;

/** Where the instrument comes from: three objects from the archive and one moving picture of the thing itself. */
export function Lineage() {
  const clip = worldAsset("prato-de-chladni-14");
  return (
    <Reveal as="section" id="lineage" className="section wrap grid12 gap-y-10">
      <div className="col-span-12 lg:sticky lg:top-[calc(var(--nav-h)+24px)] lg:col-span-4 lg:self-start">
        <h2 className="t-head reveal">Seeing sound since 1787.</h2>
        <p className="t-lead reveal mt-6 max-w-[30ch] text-ink" style={{ "--i": 1 } as React.CSSProperties}>
          Nothing here is a new idea. It is three old instruments, rebuilt in arithmetic and put in one browser tab.
        </p>
        <Link href="/archive" className="link t-small reveal mt-6 inline-block font-medium" style={{ "--i": 2 } as React.CSSProperties}>
          The archive, with picture credits
        </Link>
      </div>

      <div className="col-span-12 lg:col-span-8">
        <figure className="reveal" style={{ "--i": 1 } as React.CSSProperties}>
          <LoopClip
            src={clip.src}
            poster={clip.poster ?? ""}
            width={clip.width}
            height={clip.height}
            label="Sand on a vibrating brass plate gathering into a pattern of curved lines"
            className="block h-auto w-full rounded-(--radius) bg-surface"
          />
          <figcaption className="t-small mt-3 text-muted">
            Sand finding the still lines of a vibrating brass plate. {clip.creator}, {clip.license}.
          </figcaption>
        </figure>

        <ul className="mt-10 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-(--gutter)">
          {STILLS.map((still, k) => {
            const asset = worldAsset(still.id);
            return (
              <li
                key={still.id}
                className="reveal min-w-0"
                // Flex in proportion to each picture's shape, so all three stand at one height, uncropped.
                style={{ flex: asset.width / asset.height, "--i": k + 2 } as React.CSSProperties}
              >
                <figure>
                  <Image
                    src={asset.src}
                    alt={still.alt}
                    width={asset.width}
                    height={asset.height}
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
                    className="block h-auto w-full rounded-(--radius)"
                  />
                  <figcaption className="mt-3">
                    <p className="t-small text-ink">
                      <span className="font-semibold">{still.year}.</span> {still.line}
                    </p>
                    <p className="t-small mt-1 text-muted">
                      {asset.creator}, {asset.license}.
                    </p>
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
      </div>
    </Reveal>
  );
}
