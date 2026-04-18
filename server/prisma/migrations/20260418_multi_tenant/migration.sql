-- Multi-tenant migration: introduce School and schoolId on every tenant-scoped table.
-- Backfills existing rows into a single default school (slug='default'), then enforces NOT NULL.

-- Step 1: add SUPER_ADMIN to AdminRole enum
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- Step 2: create schools table
CREATE TABLE "schools" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "schools_slug_key" ON "schools"("slug");

-- Step 3: insert default school (id will be 1 since table is fresh)
INSERT INTO "schools" ("slug", "name", "timezone", "isActive", "updatedAt")
VALUES ('default', 'בית ספר ברירת מחדל', 'Asia/Jerusalem', true, CURRENT_TIMESTAMP);

-- Step 4: add schoolId columns as nullable, backfill with default school, then enforce NOT NULL
-- (AdminUser.schoolId stays nullable to allow SUPER_ADMIN rows.)

-- students
ALTER TABLE "students" ADD COLUMN "schoolId" INTEGER;
UPDATE "students" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "students" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_idNumber_key";
DROP INDEX IF EXISTS "students_idNumber_key";
ALTER TABLE "students" ADD CONSTRAINT "students_schoolId_idNumber_key" UNIQUE ("schoolId", "idNumber");
CREATE INDEX "students_schoolId_idx" ON "students"("schoolId");
ALTER TABLE "students" ADD CONSTRAINT "students_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- teachers
ALTER TABLE "teachers" ADD COLUMN "schoolId" INTEGER;
UPDATE "teachers" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "teachers" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "teachers" DROP CONSTRAINT IF EXISTS "teachers_phone_key";
DROP INDEX IF EXISTS "teachers_phone_key";
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_schoolId_phone_key" UNIQUE ("schoolId", "phone");
CREATE INDEX "teachers_schoolId_idx" ON "teachers"("schoolId");
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- exit_requests
ALTER TABLE "exit_requests" ADD COLUMN "schoolId" INTEGER;
UPDATE "exit_requests" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "exit_requests" ALTER COLUMN "schoolId" SET NOT NULL;
CREATE INDEX "exit_requests_schoolId_idx" ON "exit_requests"("schoolId");
ALTER TABLE "exit_requests" ADD CONSTRAINT "exit_requests_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- conversations
ALTER TABLE "conversations" ADD COLUMN "schoolId" INTEGER;
UPDATE "conversations" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "conversations" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_phone_key";
DROP INDEX IF EXISTS "conversations_phone_key";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_schoolId_phone_key" UNIQUE ("schoolId", "phone");
CREATE INDEX "conversations_schoolId_idx" ON "conversations"("schoolId");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- message_templates
ALTER TABLE "message_templates" ADD COLUMN "schoolId" INTEGER;
UPDATE "message_templates" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "message_templates" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "message_templates" DROP CONSTRAINT IF EXISTS "message_templates_key_key";
DROP INDEX IF EXISTS "message_templates_key_key";
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_schoolId_key_key" UNIQUE ("schoolId", "key");
CREATE INDEX "message_templates_schoolId_idx" ON "message_templates"("schoolId");
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- message_logs
ALTER TABLE "message_logs" ADD COLUMN "schoolId" INTEGER;
UPDATE "message_logs" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "message_logs" ALTER COLUMN "schoolId" SET NOT NULL;
CREATE INDEX "message_logs_schoolId_idx" ON "message_logs"("schoolId");
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- admin_users (schoolId stays nullable for SUPER_ADMIN)
ALTER TABLE "admin_users" ADD COLUMN "schoolId" INTEGER;
UPDATE "admin_users" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "admin_users" DROP CONSTRAINT IF EXISTS "admin_users_username_key";
DROP INDEX IF EXISTS "admin_users_username_key";
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_schoolId_username_key" UNIQUE ("schoolId", "username");
CREATE INDEX "admin_users_schoolId_idx" ON "admin_users"("schoolId");
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- settings: current PK is "key" alone; switch to a surrogate id with composite unique
ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_pkey";
ALTER TABLE "settings" DROP CONSTRAINT IF EXISTS "settings_key_key";
DROP INDEX IF EXISTS "settings_key_key";
ALTER TABLE "settings" ADD COLUMN "id" SERIAL PRIMARY KEY;
ALTER TABLE "settings" ADD COLUMN "schoolId" INTEGER;
UPDATE "settings" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "settings" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "settings" ADD CONSTRAINT "settings_schoolId_key_key" UNIQUE ("schoolId", "key");
CREATE INDEX "settings_schoolId_idx" ON "settings"("schoolId");
ALTER TABLE "settings" ADD CONSTRAINT "settings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- whatsapp_sessions: same pattern (key was unique but not PK — add id PK, composite unique)
ALTER TABLE "whatsapp_sessions" DROP CONSTRAINT IF EXISTS "whatsapp_sessions_key_key";
DROP INDEX IF EXISTS "whatsapp_sessions_key_key";
ALTER TABLE "whatsapp_sessions" ADD COLUMN "id" SERIAL PRIMARY KEY;
ALTER TABLE "whatsapp_sessions" ADD COLUMN "schoolId" INTEGER;
UPDATE "whatsapp_sessions" SET "schoolId" = (SELECT "id" FROM "schools" WHERE "slug" = 'default');
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "schoolId" SET NOT NULL;
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_schoolId_key_key" UNIQUE ("schoolId", "key");
CREATE INDEX "whatsapp_sessions_schoolId_idx" ON "whatsapp_sessions"("schoolId");
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
