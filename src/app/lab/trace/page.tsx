import type { Metadata } from "next";
import { TraceView } from "@/components/lab/TraceView";
import { Footer } from "@/components/site/Footer";

export const metadata: Metadata = {
  title: "Trace one frame",
  description:
    "Hold one 43 ms frame of voice still and step through the eight stages of SPONDON's analysis, from samples to the sand figure, with each stage's input, output and equation.",
};

export default function TracePage() {
  return (
    <>
      <TraceView />
      <Footer />
    </>
  );
}
