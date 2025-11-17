-- Create invites table to support secure invite flow
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    org_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_orgid ON invites(org_id);
