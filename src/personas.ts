/**
 * Persona loading, similarity scoring, and contributor selection.
 *
 * Loads data/personas.json once at startup. Never mutates it.
 * Similarity is Euclidean distance on 5 normalized behavioral features.
 * "Context weight" is the similarity-normalized share used to select
 * which personas inform the LLM prompt — NOT causal attribution.
 */
import { readFileSync } from 'fs';
import path from 'path';
import type { HealthSummary } from './apple-health';
import { deriveAddress } from './payouts';

// --- Types matching the hand-authored personas.json schema ---

export interface PersonaProfile {
  age_band: [number, number];
  sex: string;
  resting_hr_bpm: number;
  steps_daily_avg: number;
  sleep_hours_avg: number;
  active_minutes_weekly: number;
  workout_sessions_weekly: number;
}

export interface Persona {
  id: string;
  label: string;
  narrative_summary: string;
  profile: PersonaProfile;
  source_notes: Record<string, string>;
}

export interface PersonasFile {
  schema_version: string;
  construction_note: string;
  references: Record<string, string>;
  personas: Persona[];
}

export interface Contributor {
  id: string;
  label: string;
  narrative_summary: string;
  similarity_score: number;
  context_weight: number;
  mock_payout_usd: number;
  address: string;
  source_notes: Record<string, string>;
}

export interface ContributorResult {
  contributors: Contributor[];
  references_used: Record<string, string>;
  query_price_mock_usd: number;
}

// --- Normalization bounds (derived from persona-set min/max) ---

interface FeatureBounds {
  min: number;
  max: number;
}

const FEATURE_KEYS = [
  'resting_hr_bpm',
  'steps_daily_avg',
  'sleep_hours_avg',
  'active_minutes_weekly',
  'workout_sessions_weekly',
] as const;

type FeatureKey = (typeof FEATURE_KEYS)[number];

const QUERY_PRICE_MOCK_USD = 0.50;
const TOP_N = 4;

// --- Load once at import time ---

let personasData: PersonasFile;
let featureBounds: Record<FeatureKey, FeatureBounds>;
let featureMedians: Record<FeatureKey, number>;

function loadPersonas(): void {
  const raw = readFileSync(
    path.join(process.cwd(), 'data', 'personas.json'),
    'utf8',
  );
  personasData = JSON.parse(raw) as PersonasFile;

  // Compute normalization bounds from persona set
  featureBounds = {} as Record<FeatureKey, FeatureBounds>;
  featureMedians = {} as Record<FeatureKey, number>;

  for (const key of FEATURE_KEYS) {
    const vals = personasData.personas.map((p) => p.profile[key]);
    vals.sort((a, b) => a - b);
    featureBounds[key] = {
      min: vals[0],
      max: vals[vals.length - 1],
    };
    const mid = Math.floor(vals.length / 2);
    featureMedians[key] =
      vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
  }
}

loadPersonas();

export function getPersonasData(): PersonasFile {
  return personasData;
}

// --- Extract user features from HealthSummary ---

function extractUserFeatures(
  summary: HealthSummary,
): Record<FeatureKey, number> {
  // Try common metric name variants from Health Auto Export
  const rhr =
    summary.metrics['resting_heart_rate']?.last30days?.mean ??
    summary.metrics['RestingHeartRate']?.last30days?.mean ??
    summary.metrics['heart_rate']?.last30days?.mean ??
    featureMedians.resting_hr_bpm;

  const steps =
    summary.metrics['step_count']?.last30days?.mean ??
    summary.metrics['StepCount']?.last30days?.mean ??
    summary.metrics['steps']?.last30days?.mean ??
    featureMedians.steps_daily_avg;

  // Sleep: Health Auto Export uses hours or minutes depending on config
  let sleep =
    summary.metrics['sleep_analysis']?.last30days?.mean ??
    summary.metrics['SleepAnalysis']?.last30days?.mean ??
    summary.metrics['sleep_duration']?.last30days?.mean ??
    null;
  if (sleep !== null && sleep > 24) {
    // Likely in minutes, convert to hours
    sleep = sleep / 60;
  }
  sleep = sleep ?? featureMedians.sleep_hours_avg;

  const WEEKS_IN_30D = 30 / 7;
  const activeMins = summary.workouts.totalMinutes30d / WEEKS_IN_30D;
  const workoutSessions = summary.workouts.count30d / WEEKS_IN_30D;

  return {
    resting_hr_bpm: rhr,
    steps_daily_avg: steps,
    sleep_hours_avg: sleep,
    active_minutes_weekly: activeMins,
    workout_sessions_weekly: workoutSessions,
  };
}

// --- Similarity ---

function normalize(value: number, bounds: FeatureBounds): number {
  if (bounds.max === bounds.min) return 0.5;
  const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
  return (clamped - bounds.min) / (bounds.max - bounds.min);
}

