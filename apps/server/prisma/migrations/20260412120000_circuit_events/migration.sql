-- CreateTable
CREATE TABLE "CircuitEvent" (
    "id" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "relatedOutageEventId" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'meraki_ingest',

    CONSTRAINT "CircuitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CircuitEvent_circuitId_detectedAt_idx" ON "CircuitEvent"("circuitId", "detectedAt");

-- CreateIndex
CREATE INDEX "CircuitEvent_detectedAt_idx" ON "CircuitEvent"("detectedAt");

-- CreateIndex
CREATE INDEX "CircuitEvent_kind_idx" ON "CircuitEvent"("kind");

-- AddForeignKey
ALTER TABLE "CircuitEvent" ADD CONSTRAINT "CircuitEvent_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircuitEvent" ADD CONSTRAINT "CircuitEvent_relatedOutageEventId_fkey" FOREIGN KEY ("relatedOutageEventId") REFERENCES "CircuitOutageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
