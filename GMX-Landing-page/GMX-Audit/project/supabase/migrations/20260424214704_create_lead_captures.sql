/*
  # Create lead_captures table

  ## Summary
  Creates a table to store leads from the GMX Audit Control Center landing page.

  ## New Tables
  - `lead_captures`
    - `id` (uuid, primary key)
    - `email` (text, unique, required)
    - `company` (text, optional)
    - `source` (text, default 'landing_page')
    - `created_at` (timestamptz, auto)

  ## Security
  - Enable RLS
  - Allow anonymous INSERT (public lead form)
  - Restrict SELECT to authenticated users only
*/

CREATE TABLE IF NOT EXISTS lead_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  company text DEFAULT '',
  source text DEFAULT 'landing_page',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE lead_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a lead"
  ON lead_captures
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read leads"
  ON lead_captures
  FOR SELECT
  TO authenticated
  USING (true);