function euclideanDistance(
  a: Record<FeatureKey, number>,
  b: Record<FeatureKey, number>,
): number {
  let sumSq = 0;
  for (const key of FEATURE_KEYS) {
    const aN = normalize(a[key], featureBounds[key]);
    const bN = normalize(b[key], featureBounds[key]);
    const diff = aN - bN;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

function personaFeatures(p: Persona): Record<FeatureKey, number> {
  return {
    resting_hr_bpm: p.profile.resting_hr_bpm,
    steps_daily_avg: p.profile.steps_daily_avg,
    sleep_hours_avg: p.profile.sleep_hours_avg,
    active_minutes_weekly: p.profile.active_minutes_weekly,
    workout_sessions_weekly: p.profile.workout_sessions_weekly,
  };
}

// --- Public API ---

export function selectContributors(
  summary: HealthSummary | null,
): ContributorResult {
  if (!summary) {
    return {
      contributors: [],
      references_used: {},
      query_price_mock_usd: 0,
    };
  }

  const userFeats = extractUserFeatures(summary);

  const scored = personasData.personas.map((p) => {
    const dist = euclideanDistance(userFeats, personaFeatures(p));
    const similarity = 1 / (1 + dist);
    return { persona: p, similarity };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  const topN = scored.slice(0, TOP_N);

  const totalSim = topN.reduce((acc, s) => acc + s.similarity, 0);

  // Collect only the references used by the selected contributors
  const refsUsed: Record<string, string> = {};
  const contributors: Contributor[] = topN.map((s) => {
    const weight = totalSim > 0 ? s.similarity / totalSim : 1 / TOP_N;

    // Scan source_notes for citation keys
    for (const noteText of Object.values(s.persona.source_notes)) {
      for (const refKey of Object.keys(personasData.references)) {
        if (noteText.includes(refKey) && !refsUsed[refKey]) {
          refsUsed[refKey] = personasData.references[refKey];
        }
      }
    }

    return {
      id: s.persona.id,
      label: s.persona.label,
      narrative_summary: s.persona.narrative_summary,
      similarity_score: round(s.similarity, 3),
      context_weight: round(weight, 3),
      mock_payout_usd: round(weight * QUERY_PRICE_MOCK_USD, 3),
      address: deriveAddress(s.persona.id),
      source_notes: s.persona.source_notes,
    };
  });

  return {
    contributors,
    references_used: refsUsed,
    query_price_mock_usd: QUERY_PRICE_MOCK_USD,
  };
}

/**
 * Build the cohort context block for injection into the LLM system prompt.
 * Includes label, narrative_summary, and profile features.
 * Excludes source_notes (those are for the UI, not the model).
 */
export function buildCohortPromptBlock(contributors: Contributor[]): string {
  if (!contributors.length) return '';

  const lines = [
    '',
    '---',
    'Reference cohort for this query (' +
      contributors.length +
      ' personas selected by behavioral similarity to the user\'s profile, provided as context — NOT used for attribution of specific output tokens):',
    '',
  ];

  for (let i = 0; i < contributors.length; i++) {
    const c = contributors[i];
    // Find the full persona to get profile values
    const persona = personasData.personas.find((p) => p.id === c.id);
    if (!persona) continue;

    lines.push(
      `[${i + 1}] "${c.label}" (context weight: ${c.context_weight})`,
    );
    lines.push(`    ${c.narrative_summary}`);
    lines.push(
      `    Resting HR: ${persona.profile.resting_hr_bpm} bpm, ` +
        `Steps: ${persona.profile.steps_daily_avg}/day, ` +
        `Sleep: ${persona.profile.sleep_hours_avg}h, ` +
        `Activity: ${persona.profile.active_minutes_weekly} min/wk, ` +
        `Workouts: ${persona.profile.workout_sessions_weekly}/wk`,
    );
    lines.push('');
  }

  lines.push('CITATION RULES — follow exactly:');
  lines.push('- When you reference a specific persona\'s data point or pattern, cite it inline using the bracketed number from the list above: [1], [2], [3], [4].');
  lines.push('- Example: "Your resting HR of 62 bpm is close to the casual runner [1] at 67 bpm, and well below the sedentary office worker [4] at 75 bpm."');
  lines.push('- Only cite a persona when you are directly referencing its data. General health statements (e.g., "adults should aim for 7-9 hours of sleep") get NO citation — they are not anchored to a specific contributor.');
  lines.push('- Never cite a number outside [1]-[' + contributors.length + ']. If you cannot anchor a claim to a specific contributor, do not cite.');
  lines.push('- Do not cluster all citations at the end. Place each [N] immediately after the claim it supports, mid-sentence.');
  lines.push('- Do not fabricate cohort comparisons — use only the personas listed above.');
  lines.push('---');

  return lines.join('\n');
}

function round(n: number, places: number): number {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}
