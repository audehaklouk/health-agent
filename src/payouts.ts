/**
 * Payout ledger — append-only JSONL storage + deterministic address derivation.
 * Mock USDC payouts for demo; real on-chain transfers are a stretch goal.
 */
import { createHash, randomBytes } from 'crypto';
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const LEDGER_PATH = path.join(DATA_DIR, 'payouts.jsonl');

export interface PayoutEntry {
  ts: string;
  query_id: string;
  contributor_id: string;
  label: string;
  address: string;
  amount_usdc: number;
  weight: number;
}

export interface PayoutStats {
  total_usdc: number;
  total_queries: number;
  unique_contributors: number;
}

/** Deterministic Ethereum-like address from contributor ID. */
export function deriveAddress(contributorId: string): string {
  return '0x' + createHash('sha256').update(contributorId).digest('hex').slice(0, 40);
}

/** Generate a query_id from timestamp + message + 4 random bytes. */
export function makeQueryId(timestampIso: string, message: string): string {
  const entropy = randomBytes(4).toString('hex');
  const hash = createHash('sha256')
    .update(timestampIso + message + entropy)
    .digest('hex')
    .slice(0, 12);
  return 'q_' + hash;
}

/** Append payout entries to the ledger. */
export function appendPayouts(entries: PayoutEntry[]): void {
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(LEDGER_PATH, lines, 'utf8');
}

/** Read recent payouts (newest first). limit=0 returns all. */
export function getRecentPayouts(limit: number = 50): PayoutEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  const lines = readFileSync(LEDGER_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const sliced = limit > 0 ? lines.slice(-limit) : lines;
  return sliced.reverse().map((l) => JSON.parse(l));
}

/** Compute aggregate stats from the full ledger. */
export function getPayoutStats(): PayoutStats {
  if (!existsSync(LEDGER_PATH)) {
    return { total_usdc: 0, total_queries: 0, unique_contributors: 0 };
  }
  const lines = readFileSync(LEDGER_PATH, 'utf8').trim().split('\n').filter(Boolean);
  let totalUsdc = 0;
  const queryIds = new Set<string>();
  const contributors = new Set<string>();
  for (const line of lines) {
    const entry: PayoutEntry = JSON.parse(line);
    totalUsdc += entry.amount_usdc;
    queryIds.add(entry.query_id);
    contributors.add(entry.contributor_id);
  }
  return {
    total_usdc: Math.round(totalUsdc * 1e6) / 1e6,
    total_queries: queryIds.size,
    unique_contributors: contributors.size,
  };
}

/**
 * Seed the ledger with demo data on first boot.
 * ~20 entries spread across the last 7 days so /payouts is never empty.
 */
export function seedLedgerIfEmpty(): void {
  if (existsSync(LEDGER_PATH)) {
    const content = readFileSync(LEDGER_PATH, 'utf8').trim();
    if (content.length > 0) return;
  }

  const demoQueries = [
    { msg: 'How does my sleep compare to similar profiles?', contributors: ['p_002', 'p_008', 'p_010', 'p_005'] },
    { msg: 'Am I overtraining based on my heart rate trends?', contributors: ['p_003', 'p_002', 'p_008', 'p_004'] },
    { msg: 'What does my step count say about my activity level?', contributors: ['p_002', 'p_010', 'p_006', 'p_001'] },
    { msg: 'Compare my workout frequency to the cohort', contributors: ['p_008', 'p_004', 'p_002', 'p_003'] },
    { msg: 'Is my resting heart rate healthy for my age?', contributors: ['p_002', 'p_008', 'p_005', 'p_001'] },
  ];

  const labels: Record<string, string> = {
    p_001: 'sedentary office worker, M, age 28-32',
    p_002: 'casual runner, F, age 25-29',
    p_003: 'competitive cyclist, M, age 34-38',
    p_004: 'masters marathoner, F, age 38-42',
    p_005: 'new parent, low sleep, M, age 30-34',
    p_006: 'retired active walker, F, age 62-68',
    p_008: 'CrossFit regular, F, age 28-33',
    p_010: 'yoga + hiking, F, age 45-52',
  };

  const weightSets = [
    [0.29, 0.27, 0.25, 0.19],
    [0.32, 0.26, 0.23, 0.19],
    [0.28, 0.28, 0.24, 0.20],
    [0.31, 0.25, 0.24, 0.20],
    [0.30, 0.27, 0.23, 0.20],
  ];

  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const entries: PayoutEntry[] = [];

  for (let qi = 0; qi < demoQueries.length; qi++) {
    const q = demoQueries[qi];
    const weights = weightSets[qi];
    // Spread evenly across last 7 days, newest first
    const tsOffset = SEVEN_DAYS * ((qi + 0.5) / demoQueries.length);
    const ts = new Date(now - tsOffset).toISOString();
    const queryId =
      'q_seed_' +
      createHash('sha256').update(ts + q.msg).digest('hex').slice(0, 8);

    for (let ci = 0; ci < q.contributors.length; ci++) {
      const cid = q.contributors[ci];
      const weight = weights[ci];
      entries.push({
        ts,
        query_id: queryId,
        contributor_id: cid,
        label: labels[cid] || cid,
        address: deriveAddress(cid),
        amount_usdc: Math.round(weight * 0.5 * 1e6) / 1e6,
        weight,
      });
    }
  }

  // Sort chronologically (oldest first) so slice(-N) returns the newest
  entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  writeFileSync(
    LEDGER_PATH,
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
  console.log(
    `[payouts] seeded ledger with ${entries.length} entries across ${demoQueries.length} queries`,
  );
}
