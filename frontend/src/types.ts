export type Stats = {
  total_candidates_generated: number;
  structurally_valid_candidates: number;
  thermodynamically_accepted: number;
  registered_materials: number;
  active_marketplace_listings: number;
  completed_licenses: number;
  recent_jobs: Array<{ id: string; status: string; created_at: number }>;
  recent_transactions: Array<{ hash: string; type: string; status: string }>;
};

export type Material = {
  id: string;
  formula: string;
  composition: Record<string, number>;
  density: number;
  e_hull: number;
  consensus_spread: number;
  status: string;
};
