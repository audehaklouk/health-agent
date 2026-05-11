/**
 * Parser for the JSON output of "Health Auto Export" iOS app.
 *
 * Expected shape (verify against the current export format):
 *   {
 *     "data": {
 *       "metrics":  [ { "name": "...", "units": "...", "data": [{ "date": "...", "qty"|"Avg": ... }, ...] }, ... ],
 *       "workouts": [ { "name": "...", "start": "...", "end": "...", "duration": <seconds>, ... }, ... ]
 *     }
 *   }
 *
 * We aggressively summarize on ingest because the LLM context budget is small.
 * Raw is also stored (encrypted) for future detail queries.
 */

export interface ParsedHealth {
  totalRecords: number;
  summary: HealthSummary;
  raw: unknown;
}

export interface HealthSummary {
  windows: { from: string; to: string };
  metrics: Record<string, MetricSummary>;
  workouts: WorkoutSummary;
}

export interface MetricSummary {
  unit: string;
  count: number;
  last7days?: { mean: number; min: number; max: number };
  last30days?: { mean: number; min: number; max: number };
  recent7?: { date: string; value: number }[];
}

export interface WorkoutSummary {
  count30d: number;
  totalMinutes30d: number;
  byType30d: Record<string, { count: number; minutes: number }>;
}

interface RawSample {
  date: string;
  qty?: number;
  Avg?: number;
}

interface RawMetric {
  name: string;
  units?: string;
  data?: RawSample[];
}

interface RawWorkout {
  name?: string;
  type?: string;
  start: string;
  end?: string;
  duration?: number;
}

const MS_DAY = 24 * 60 * 60 * 1000;

export function parseAppleHealthExport(json: unknown): ParsedHealth {
  if (!json || typeof json !== 'object') {
    throw new Error('upload body must be a JSON object');
  }

  const root: { data?: { metrics?: RawMetric[]; workouts?: RawWorkout[] } } =
    'data' in (json as Record<string, unknown>)
      ? (json as { data?: { metrics?: RawMetric[]; workouts?: RawWorkout[] } })
      : (json as { data?: { metrics?: RawMetric[]; workouts?: RawWorkout[] } });
  const inner = root.data ?? (root as unknown as { metrics?: RawMetric[]; workouts?: RawWorkout[] });

  const metrics: RawMetric[] = inner.metrics ?? [];
  const workouts: RawWorkout[] = inner.workouts ?? [];

  const now = Date.now();
  const ms7 = 7 * MS_DAY;
  const ms30 = 30 * MS_DAY;

  const metricSummaries: Record<string, MetricSummary> = {};
  let totalRecords = 0;

  for (const metric of metrics) {
    const name = metric.name;
    if (!name) continue;
    const samples = metric.data ?? [];
    totalRecords += samples.length;

    const points = samples
      .map((s) => ({
        t: new Date(s.date).getTime(),
        v: typeof s.qty === 'number' ? s.qty : typeof s.Avg === 'number' ? s.Avg : NaN,
      }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);

    const aggregate = (cutoffMs: number) => {
      const inWin = points.filter((p) => now - p.t <= cutoffMs);
      if (!inWin.length) return undefined;
      let sum = 0, lo = Infinity, hi = -Infinity;
      for (const p of inWin) {
        sum += p.v;
        if (p.v < lo) lo = p.v;
        if (p.v > hi) hi = p.v;
      }
      return {
        mean: round(sum / inWin.length, 2),
        min: round(lo, 2),
        max: round(hi, 2),
      };
    };

    metricSummaries[name] = {
      unit: metric.units ?? '',
      count: samples.length,
      last7days: aggregate(ms7),
      last30days: aggregate(ms30),
      recent7: points.slice(-7).map((p) => ({
        date: new Date(p.t).toISOString().slice(0, 10),
        value: round(p.v, 2),
      })),
    };
  }

  const w30 = workouts.filter(
    (w) => now - new Date(w.start).getTime() <= ms30,
  );
  const byType: Record<string, { count: number; minutes: number }> = {};
  for (const w of w30) {
    const type = w.name || w.type || 'Other';
    if (!byType[type]) byType[type] = { count: 0, minutes: 0 };
    byType[type].count++;
    byType[type].minutes += round(Number(w.duration ?? 0) / 60, 1);
  }
  totalRecords += workouts.length;

  let minDate = Infinity, maxDate = -Infinity, dateCount = 0;
  for (const m of metrics) {
    for (const s of m.data ?? []) {
      const t = new Date(s.date).getTime();
      if (Number.isFinite(t)) { dateCount++; if (t < minDate) minDate = t; if (t > maxDate) maxDate = t; }
    }
  }
  for (const w of workouts) {
    const t = new Date(w.start).getTime();
    if (Number.isFinite(t)) { dateCount++; if (t < minDate) minDate = t; if (t > maxDate) maxDate = t; }
  }

  const from = dateCount ? new Date(minDate).toISOString() : new Date(0).toISOString();
  const to = dateCount ? new Date(maxDate).toISOString() : new Date().toISOString();

  return {
    totalRecords,
    summary: {
      windows: { from, to },
      metrics: metricSummaries,
      workouts: {
        count30d: w30.length,
        totalMinutes30d: round(
          w30.reduce((acc, w) => acc + Number(w.duration ?? 0) / 60, 0),
          1,
        ),
        byType30d: byType,
      },
    },
    raw: json,
  };
}

function round(n: number, places: number): number {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}
