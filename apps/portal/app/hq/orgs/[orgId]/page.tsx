import { redirect } from "next/navigation";

export default function HqOrgPage({ params }: { params: { orgId: string } }) {
  redirect(`/hq/businesses/${params.orgId}`);
}
