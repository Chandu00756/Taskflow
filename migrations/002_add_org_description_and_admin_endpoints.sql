-- Add description field to organizations table
BEGIN;

ALTER TABLE IF EXISTS organizations
  ADD COLUMN IF NOT EXISTS description text;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON organizations(created_at DESC);

COMMIT;
