/**
 * health-agent — Hono server entrypoint.
 * Runs inside an EigenCompute TDX TEE (production) or locally (dev).
 */
import { createHash } from 'crypto';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { initStorage } from './storage';
import { chatWithLLM } from './llm';
import type { LLMResult } from './llm';
import { parseAppleHealthExport } from './apple-health';
import { getAttestationInfo } from './attestation';
import type { AttestationInfo } from './attestation';
import { selectContributors, buildCohortPromptBlock } from './personas';
import {
  appendPayouts,
  getRecentPayouts,
  getPayoutStats,
  makeQueryId,
  seedLedgerIfEmpty,
} from './payouts';
import type { PayoutEntry } from './payouts';

const app = new Hono();
app.use('*', logger());
app.use('/api/*', cors());

const storage = initStorage();

const APP_ID = process.env.APP_ID || null;

// Seed payout ledger with demo data on first boot
seedLedgerIfEmpty();

// Cache attestation info at boot for receipt generation
let cachedAttestation: AttestationInfo | null = null;
getAttestationInfo().then((info) => { cachedAttestation = info; });

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ----- Health -----
app.get('/api/health', (c) =>
  c.json({ ok: true, ts: Date.now(), insideTEE: Boolean(process.env.MNEMONIC) }),
);

// ----- Attestation -----
app.get('/api/attestation', async (c) => c.json(await getAttestationInfo()));

// ----- Apple Health upload -----
app.post('/api/upload', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = parseAppleHealthExport(body);
    storage.replaceData(parsed);
    return c.json({
      ok: true,
      recordsImported: parsed.totalRecords,
      windowFrom: parsed.summary.windows.from,
      windowTo: parsed.summary.windows.to,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 400);
  }
});

// ----- Chat (with cohort attribution + per-response receipt) -----
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json<{ message?: string }>();
    if (!message || typeof message !== 'string') {
      return c.json({ error: 'message (string) required' }, 400);
    }
    const summary = storage.getSummary();
    const contributorResult = selectContributors(summary);
    const cohortBlock = buildCohortPromptBlock(contributorResult.contributors);
    const llmResult: LLMResult = await chatWithLLM(message, summary, cohortBlock);

    const timestampIso = new Date().toISOString();
    const queryId = makeQueryId(timestampIso, message);

    // Build payouts array (ledger-facing format with addresses, 6-decimal precision)
    const payouts = contributorResult.contributors.map((ct) => ({
      contributor_id: ct.id,
      address: ct.address,
      query_fee_share_usdc: Math.round(ct.context_weight * contributorResult.query_price_mock_usd * 1e6) / 1e6,
      weight: ct.context_weight,
    }));

    // Append to ledger
    const ledgerEntries: PayoutEntry[] = contributorResult.contributors.map((ct) => ({
      ts: timestampIso,
      query_id: queryId,
      contributor_id: ct.id,
      label: ct.label,
      address: ct.address,
      amount_usdc: Math.round(ct.context_weight * contributorResult.query_price_mock_usd * 1e6) / 1e6,
      weight: ct.context_weight,
    }));
    if (ledgerEntries.length > 0) {
      appendPayouts(ledgerEntries);
    }

    const att = cachedAttestation;
    const receipt = {
      receipt_version: '0.1-mock',
      issued_by: {
        app_id: att?.appId ?? APP_ID,
        tee_status: att?.insideTEE ? 'TDX (Intel)' : 'local-dev',
        kms_pubkey: att?.kmsPublicKey
          ? att.kmsPublicKey.slice(0, 64) + '...'
          : null,
      },
      query: {
        text: message,
        user_data_hash: summary ? sha256(JSON.stringify(summary)) : null,
        timestamp_iso: timestampIso,
        query_id: queryId,
      },
      response: {
        text_hash: sha256(llmResult.text),
        model: llmResult.model,
        via_gateway: llmResult.via_gateway,
      },
      contributors: contributorResult.contributors.map((ct) => ({
        id: ct.id,
        label: ct.label,
        context_weight: ct.context_weight,
        mock_payout_usd: ct.mock_payout_usd,
        address: ct.address,
      })),
      payouts,
      query_price_mock_usd: contributorResult.query_price_mock_usd,
      signature: {
        scheme: 'mock-v0.1',
        value: 'not-yet-signed:per-response-signing-is-v2',
        note: 'v1 signs the running container, not individual responses. See /attestation.',
      },
    };

    return c.json({
      reply: llmResult.text,
      contributors: contributorResult.contributors,
      payouts,
      references_used: contributorResult.references_used,
      query_price_mock_usd: contributorResult.query_price_mock_usd,
      attestation_ref: APP_ID,
      via_gateway: llmResult.via_gateway,
      receipt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ----- Payouts ledger -----
app.get('/api/payouts/recent', (c) => {
  const limit = Number(c.req.query('limit')) || 50;
  const payouts = getRecentPayouts(limit);
  const stats = getPayoutStats();
  return c.json({ payouts, stats });
});

// ----- Static frontend (must be last) -----
app.use('/*', serveStatic({ root: './public' }));
app.use('/*', serveStatic({ path: './public/index.html' }));

// ----- Boot -----
const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
console.log(`[health-agent] listening on 0.0.0.0:${port}`);
console.log(
  `[health-agent] inside TEE: ${process.env.MNEMONIC ? 'yes' : 'no (local dev)'} ` +
    `| gateway: ${process.env.EIGEN_GATEWAY_URL ? 'yes' : 'no'} ` +
    `| anthropic key: ${process.env.ANTHROPIC_API_KEY ? 'yes' : 'no'}`,
);
