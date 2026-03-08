-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- AlterTable
ALTER TABLE "exit_requests" ADD COLUMN "notifiedAt" TIMESTAMP(3);
ALTER TABLE "exit_requests" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Seed default settings
INSERT INTO "settings" ("key", "value", "updatedAt") VALUES
    ('teacher_reminder_minutes', '15', NOW()),
    ('teacher_auto_escalate_minutes', '30', NOW());
