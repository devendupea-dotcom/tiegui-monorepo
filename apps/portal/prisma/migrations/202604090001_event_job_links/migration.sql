ALTER TABLE "Event"
ADD COLUMN "jobId" TEXT;

CREATE INDEX "Event_jobId_startAt_idx"
ON "Event"("jobId", "startAt");

ALTER TABLE "Event"
ADD CONSTRAINT "Event_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "Job"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
