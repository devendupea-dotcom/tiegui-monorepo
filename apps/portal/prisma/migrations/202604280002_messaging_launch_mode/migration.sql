CREATE TYPE "MessagingLaunchMode" AS ENUM ('LIVE_SMS', 'NO_SMS');

ALTER TABLE "Organization"
ADD COLUMN "messagingLaunchMode" "MessagingLaunchMode" NOT NULL DEFAULT 'LIVE_SMS';
