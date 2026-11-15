import { Closing, PrivacyClaim } from "@/components/home/Closing";
import { Hero } from "@/components/home/Hero";
import { InstrumentRail } from "@/components/home/InstrumentRail";
import { Lineage } from "@/components/home/Lineage";
import { MeasuredList } from "@/components/home/MeasuredList";
import { SignalChain } from "@/components/home/SignalChain";
import { Switches } from "@/components/home/Switches";
import { VowelInstrument } from "@/components/home/VowelInstrument";
import { Footer } from "@/components/site/Footer";

export default function HomePage() {
  return (
    <>
      <main id="content">
        <Hero />
        <InstrumentRail />
        <SignalChain />
        <VowelInstrument />
        <MeasuredList />
        <Switches />
        <PrivacyClaim />
        <Lineage />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
