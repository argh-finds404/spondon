import type { Metadata } from "next";
import { Lab } from "@/components/lab/Lab";

export const metadata: Metadata = {
  title: "Laboratory",
  description:
    "The SPONDON instrument: live pitch, formants, Z-plane poles, the vowel chart and the Chladni figure, from a synthetic voice or your microphone. Nothing leaves the tab.",
};

export default function LabPage() {
  return <Lab />;
}
