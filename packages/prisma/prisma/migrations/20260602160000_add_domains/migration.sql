-- Domains (DET-234): semantic regions of a workspace + the ConceptDomain join
-- that lets a concept belong to several at once. Hand-authored (not
-- `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model, so every `migrate dev` tries to drop it and would
-- silently degrade semantic search (see the Articulation.embedding schema comment).
-- These are purely additive tables; nothing existing is altered.

-- CreateTable: domain (a semantic region; may nest via parentDomainId).
CREATE TABLE "domain" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentDomainId" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_workspaceId_idx" ON "domain"("workspaceId");
CREATE INDEX "domain_parentDomainId_idx" ON "domain"("parentDomainId");

-- AddForeignKey: a domain belongs to a workspace (cascade on workspace delete).
ALTER TABLE "domain" ADD CONSTRAINT "domain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: self-relation for nesting. Deleting a parent un-nests its
-- children (SET NULL), never deletes them — nesting is allowed, not forced.
ALTER TABLE "domain" ADD CONSTRAINT "domain_parentDomainId_fkey" FOREIGN KEY ("parentDomainId") REFERENCES "domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: concept_domain (the many-to-many membership with provenance).
CREATE TABLE "concept_domain" (
    "conceptId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdBy" "Generator" NOT NULL DEFAULT 'USER',
    "userValidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_domain_pkey" PRIMARY KEY ("conceptId","domainId")
);

-- CreateIndex
CREATE INDEX "concept_domain_conceptId_idx" ON "concept_domain"("conceptId");
CREATE INDEX "concept_domain_domainId_idx" ON "concept_domain"("domainId");

-- AddForeignKey: deleting a concept removes its memberships; deleting a domain
-- removes its memberships — neither ever deletes the other entity. This is how
-- "delete a domain → orphan its ConceptDomain rows, never the concepts" holds.
ALTER TABLE "concept_domain" ADD CONSTRAINT "concept_domain_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "concept_domain" ADD CONSTRAINT "concept_domain_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
