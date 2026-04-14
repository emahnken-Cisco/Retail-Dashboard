-- Role-based access: Organization Admin, Location & Circuit editor, Read-only user.
CREATE TYPE "UserRole" AS ENUM ('ORG_ADMIN', 'LOCATION_CIRCUIT', 'USER');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'ORG_ADMIN';

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
