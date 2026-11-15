import type { Metadata, Viewport } from "next";
import { Anek_Bangla, Anek_Latin, Martian_Mono } from "next/font/google";
import { MotionBridge } from "@/components/site/MotionBridge";
import { Navbar } from "@/components/site/Navbar";
import "./globals.css";

// One family across both scripts: Anek was drawn for Bangla and Latin together.
const latin = Anek_Latin({ variable: "--font-latin", subsets: ["latin"], axes: ["wdth"], display: "swap" });
const bangla = Anek_Bangla({ variable: "--font-bangla", subsets: ["bengali"], axes: ["wdth"], display: "swap" });
// The instrument's figures: every live number is set in this face.
const figures = Martian_Mono({ variable: "--font-figures", subsets: ["latin"], axes: ["wdth"], display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

const DESCRIPTION =
  "An acoustic laboratory in a browser tab. SPONDON measures the pitch, formants and vocal-tract poles of a voice, live, and draws each vowel as a Chladni sand figure. Audio never leaves the device.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SPONDON (স্পন্দন): a voice laboratory in the browser",
    template: "%s · SPONDON",
  },
  description: DESCRIPTION,
  applicationName: "SPONDON",
  keywords: [
    "formant analysis",
    "LPC",
    "pitch detection",
    "Z-plane",
    "Chladni figures",
    "vowel chart",
    "Bangla vowels",
    "digital signal processing",
    "Web Audio",
  ],
  openGraph: {
    type: "website",
    siteName: "SPONDON",
    title: "SPONDON: speak a vowel, see its figure",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "SPONDON: speak a vowel, see its figure",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${latin.variable} ${bangla.variable} ${figures.variable}`}>
      <body>
        {/* Entrance animations only hide content once script is known to run. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        <a
          href="#content"
          className="btn fixed left-4 top-2 z-[60] -translate-y-20 focus-visible:translate-y-0"
        >
          Skip to content
        </a>
        <Navbar />
        <MotionBridge />
        {children}
      </body>
    </html>
  );
}
