// Cluster detector - find related wallets

import { HyperliquidClient } from '@hyperliquid-tracker/sdk';
import type { DBClusterInsert, HLLedgerUpdate } from '@hyperliquid-tracker/shared';
import { createLogger } from '../utils/logger.js';
import { metrics, trackTiming } from '../utils/metrics.js';
import CONFIG from '../config.js';
import { db } from '../db/client.js';
import { getActiveWallets } from '../db/wallets.js';

const logger = createLogger('processor:cluster');

interface TransferEdge {
  from: string;
  to: string;
  amount: number;
  timestamp: Date;
}

interface ClusterCandidate {
  wallets: Set<string>;
  confidence: number;
  method: 'transfer' | 'timing' | 'both';
  totalVolume: number;
}

/**
 * Detect wallet clusters based on transfer patterns
 */
export async function detectClusters(limit = 100): Promise<number> {
  return trackTiming('detect_clusters', async () => {
    try {
      const wallets = await getActiveWallets(limit);
      
      if (wallets.length === 0) {
        return 0;
      }

      logger.info(`Analyzing ${wallets.length} wallets for clusters`);

      const client = new HyperliquidClient({
        apiUrl: CONFIG.hyperliquid.apiUrl,
      });

      // Build transfer graph
      const transfers: TransferEdge[] = [];
      
      for (const wallet of wallets) {
        try {
          const ledgerUpdates = await client.getUserNonFundingLedgerUpdates(wallet.address);
          
          for (const update of ledgerUpdates) {
            if (isInternalTransfer(update)) {
              const transfer = update.delta as { usdc: number; destination: string };
              transfers.push({
                from: wallet.address,
                to: transfer.destination,
                amount: Math.abs(transfer.usdc),
                timestamp: new Date(update.time),
              });
            }
          }

          // Rate limit
          await delay(100);
        } catch (error) {
          logger.error(`Error fetching transfers for ${wallet.address}`, error);
        }
      }

      logger.info(`Found ${transfers.length} internal transfers`);

      // Find clusters from transfer graph
      const clusters = findClustersFromTransfers(transfers, wallets.map(w => w.address));
      
      // Save clusters to database
      let saved = 0;
      for (const cluster of clusters) {
        if (cluster.wallets.size >= 2) {
          await saveCluster(cluster);
          saved++;
        }
      }

      metrics.increment('clusters_detected', saved);
      logger.info(`Detected ${saved} wallet clusters`);

      return saved;
    } catch (error) {
      logger.error('Error detecting clusters', error);
      return 0;
    }
  });
}

/**
 * Check if a ledger update is an internal transfer
 */
function isInternalTransfer(update: HLLedgerUpdate): boolean {
  return (
    update.delta &&
    typeof update.delta === 'object' &&
    'type' in update.delta &&
    (update.delta.type === 'internalTransfer' || update.delta.type === 'subAccountTransfer')
  );
}

/**
 * Find clusters using union-find algorithm on transfer graph
 */
function findClustersFromTransfers(
  transfers: TransferEdge[],
  knownWallets: string[]
): ClusterCandidate[] {
  // Union-Find data structure
  const parent: Map<string, string> = new Map();
  const rank: Map<string, number> = new Map();

  function find(x: string): string {
    if (!parent.has(x)) {
      parent.set(x, x);
      rank.set(x, 0);
    }
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }

  function union(x: string, y: string): void {
    const rootX = find(x);
    const rootY = find(y);
    
    if (rootX === rootY) return;

    const rankX = rank.get(rootX) || 0;
    const rankY = rank.get(rootY) || 0;

    if (rankX < rankY) {
      parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      parent.set(rootY, rootX);
    } else {
      parent.set(rootY, rootX);
      rank.set(rootX, rankX + 1);
    }
  }

  // Initialize all known wallets
  for (const wallet of knownWallets) {
    find(wallet);
  }

  // Union wallets that have transferred to each other
  for (const transfer of transfers) {
    union(transfer.from, transfer.to);
  }

  // Group wallets by their root
  const clusters: Map<string, Set<string>> = new Map();
  const clusterVolumes: Map<string, number> = new Map();

  for (const wallet of knownWallets) {
    const root = find(wallet);
    
    if (!clusters.has(root)) {
      clusters.set(root, new Set());
      clusterVolumes.set(root, 0);
    }
    
    clusters.get(root)!.add(wallet);
  }

  // Calculate transfer volumes for each cluster
  for (const transfer of transfers) {
    const root = find(transfer.from);
    const currentVolume = clusterVolumes.get(root) || 0;
    clusterVolumes.set(root, currentVolume + transfer.amount);
  }

  // Convert to ClusterCandidate array
  const result: ClusterCandidate[] = [];
  
  for (const [root, walletSet] of clusters) {
    if (walletSet.size >= 2) {
      // Calculate confidence based on number of transfers
      const clusterTransfers = transfers.filter(
        t => find(t.from) === root || find(t.to) === root
      );
      
      const confidence = Math.min(1, clusterTransfers.length / walletSet.size / 2);

      result.push({
        wallets: walletSet,
        confidence,
        method: 'transfer',
        totalVolume: clusterVolumes.get(root) || 0,
      });
    }
  }

  return result;
}

/**
 * Save cluster to database
 */
async function saveCluster(cluster: ClusterCandidate): Promise<void> {
  const walletArray = Array.from(cluster.wallets);

  // Check if cluster already exists
  const { data: existing } = await db.client
    .from('clusters')
    .select('id, wallets')
    .contains('wallets', walletArray)
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing cluster
    const existingWallets = new Set(existing[0].wallets);
    const newWallets = walletArray.filter(w => !existingWallets.has(w));

    if (newWallets.length > 0) {
      const mergedWallets = [...existingWallets, ...newWallets];
      await db.client
        .from('clusters')
        .update({
          wallets: mergedWallets,
          confidence: cluster.confidence,
          total_volume: cluster.totalVolume,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id);
      
      logger.debug(`Updated cluster ${existing[0].id} with ${newWallets.length} new wallets`);
    }
  } else {
    // Create new cluster
    const insert: DBClusterInsert = {
      wallets: walletArray,
      confidence: cluster.confidence,
      detection_method: cluster.method,
      total_volume: cluster.totalVolume,
    };

    const { error } = await db.client.from('clusters').insert(insert);
    
    if (error) {
      logger.error('Error saving cluster', error);
    } else {
      logger.debug(`Created new cluster with ${walletArray.length} wallets`);
    }
  }

  // Update wallet cluster_id references
  for (const wallet of walletArray) {
    // This would need the cluster ID - simplified for now
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { detectClusters };
