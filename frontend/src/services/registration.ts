import { postJson } from '../lib/api';
import { registerMaterial as registerOnchain, shortHash } from './contractClient';
import type { Signer } from 'ethers';

export type GeneratedCandidate = {
  material_hash: string;
  formula: string;
  density: number;
  e_hull: number;
  predicted_formation_energy: number;
  consensus_spread: number;
  model_predictions: Record<string, number | null>;
  structure_payload: Record<string, unknown>;
};

export async function registerGeneratedCandidate(signer: Signer, candidate: GeneratedCandidate) {
  const metadata = {
    formula: candidate.formula,
    density: candidate.density,
    e_hull: candidate.e_hull,
    predicted_formation_energy: candidate.predicted_formation_energy,
    consensus_spread: candidate.consensus_spread,
    model_predictions: candidate.model_predictions,
  };
  const stored = await postJson<{ storage_reference: string; storage_backend: string; is_ipfs: boolean }>(
    '/api/storage/upload',
    { content: { material_hash: candidate.material_hash, ...metadata, structure: candidate.structure_payload } },
  );
  const transaction = await registerOnchain(signer, {
    fingerprint: candidate.material_hash,
    storageReference: stored.storage_reference,
    metadata: JSON.stringify(metadata),
  });
  return {
    ...transaction,
    storageBackend: stored.storage_backend,
    isIpfs: stored.is_ipfs,
    displayHash: shortHash(transaction.transactionHash),
  };
}
