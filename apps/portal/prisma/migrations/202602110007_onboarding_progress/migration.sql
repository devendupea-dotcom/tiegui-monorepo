-- Organization onboarding progress state.
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "onboardingSkippedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Organization_onboardingCompletedAt_idx"
  ON "Organization"("onboardingCompletedAt");
