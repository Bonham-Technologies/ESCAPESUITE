-- Migration: Create downloads storage bucket for standalone app files
-- Date: 2026-01-14
-- Description: Public storage bucket for distributing standalone HTML files

-- ============================================================================
-- DOWNLOADS STORAGE BUCKET
-- ============================================================================
-- Public bucket for serving standalone app downloads

INSERT INTO storage.buckets (id, name, public)
VALUES ('downloads', 'downloads', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Anyone can read (public downloads)
CREATE POLICY "Public read access for downloads"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'downloads');

-- Policy: Service role can write (for CI/CD uploads)
CREATE POLICY "Service role write access for downloads"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'downloads' AND auth.role() = 'service_role');

CREATE POLICY "Service role update access for downloads"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'downloads' AND auth.role() = 'service_role');

CREATE POLICY "Service role delete access for downloads"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'downloads' AND auth.role() = 'service_role');
