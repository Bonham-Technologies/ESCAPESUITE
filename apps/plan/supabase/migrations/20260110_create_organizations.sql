-- Migration: Create organizations, members, invites, and audit_logs tables
-- Date: 2026-01-10
-- Description: Add support for team and enterprise subscriptions

-- ============================================================================
-- ORGANIZATIONS TABLE
-- ============================================================================
-- Represents a team or enterprise account that can have multiple members

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic info
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,

  -- Stripe integration
  stripe_customer_id TEXT UNIQUE,

  -- Plan configuration
  plan TEXT NOT NULL DEFAULT 'team' CHECK (plan IN ('team', 'enterprise')),
  seat_count INTEGER NOT NULL DEFAULT 5 CHECK (seat_count >= 1),

  -- Settings (JSON for flexibility)
  settings JSONB NOT NULL DEFAULT '{
    "sso_enabled": false,
    "require_2fa": false,
    "audit_logging": false,
    "allowed_domains": []
  }'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for organizations
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_stripe_customer_id ON organizations(stripe_customer_id);
CREATE INDEX idx_organizations_plan ON organizations(plan);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_organizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_organizations_updated_at();

-- ============================================================================
-- ORGANIZATION MEMBERS TABLE
-- ============================================================================
-- Links users to organizations with roles

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- User identification (Clerk user ID)
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Role: owner (1 per org), admin, member
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),

  -- Status tracking
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(organization_id, user_id),
  UNIQUE(organization_id, email)
);

-- Indexes for organization_members
CREATE INDEX idx_organization_members_org_id ON organization_members(organization_id);
CREATE INDEX idx_organization_members_user_id ON organization_members(user_id);
CREATE INDEX idx_organization_members_email ON organization_members(email);
CREATE INDEX idx_organization_members_role ON organization_members(role);

-- ============================================================================
-- ORGANIZATION INVITES TABLE
-- ============================================================================
-- Pending invitations to join organizations

CREATE TABLE IF NOT EXISTS organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Invite details
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),

  -- Who invited them
  invited_by TEXT NOT NULL, -- Clerk user ID

  -- Token for accepting invite (URL-safe random string)
  token TEXT UNIQUE NOT NULL,

  -- Expiration (default 7 days)
  expires_at TIMESTAMPTZ NOT NULL,

  -- When accepted (null if pending)
  accepted_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for organization_invites
CREATE INDEX idx_organization_invites_org_id ON organization_invites(organization_id);
CREATE INDEX idx_organization_invites_email ON organization_invites(email);
CREATE INDEX idx_organization_invites_token ON organization_invites(token);
CREATE INDEX idx_organization_invites_expires_at ON organization_invites(expires_at);

-- Partial unique index: only one pending invite per email per org
CREATE UNIQUE INDEX idx_organization_invites_pending_unique
  ON organization_invites(organization_id, email)
  WHERE accepted_at IS NULL;

-- ============================================================================
-- AUDIT LOGS TABLE
-- ============================================================================
-- Enterprise feature: track all actions within an organization

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who performed the action
  user_id TEXT, -- Clerk user ID (null for system actions)

  -- What happened
  action TEXT NOT NULL, -- e.g., 'member.invited', 'member.removed', 'settings.updated'

  -- Resource affected
  resource_type TEXT, -- e.g., 'member', 'settings', 'subscription'
  resource_id TEXT,   -- ID of the affected resource

  -- Additional context
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Request info
  ip_address INET,
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit_logs
CREATE INDEX idx_audit_logs_org_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Partition audit_logs by month for better performance (optional, for high-volume)
-- This can be added later when needed

-- ============================================================================
-- EXTEND SUBSCRIPTIONS TABLE
-- ============================================================================
-- Add organization_id and seat_count to existing subscriptions table

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 1 CHECK (seat_count >= 1);

-- Index for organization subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);

-- ============================================================================
-- LICENSE DOWNLOADS TABLE
-- ============================================================================
-- Track standalone build downloads (for Track B, but creating schema now)

