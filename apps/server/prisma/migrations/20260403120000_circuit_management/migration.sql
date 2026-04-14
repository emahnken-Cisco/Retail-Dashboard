-- CreateEnum
CREATE TYPE "CircuitConnectivityKind" AS ENUM ('DIA', 'BROADBAND', 'SATELLITE', 'CELLULAR_4G_5G');

-- CreateTable
CREATE TABLE "CircuitSpeedPreset" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "downloadMbps" INTEGER NOT NULL,
    "uploadMbps" INTEGER,
    "kinds" "CircuitConnectivityKind"[] DEFAULT ARRAY[]::"CircuitConnectivityKind"[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircuitSpeedPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Circuit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "connectivityKind" "CircuitConnectivityKind" NOT NULL,
    "providerName" TEXT NOT NULL,
    "carrierCircuitId" TEXT NOT NULL,
    "speedPresetId" TEXT,
    "customSpeedLabel" TEXT,
    "isSynchronous" BOOLEAN NOT NULL DEFAULT true,
    "localContactName" TEXT,
    "localContactPhone" TEXT,
    "localContactEmail" TEXT,
    "merakiInterface" TEXT NOT NULL,
    "merakiApplianceSerial" TEXT,
    "notes" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircuitOutageEvent" (
    "id" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "statusObserved" TEXT NOT NULL,
    "clearedToStatus" TEXT,
    "source" TEXT NOT NULL DEFAULT 'meraki_ingest',

    CONSTRAINT "CircuitOutageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Circuit_siteId_idx" ON "Circuit"("siteId");

-- CreateIndex
CREATE INDEX "Circuit_connectivityKind_idx" ON "Circuit"("connectivityKind");

-- CreateIndex
CREATE INDEX "Circuit_providerName_idx" ON "Circuit"("providerName");

-- CreateIndex
CREATE INDEX "CircuitOutageEvent_circuitId_startedAt_idx" ON "CircuitOutageEvent"("circuitId", "startedAt");

-- CreateIndex
CREATE INDEX "CircuitOutageEvent_startedAt_idx" ON "CircuitOutageEvent"("startedAt");

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_speedPresetId_fkey" FOREIGN KEY ("speedPresetId") REFERENCES "CircuitSpeedPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircuitOutageEvent" ADD CONSTRAINT "CircuitOutageEvent_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
