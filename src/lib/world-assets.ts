export interface WorldAssetEntry {
  id: string;
  src: string;
  poster?: string;
  media: "image" | "video";
  title: string;
  year: string;
  creator: string;
  license: string;
  licenseUrl: string;
  creditRequired: boolean;
  pageUrl: string;
  credit: string;
  width: number;
  height: number;
  durationSec?: number;
  instrumentLink: string;
  caption: string;
}

export const WORLD_ASSETS: WorldAssetEntry[] = [
  {
    id: "chladni-plate-04",
    src: "/world/chladni-plate-04.jpg",
    media: "image",
    title: "Chladni plate 04",
    year: "2016",
    creator: "Exhibit by Estes Objethos Atelier; photo by Rodrigo Tetsuo Argenton",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    creditRequired: true,
    pageUrl: "https://commons.wikimedia.org/w/index.php?curid=54267715",
    credit:
      '"Chladni plate 04" by Exhibit made by Estes Objethos Atelier, photo by Rodrigo Tetsuo Argenton, CC BY-SA 4.0, via Wikimedia Commons',
    width: 1920,
    height: 1513,
    instrumentLink: "C(x, y) = cos(nπx) cos(mπy) − cos(mπx) cos(nπy) = 0",
    caption:
      "Driven at resonance around its central clamp, fine sand migrates away from antinodal vibration and settles along zero-displacement nodal lines.",
  },
  {
    id: "prato-de-chladni-14",
    src: "/world/prato-de-chladni-14.webm",
    poster: "/world/prato-de-chladni-14-poster.jpg",
    media: "video",
    title: "Prato de Chladni 14",
    year: "2016",
    creator: "Exhibit by Estes Objethos Atelier; video by Rodrigo Tetsuo Argenton",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    creditRequired: true,
    pageUrl: "https://commons.wikimedia.org/wiki/File:Prato_de_Chladni_14.webm",
    credit:
      '"Prato de Chladni 14" by Exhibit made by Estes Objethos Atelier, video by Rodrigo Tetsuo Argenton, CC BY-SA 4.0, via Wikimedia Commons',
    width: 854,
    height: 480,
    durationSec: 6.1,
    instrumentLink: "Live Particle Nodal Solver (ChladniStage)",
    caption:
      "Real-time sand grain self-organization on a bowed octagonal brass plate; SPONDON maps measured F₁ and F₂ resonances to mode numbers (m, n).",
  },
  {
    id: "chladni-plate-10",
    src: "/world/chladni-plate-10.jpg",
    media: "image",
    title: "Chladni plate 10",
    year: "2016",
    creator: "Exhibit by Estes Objethos Atelier; photo by Rodrigo Tetsuo Argenton",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    creditRequired: true,
    pageUrl: "https://commons.wikimedia.org/wiki/File:Chladni_plate_10.jpg",
    credit:
      '"Chladni plate 10" by Exhibit made by Estes Objethos Atelier, photo by Rodrigo Tetsuo Argenton, CC BY-SA 4.0, via Wikimedia Commons',
    width: 1920,
    height: 1005,
    instrumentLink: "Eigenmode boundary geometry & vowel presets",
    caption:
      "Boundary geometry constrains allowable eigenmodes; in SPONDON, each vowel occupies a distinct (m, n) mode coordinate on a unit plate.",
  },
  {
    id: "chladni-1787",
    src: "/world/chladni-1.jpg",
    media: "image",
    title: "Entdeckungen über die Theorie des Klanges",
    year: "1787",
    creator: "Ernst Florens Friedrich Chladni",
    license: "Public Domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    creditRequired: false,
    pageUrl: "https://commons.wikimedia.org/wiki/File:Chladni-1.jpg",
    credit: '"Chladni-1" by Ernst Chladni, public domain, via Wikimedia Commons',
    width: 1920,
    height: 2701,
    instrumentLink: "src/lib/chladni.ts",
    caption:
      "First systematic treatise rendering acoustic vibration visible via sand figures on glass and brass plates (Leipzig, 1787).",
  },
  {
    id: "helmholtz-resonators-1870",
    src: "/world/a-selection-of-helmholtz-resonators-from-1870.jpg",
    media: "image",
    title: "A selection of Helmholtz resonators from 1870",
    year: "c. 1870",
    creator: "Photo by Stephencdickson (Hunterian Museum, Glasgow)",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    creditRequired: true,
    pageUrl: "https://commons.wikimedia.org/w/index.php?curid=67566287",
    credit:
      '"A selection of Helmholtz resonators from 1870, Hunterian Museum, Glasgow" by Stephencdickson, CC BY-SA 4.0, via Wikimedia Commons',
    width: 1920,
    height: 1278,
    instrumentLink: "F₁, F₂, F₃ LPC Poles & Bandwidths (B = −ln|z|·fs/π)",
    caption:
      "Tuned spherical brass cavities built to isolate individual harmonic resonances of the human voice—the physical counterpart of our LPC Z-plane poles.",
  },
  {
    id: "koenig-apparatus-1889",
    src: "/world/koenig-apparatus-after-helmholtz-ten-resonators-1889.jpg",
    media: "image",
    title: "Koenig apparatus after Helmholtz (ten resonators), 1889",
    year: "1889",
    creator: "Rudolph Koenig",
    license: "Public Domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    creditRequired: false,
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Koenig_apparatus_after_Helmholtz_(ten_resonators),_1889.jpg",
    credit:
      '"Koenig apparatus after Helmholtz (ten resonators), 1889" by Rudolph Koenig, public domain, via Wikimedia Commons',
    width: 1250,
    height: 1230,
    instrumentLink: "src/lib/dsp/synth.ts (Source-filter voice loop)",
    caption:
      "Electromagnetically driven tuning forks coupled to ten keyboard-gated resonators for synthesizing vowel timbres—analog ancestor of SPONDON's source-filter synthesizer.",
  },
];

export function worldAsset(id: string): WorldAssetEntry {
  const asset = WORLD_ASSETS.find((a) => a.id === id);
  if (!asset) throw new Error(`Unknown archive picture: ${id}`);
  return asset;
}
