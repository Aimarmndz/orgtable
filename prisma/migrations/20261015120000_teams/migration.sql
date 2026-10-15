-- Teams of an organization (docs/teams.md). The join tables carry workspaceId in their foreign
-- keys, so a team never holds a person or a board of another organization.
-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamBoard" (
    "teamId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "role" "BoardRole" NOT NULL DEFAULT 'EDITOR',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamBoard_pkey" PRIMARY KEY ("teamId","boardId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_workspaceId_name_key" ON "Team"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_workspaceId_id_key" ON "Team"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "TeamMember_workspaceId_userId_idx" ON "TeamMember"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "TeamBoard_boardId_idx" ON "TeamBoard"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_workspaceId_id_key" ON "Board"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_workspaceId_teamId_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "Team"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "WorkspaceMember"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamBoard" ADD CONSTRAINT "TeamBoard_workspaceId_teamId_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "Team"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamBoard" ADD CONSTRAINT "TeamBoard_workspaceId_boardId_fkey" FOREIGN KEY ("workspaceId", "boardId") REFERENCES "Board"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

