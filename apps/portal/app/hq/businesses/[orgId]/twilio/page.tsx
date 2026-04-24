import { redirect } from "next/navigation";

export default async function HqBusinessTwilioRedirectPage(props: { params: Promise<{ orgId: string }> }) {
  const params = await props.params;
  redirect(`/hq/orgs/${params.orgId}/twilio`);
}
