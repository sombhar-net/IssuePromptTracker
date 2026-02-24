-- CreateEnum
CREATE TYPE "ItemActivityActorType" AS ENUM ('USER', 'AGENT');

-- CreateEnum
CREATE TYPE "ItemActivityType" AS ENUM ('RESOLUTION_NOTE', 'STATUS_CHANGE');

-- CreateTable
CREATE TABLE "AgentApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemActivity" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorType" "ItemActivityActorType" NOT NULL,
    "actorUserId" TEXT,
    "agentKeyId" TEXT,
    "type" "ItemActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentApiKey_prefix_key" ON "AgentApiKey"("prefix");
CREATE INDEX "AgentApiKey_projectId_idx" ON "AgentApiKey"("projectId");
CREATE INDEX "AgentApiKey_revokedAt_idx" ON "AgentApiKey"("revokedAt");
CREATE INDEX "ItemActivity_itemId_createdAt_idx" ON "ItemActivity"("itemId", "createdAt");
CREATE INDEX "ItemActivity_actorUserId_idx" ON "ItemActivity"("actorUserId");
CREATE INDEX "ItemActivity_agentKeyId_idx" ON "ItemActivity"("agentKeyId");

-- AddForeignKey
ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemActivity" ADD CONSTRAINT "ItemActivity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemActivity" ADD CONSTRAINT "ItemActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItemActivity" ADD CONSTRAINT "ItemActivity_agentKeyId_fkey" FOREIGN KEY ("agentKeyId") REFERENCES "AgentApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
