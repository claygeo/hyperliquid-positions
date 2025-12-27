-- Clusters table
-- Stores detected wallet clusters (related wallets)

CREATE TABLE IF NOT EXISTS clusters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallets TEXT[] NOT NULL,
  confidence DECIMAL(5, 4) NOT NULL,
  detection_method TEXT NOT NULL CHECK (detection_method IN ('transfer', 'timing', 'both')),
  total_volume DECIMAL(20, 2) NOT NULL DEFAULT 0,
  combined_score DECIMAL(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign key from wallets to clusters
ALTER TABLE wallets 
  ADD CONSTRAINT wallets_cluster_fk 
  FOREIGN KEY (cluster_id) 
  REFERENCES clusters(id) 
  ON DELETE SET NULL;

-- Comments
COMMENT ON TABLE clusters IS 'Groups of wallets believed to be controlled by same entity';
COMMENT ON COLUMN clusters.confidence IS 'How confident we are these wallets are related, 0 to 1';
COMMENT ON COLUMN clusters.detection_method IS 'How the cluster was detected';
