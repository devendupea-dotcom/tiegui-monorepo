import { redirect } from "next/navigation";

export default async function HqOrgPage(props: { params: Promise<{ orgId: string }> }) {
  const params = await props.params;
  redirect(`/hq/businesses/${params.orgId}`);
}
