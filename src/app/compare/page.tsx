import type { Metadata } from "next";
import { CompareWorkspace } from "@/components/compare/CompareWorkspace";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "Compare takes & files",
  description:
    "Record voice notes, upload audio files locally in your browser, write observation notes, and overlay Reference A against Take B or your live microphone using IndexedDB.",
};

export default function ComparePage() {
  return (
    <>
      <CompareWorkspace />
      <Footer />
    </>
  );
}
