import type { IntegrationProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { disconnectIntegrationAccount } from "@/lib/integrations/account-store";
import { IntegrationScopeError, resolveIntegrationOrgScope } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

function parseProvider(value: unknown): IntegrationProvider {
  if (value === "JOBBER" || value === "QBO") {
    return value;
  }
  throw new IntegrationScopeError("Invalid provider. Expected JOBBER or QBO.", 400);
}

export async function POST(req: Request) {
  try {
    const scope = await resolveIntegrationOrgScope(req);
    const payload = (await req.json().catch(() => ({}))) as { provider?: string };
    const provider = parseProvider(payload.provider);

    await disconnectIntegrationAccount({
      orgId: scope.orgId,
      provider,
    });

    return NextResponse.json({
      ok: true,
      orgId: scope.orgId,
      provider,
    });
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Failed to disconnect integration." }, { status: 500 });
  }
}
