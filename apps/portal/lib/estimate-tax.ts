import "server-only";

import { AppApiError } from "@/lib/app-api-permissions";

const WA_DOR_ADDRESS_RATES_URL = "https://webgis.dor.wa.gov/webapi/AddressRates.aspx";
const ZIP_CODE_PATTERN = /\b\d{5}(?:-\d{4})?\b/;
const XML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

export type EstimateTaxLookupResult = {
  taxRateSource: "WA_DOR";
  taxRatePercent: string;
  taxZipCode: string;
  taxJurisdiction: string;
  taxLocationCode: string;
  taxCalculatedAt: string;
  sourceLabel: string;
  period: string | null;
};

function decodeXmlAttribute(value: string | null): string {
  if (!value) return "";
  return value.replace(/&(amp|quot|apos|lt|gt);/g, (match) => XML_ENTITY_MAP[match] || match);
}

function readXmlAttribute(attributes: string | undefined, name: string): string | null {
  if (!attributes) return null;
  const pattern = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i");
  return attributes.match(pattern)?.[1] || null;
}

function normalizeZipCode(value: string): string {
  return value.trim().slice(0, 5);
}

function extractExplicitState(siteAddress: string): string | null {
  const upper = siteAddress.toUpperCase();
  if (/\bWASHINGTON\b/.test(upper)) return "WA";

  const match = upper.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  if (!match) return null;
  return match[1] || null;
}

export function extractEstimateZipCode(siteAddress: string | null | undefined): string | null {
  if (!siteAddress) return null;
  const match = siteAddress.match(ZIP_CODE_PATTERN);
  return match ? normalizeZipCode(match[0]) : null;
}

function buildWaLookupAddress(siteAddress: string) {
  const zipCode = extractEstimateZipCode(siteAddress);
  if (!zipCode) {
    throw new AppApiError("Enter a site address with a ZIP code to auto-fill tax.", 400);
  }

  const explicitState = extractExplicitState(siteAddress);
  if (explicitState && explicitState !== "WA") {
    throw new AppApiError(
      "Auto tax lookup is currently built in for Washington job ZIP codes. Enter a manual rate for other states.",
      400,
    );
  }

  const withoutZip = siteAddress
    .replace(ZIP_CODE_PATTERN, "")
    .replace(/\bWASHINGTON\b/gi, "")
    .replace(/\bWA\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .trim()
    .replace(/,\s*$/, "");

  const parts = withoutZip
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    zipCode,
    street: parts[0] || withoutZip || "",
    city: parts.length > 1 ? (parts[1] ?? "") : "",
  };
}

function normalizeRatePercent(value: string): string {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("Tax lookup returned an invalid rate.");
  }
  return (numeric * 100).toFixed(2);
}

export async function lookupEstimateTaxRate(input: {
  siteAddress: string;
}): Promise<EstimateTaxLookupResult> {
  const lookup = buildWaLookupAddress(input.siteAddress);
  const url = new URL(WA_DOR_ADDRESS_RATES_URL);
  url.searchParams.set("output", "xml");
  url.searchParams.set("addr", lookup.street);
  url.searchParams.set("city", lookup.city);
  url.searchParams.set("zip", lookup.zipCode);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Washington tax lookup timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Washington tax lookup failed with status ${response.status}.`);
  }

  const xml = await response.text();
  const responseAttributes = xml.match(/<response\b([^>]*)>/i)?.[1];
  const addressLineAttributes = xml.match(/<addressline\b([^>]*)\/?>/i)?.[1];
  const rateAttributes = xml.match(/<rate\b([^>]*)\/?>/i)?.[1];

  const locationCode = readXmlAttribute(responseAttributes, "loccode");
  const rawRate = readXmlAttribute(responseAttributes, "rate");
  const resultCode = readXmlAttribute(responseAttributes, "code");
  const jurisdiction = decodeXmlAttribute(readXmlAttribute(rateAttributes, "name"));
  const zipCode = normalizeZipCode(readXmlAttribute(addressLineAttributes, "zip") || lookup.zipCode);
  const period = readXmlAttribute(addressLineAttributes, "period");

  if (!locationCode || !rawRate || resultCode === "6") {
    throw new AppApiError(
      "No Washington tax rate was found for that job ZIP code. Double-check the address or enter a manual rate.",
      404,
    );
  }

  return {
    taxRateSource: "WA_DOR",
    taxRatePercent: normalizeRatePercent(rawRate),
    taxZipCode: zipCode,
    taxJurisdiction: jurisdiction,
    taxLocationCode: locationCode,
    taxCalculatedAt: new Date().toISOString(),
    sourceLabel: "Washington Department of Revenue",
    period,
  };
}
