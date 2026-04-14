-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merakiNetworkId" TEXT,
    "thousandEyesTag" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialVault" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "last4" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "errorSummary" TEXT,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lenses" JSONB NOT NULL DEFAULT '{}',
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "heartbeatIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "pollIntervalMerakiSec" INTEGER NOT NULL DEFAULT 900,
    "pollIntervalTESec" INTEGER NOT NULL DEFAULT 900,
    "oidcEnabled" BOOLEAN NOT NULL DEFAULT false,
    "oidcIssuerUrl" TEXT,
    "oidcClientId" TEXT,
    "googleMapsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tlsCertPath" TEXT,
    "tlsKeyPath" TEXT,
    "sessionIdleTimeoutMin" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "AdminSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Site_merakiNetworkId_idx" ON "Site"("merakiNetworkId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialVault_provider_key" ON "CredentialVault"("provider");

-- CreateIndex
CREATE INDEX "MetricSnapshot_capturedAt_idx" ON "MetricSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_siteId_capturedAt_idx" ON "MetricSnapshot"("siteId", "capturedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_source_capturedAt_idx" ON "MetricSnapshot"("source", "capturedAt");

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
