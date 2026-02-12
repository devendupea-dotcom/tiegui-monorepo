-- Optional worker phone storage for onboarding + dispatch actions.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phoneE164" TEXT;

CREATE INDEX IF NOT EXISTS "User_orgId_phoneE164_idx"
  ON "User"("orgId", "phoneE164");
