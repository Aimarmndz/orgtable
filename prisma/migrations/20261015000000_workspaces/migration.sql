-- Workspaces: every board lives in one, and its URL is /<workspace slug>/<board slug>.
-- Existing data is moved without loss: each user gets a PERSONAL workspace (slug from the
-- name, made unique) and each board goes to its owner's workspace with a
-- slug from its title (unique in that workspace). See docs/workspaces.md.

-- CreateEnum
CREATE TYPE "WorkspaceKind" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BoardVisibility" AS ENUM ('WORKSPACE', 'PRIVATE');

-- AlterTable: nullable first, filled below, then NOT NULL.
ALTER TABLE "Board" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "visibility" "BoardVisibility" NOT NULL DEFAULT 'WORKSPACE',
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "managedById" TEXT;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkspaceKind" NOT NULL,
    "personalOwnerId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- Same rules as app/lib/slugs.ts: lowercase ASCII letters, digits and single hyphens, no
-- hyphen at either end. Common Latin accents are folded (á → a, ñ → n).
CREATE FUNCTION pg_temp.orgtable_slug(t TEXT, maxlen INT) RETURNS TEXT AS $$
  SELECT trim(BOTH '-' FROM left(
    trim(BOTH '-' FROM regexp_replace(
      translate(lower(coalesce(t, '')),
        'áàäâãåéèëêíìïîóòöôõúùüûñçý', 'aaaaaaeeeeiiiiooooouuuuncy'),
      '[^a-z0-9]+', '-', 'g')),
    maxlen))
$$ LANGUAGE sql IMMUTABLE;

DO $$
DECLARE
  -- Keep in sync with RESERVED_WORKSPACE_SLUGS and RESERVED_BOARD_SLUGS in app/lib/slugs.ts.
  reserved_ws TEXT[] := ARRAY['about','account','admin','api','app','auth','board','boards',
    'cookies','dashboard','docs','explore','forgot-password','health','help','invite','join','legal','login',
    'logout','me','new','notice','null','org','orgs','orgtable','pricing','privacy','public',
    'register','reset-password','root','search','settings','setup','signup','static','status','support',
    'system','terms','undefined','user','users','workspace','workspaces','www'];
  reserved_board TEXT[] := ARRAY['members','new','settings'];
  u RECORD;
  b RECORD;
  base TEXT;
  cand TEXT;
  n INT;
  ws TEXT;
BEGIN
  FOR u IN SELECT "id", "email", "name" FROM "User" ORDER BY "createdAt", "id" LOOP
    -- From the name, never the email (shared URLs must not reveal addresses); the email's
    -- local part only when the name has no usable letters.
    base := pg_temp.orgtable_slug(u."name", 33);
    IF length(base) < 3 THEN base := pg_temp.orgtable_slug(split_part(u."email", '@', 1), 33); END IF;
    IF length(base) < 3 THEN base := trim(BOTH '-' FROM base || '-user'); END IF;
    IF length(base) < 3 THEN base := 'user'; END IF;
    cand := base;
    n := 1;
    WHILE cand = ANY (reserved_ws) OR EXISTS (SELECT 1 FROM "Workspace" WHERE "slug" = cand) LOOP
      n := n + 1;
      cand := base || '-' || n;
    END LOOP;
    ws := 'w' || substr(md5('workspace:' || u."id"), 1, 24);
    INSERT INTO "Workspace" ("id", "slug", "name", "kind", "personalOwnerId", "updatedAt")
      VALUES (ws, cand, left(u."name", 60), 'PERSONAL', u."id", CURRENT_TIMESTAMP);
    INSERT INTO "WorkspaceMember" ("workspaceId", "userId", "role") VALUES (ws, u."id", 'OWNER');
  END LOOP;

  FOR b IN SELECT "id", "title", "ownerId" FROM "Board" ORDER BY "createdAt", "id" LOOP
    SELECT "id" INTO ws FROM "Workspace" WHERE "personalOwnerId" = b."ownerId";
    base := pg_temp.orgtable_slug(b."title", 56);
    IF base = '' THEN base := 'board'; END IF;
    cand := base;
    n := 1;
    WHILE cand = ANY (reserved_board)
      OR EXISTS (SELECT 1 FROM "Board" WHERE "workspaceId" = ws AND "slug" = cand) LOOP
      n := n + 1;
      cand := base || '-' || n;
    END LOOP;
    UPDATE "Board" SET "workspaceId" = ws, "slug" = cand WHERE "id" = b."id";
  END LOOP;
END $$;

ALTER TABLE "Board" ALTER COLUMN "slug" SET NOT NULL,
ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_personalOwnerId_key" ON "Workspace"("personalOwnerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_workspaceId_slug_key" ON "Board"("workspaceId", "slug");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_personalOwnerId_fkey" FOREIGN KEY ("personalOwnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managedById_fkey" FOREIGN KEY ("managedById") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
