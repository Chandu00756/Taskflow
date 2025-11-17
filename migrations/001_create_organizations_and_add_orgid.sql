-- Create organizations table and add org_id to users and tasks
BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_domain ON organizations(domain);

-- Add org_id to users
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS org_id uuid;
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

-- Add org_id to tasks
ALTER TABLE IF EXISTS tasks
  ADD COLUMN IF NOT EXISTS org_id uuid;
CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON tasks(org_id);

COMMIT;
