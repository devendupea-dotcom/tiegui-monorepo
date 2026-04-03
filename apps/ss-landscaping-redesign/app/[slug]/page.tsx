import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProspectConceptPage from "../_components/ProspectConceptPage";
import { getProspect, prospects } from "../_data/prospects";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateStaticParams() {
  return prospects.map((prospect) => ({
    slug: prospect.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const prospect = getProspect(slug);

  if (!prospect) {
    return {
      title: "Concept not found | TieGui",
    };
  }

  return {
    title: `${prospect.company} Concept Homepage | TieGui`,
    description: `Concept homepage for ${prospect.company}, rebuilt with stronger offer clarity, conversion flow, and TieGui + Twilio CRM follow-up.`,
    openGraph: {
      title: `${prospect.company} Concept Homepage`,
      description: `A concept redesign for ${prospect.company} showing a stronger homepage, lead path, and automation stack.`,
      url: `/${prospect.slug}`,
      type: "website",
    },
  };
}

export default async function ProspectPage({ params }: PageProps) {
  const { slug } = await params;
  const prospect = getProspect(slug);

  if (!prospect) {
    notFound();
  }

  return <ProspectConceptPage prospect={prospect} />;
}
