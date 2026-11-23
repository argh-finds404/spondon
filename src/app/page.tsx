import { Closing, PrivacyClaim } from "@/components/home/Closing";
import { Explore } from "@/components/home/Explore";
import { Hero } from "@/components/home/Hero";
import { InstrumentRail } from "@/components/home/InstrumentRail";
import { Lineage } from "@/components/home/Lineage";
import { MeasuredList } from "@/components/home/MeasuredList";
import { SignalChain } from "@/components/home/SignalChain";
import { Footer } from "@/components/site/Footer";

export default function HomePage() {
  return (
    <>
      <main id="content">
        <Hero />
        <InstrumentRail />
        <SignalChain />
        <MeasuredList />
        <Lineage />
        <Explore />
        <PrivacyClaim />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