CREATE TABLE IF NOT EXISTS license_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who downloaded (can be org member or individual)
  user_id TEXT, -- Clerk user ID
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- What was downloaded
  product TEXT NOT NULL CHECK (product IN ('craft', 'artist', 'suite')),
  version TEXT NOT NULL,

  -- Request info
  ip_address INET,
  user_agent TEXT,

  -- Timestamps
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for license_downloads
CREATE INDEX idx_license_downloads_user_id ON license_downloads(user_id);
CREATE INDEX idx_license_downloads_org_id ON license_downloads(organization_id);
CREATE INDEX idx_license_downloads_product ON license_downloads(product);
CREATE INDEX idx_license_downloads_downloaded_at ON license_downloads(downloaded_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_downloads ENABLE ROW LEVEL SECURITY;

-- Organizations: service role only (accessed via Edge Functions)
CREATE POLICY "Service role access for organizations" ON organizations
  FOR ALL USING (auth.role() = 'service_role');

-- Organization members: service role only
CREATE POLICY "Service role access for organization_members" ON organization_members
  FOR ALL USING (auth.role() = 'service_role');

-- Organization invites: service role only
CREATE POLICY "Service role access for organization_invites" ON organization_invites
  FOR ALL USING (auth.role() = 'service_role');

-- Audit logs: service role only
CREATE POLICY "Service role access for audit_logs" ON audit_logs
  FOR ALL USING (auth.role() = 'service_role');

-- License downloads: service role only
CREATE POLICY "Service role access for license_downloads" ON license_downloads
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to check if a user is a member of an organization
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID, clerk_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = clerk_user_id
      AND joined_at IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if a user is an admin/owner of an organization
CREATE OR REPLACE FUNCTION is_org_admin(org_id UUID, clerk_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = clerk_user_id
      AND role IN ('owner', 'admin')
      AND joined_at IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if a user is the owner of an organization
CREATE OR REPLACE FUNCTION is_org_owner(org_id UUID, clerk_user_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
      AND user_id = clerk_user_id
      AND role = 'owner'
      AND joined_at IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get available seats in an organization
CREATE OR REPLACE FUNCTION get_available_seats(org_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total_seats INTEGER;
  used_seats INTEGER;
BEGIN
  SELECT seat_count INTO total_seats FROM organizations WHERE id = org_id;
  SELECT COUNT(*) INTO used_seats FROM organization_members
    WHERE organization_id = org_id AND joined_at IS NOT NULL;
  RETURN COALESCE(total_seats, 0) - COALESCE(used_seats, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate URL-safe random token
CREATE OR REPLACE FUNCTION generate_invite_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'base64')
    -- Make URL-safe
    REPLACE('+', '-')
    REPLACE('/', '_')
    REPLACE('=', '');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE organizations IS 'Team and enterprise accounts that can have multiple members';
COMMENT ON TABLE organization_members IS 'Links users (via Clerk user ID) to organizations with roles';
COMMENT ON TABLE organization_invites IS 'Pending invitations to join organizations';
COMMENT ON TABLE audit_logs IS 'Enterprise feature: tracks all actions within an organization';
COMMENT ON TABLE license_downloads IS 'Tracks standalone build downloads for analytics';

COMMENT ON COLUMN organizations.plan IS 'team or enterprise - determines available features';
COMMENT ON COLUMN organizations.seat_count IS 'Maximum number of members allowed';
COMMENT ON COLUMN organizations.settings IS 'JSON settings: sso_enabled, require_2fa, audit_logging, allowed_domains';

COMMENT ON COLUMN organization_members.role IS 'owner (1 per org, full control), admin (manage members), member (basic access)';
COMMENT ON COLUMN organization_members.invited_at IS 'When the invitation was sent';
COMMENT ON COLUMN organization_members.joined_at IS 'When the user accepted and joined (null if pending)';

COMMENT ON COLUMN organization_invites.token IS 'URL-safe token for accepting invite via link';
COMMENT ON COLUMN organization_invites.expires_at IS 'Invite expires after this time (default 7 days)';

COMMENT ON COLUMN audit_logs.action IS 'Action performed: member.invited, member.removed, settings.updated, etc.';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional context about the action in JSON format';
