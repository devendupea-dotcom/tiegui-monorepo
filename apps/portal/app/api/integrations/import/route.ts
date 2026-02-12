import type { IntegrationProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { runProviderImport } from "@/lib/integrations/import";
import { IntegrationScopeError, resolveIntegrationOrgScope } from "@/lib/integrations/scope";

export const dynamic = "force-dynamic";

type ImportPayload = {
  provider?: string;
  dateFrom?: string;
  dateTo?: string;
};

function parseDateInput(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function parseProvider(value: unknown): IntegrationProvider | "ALL" {
  if (value === "JOBBER" || value === "QBO" || value === "ALL") {
    return value;
  }
  throw new IntegrationScopeError("Invalid provider. Expected JOBBER, QBO, or ALL.", 400);
}

export async function POST(req: Request) {
  try {
    const scope = await resolveIntegrationOrgScope(req);
    const payload = (await req.json().catch(() => ({}))) as ImportPayload;

    const provider = parseProvider(payload.provider);
    const dateFrom = parseDateInput(payload.dateFrom);
    const dateTo = parseDateInput(payload.dateTo);

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new IntegrationScopeError("dateFrom must be before dateTo.", 400);
    }

    const providers: IntegrationProvider[] = provider === "ALL" ? ["JOBBER", "QBO"] : [provider];
    const results: Array<Record<string, unknown>> = [];

    for (const item of providers) {
      try {
        const outcome = await runProviderImport({
          orgId: scope.orgId,
          provider: item,
          dateFrom,
          dateTo,
        });

        results.push({
          provider: item,
          ok: true,
          runId: outcome.runId,
          stats: outcome.stats,
        });
      } catch (error) {
        results.push({
          provider: item,
          ok: false,
          error: error instanceof Error ? error.message : "Import failed.",
        });
      }
    }

    const hasFailure = results.some((item) => item.ok === false);

    return NextResponse.json(
      {
        ok: !hasFailure,
        orgId: scope.orgId,
        results,
      },
      { status: hasFailure ? 207 : 200 },
    );
  } catch (error) {
    if (error instanceof IntegrationScopeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    return NextResponse.json({ ok: false, error: "Import request failed." }, { status: 500 });
  }
}
