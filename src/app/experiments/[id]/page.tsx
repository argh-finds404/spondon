import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EXPERIMENTS, findExperiment } from "@/components/experiments/experiments";
import { ExperimentView } from "@/components/experiments/ExperimentView";
import { Footer } from "@/components/site/Footer";

export function generateStaticParams() {
  return EXPERIMENTS.map((e) => ({ id: String(e.id) }));
}

export async function generateMetadata({ params }: PageProps<"/experiments/[id]">): Promise<Metadata> {
  const exp = findExperiment(Number((await params).id));
  if (!exp) return { title: "Experiment not found" };
  return {
    title: `${exp.title} · Experiment ${exp.id}`,
    description: `${exp.task} ${exp.watch}`,
  };
}

export default async function ExperimentPage({ params }: PageProps<"/experiments/[id]">) {
  const exp = findExperiment(Number((await params).id));
  // Unknown ids are rendered on request under Cache Components, so they are turned away here.
  if (!exp) notFound();
  return (
    <>
      <ExperimentView id={exp.id} />
      <Footer />
    </>
  );
}
