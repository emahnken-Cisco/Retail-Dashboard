-- CreateTable
CREATE TABLE "CircuitImportIdempotency" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "circuitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircuitImportIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CircuitImportIdempotency_idempotencyKey_key" ON "CircuitImportIdempotency"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CircuitImportIdempotency_circuitId_idx" ON "CircuitImportIdempotency"("circuitId");

-- AddForeignKey
ALTER TABLE "CircuitImportIdempotency" ADD CONSTRAINT "CircuitImportIdempotency_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
