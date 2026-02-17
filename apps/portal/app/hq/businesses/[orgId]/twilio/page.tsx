import { redirect } from "next/navigation";

export default function HqBusinessTwilioRedirectPage({ params }: { params: { orgId: string } }) {
  redirect(`/hq/orgs/${params.orgId}/twilio`);
}
