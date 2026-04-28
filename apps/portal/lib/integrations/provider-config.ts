import { normalizeEnvValue } from "@/lib/env";

export type IntegrationProviderConfiguration = {
  jobberConfigured: boolean;
  qboConfigured: boolean;
  stripeConfigured: boolean;
  googleConfigured: boolean;
  outlookConfigured: boolean;
  jobberMissingKeys: string[];
  qboMissingKeys: string[];
  stripeMissingKeys: string[];
  googleMissingKeys: string[];
  outlookMissingKeys: string[];
};

const JOBBER_REQUIRED_ENV_KEYS = ["JOBBER_CLIENT_ID", "JOBBER_CLIENT_SECRET"] as const;
const QBO_REQUIRED_ENV_KEYS = ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"] as const;
const STRIPE_REQUIRED_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
const GOOGLE_REQUIRED_ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const OUTLOOK_REQUIRED_ENV_KEYS = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID"] as const;

function hasEnv(key: string): boolean {
  return Boolean(normalizeEnvValue(process.env[key]));
}

function getMissingKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => !hasEnv(key));
}

export function isJobberConfigured(): boolean {
  return getMissingKeys(JOBBER_REQUIRED_ENV_KEYS).length === 0;
}

export function isQboConfigured(): boolean {
  return getMissingKeys(QBO_REQUIRED_ENV_KEYS).length === 0;
}

export function isStripeConfigured(): boolean {
  return getMissingKeys(STRIPE_REQUIRED_ENV_KEYS).length === 0;
}

export function isGoogleConfigured(): boolean {
  return getMissingKeys(GOOGLE_REQUIRED_ENV_KEYS).length === 0;
}

export function isOutlookConfigured(): boolean {
  return getMissingKeys(OUTLOOK_REQUIRED_ENV_KEYS).length === 0;
}

export function getIntegrationProviderConfiguration(): IntegrationProviderConfiguration {
  const jobberMissingKeys = getMissingKeys(JOBBER_REQUIRED_ENV_KEYS);
  const qboMissingKeys = getMissingKeys(QBO_REQUIRED_ENV_KEYS);
  const stripeMissingKeys = getMissingKeys(STRIPE_REQUIRED_ENV_KEYS);
  const googleMissingKeys = getMissingKeys(GOOGLE_REQUIRED_ENV_KEYS);
  const outlookMissingKeys = getMissingKeys(OUTLOOK_REQUIRED_ENV_KEYS);

  return {
    jobberConfigured: jobberMissingKeys.length === 0,
    qboConfigured: qboMissingKeys.length === 0,
    stripeConfigured: stripeMissingKeys.length === 0,
    googleConfigured: googleMissingKeys.length === 0,
    outlookConfigured: outlookMissingKeys.length === 0,
    jobberMissingKeys,
    qboMissingKeys,
    stripeMissingKeys,
    googleMissingKeys,
    outlookMissingKeys,
  };
}
