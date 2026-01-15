-- Migration: Create license_activations table for machine-based activation tracking
-- Date: 2026-01-14
-- Description: Track machine activations for standalone licenses to enforce seat limits

-- ============================================================================
-- LICENSE ACTIVATIONS TABLE
-- ============================================================================
-- Tracks individual machine activations per license to enforce seat count limits

CREATE TABLE IF NOT EXISTS license_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to the license
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,

  -- Machine identification (browser fingerprint hash)
  machine_hash TEXT NOT NULL,

  -- App version at time of activation
  app_version TEXT,

  -- Activation timestamps
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Additional metadata (browser info, OS, etc.)
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Unique constraint: one activation per machine per license
  UNIQUE(license_id, machine_hash)
);

-- Indexes for fast lookups
CREATE INDEX idx_license_activations_license_id ON license_activations(license_id);
CREATE INDEX idx_license_activations_machine_hash ON license_activations(machine_hash);
CREATE INDEX idx_license_activations_last_seen ON license_activations(last_seen_at);

-- Enable Row Level Security
ALTER TABLE license_activations ENABLE ROW LEVEL SECURITY;

-- Policy: service role only (accessed via Edge Functions)
CREATE POLICY "Service role access for activations" ON license_activations
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- LICENSE DOWNLOADS TABLE
-- ============================================================================
-- Track when licenses are downloaded (for analytics and audit)

CREATE TABLE IF NOT EXISTS license_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to the license
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,

  -- Download metadata
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,

  -- Additional metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for lookups
CREATE INDEX idx_license_downloads_license_id ON license_downloads(license_id);
CREATE INDEX idx_license_downloads_downloaded_at ON license_downloads(downloaded_at);

-- Enable Row Level Security
ALTER TABLE license_downloads ENABLE ROW LEVEL SECURITY;

-- Policy: service role only
CREATE POLICY "Service role access for downloads" ON license_downloads
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE license_activations IS 'Tracks machine activations per license to enforce seat limits';
COMMENT ON COLUMN license_activations.license_id IS 'Reference to the license being activated';
COMMENT ON COLUMN license_activations.machine_hash IS 'SHA-256 hash of machine fingerprint (browser-based)';
COMMENT ON COLUMN license_activations.app_version IS 'Version of the app at time of activation';
COMMENT ON COLUMN license_activations.first_seen_at IS 'When this machine first activated the license';
COMMENT ON COLUMN license_activations.last_seen_at IS 'Most recent activity from this machine';

COMMENT ON TABLE license_downloads IS 'Audit log of license key downloads from the portal';
COMMENT ON COLUMN license_downloads.license_id IS 'Reference to the license being downloaded';
COMMENT ON COLUMN license_downloads.ip_address IS 'IP address of the download request';
