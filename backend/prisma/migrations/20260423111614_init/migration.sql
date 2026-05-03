-- CreateTable
CREATE TABLE "Certificate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "certId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "course" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "issueDate" TEXT NOT NULL,
    "txHash" TEXT,
    "documentPath" TEXT,
    "documentOriginalName" TEXT,
    "studentEmail" TEXT,
    "ipfsCID" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_certId_key" ON "Certificate"("certId");

-- CreateIndex
CREATE INDEX "Certificate_certId_idx" ON "Certificate"("certId");
