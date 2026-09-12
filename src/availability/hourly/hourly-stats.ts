/**
 * Pure implementation of the binding hourly-average definitions:
 *
 * - Observation: a measurement of a city's total free bikes at an instant t.
 * - Validity: an observation taken at t describes the city for [t, t + maxStaleness).
 *   After that it expires.
 * - Value at an instant: the most recent non-expired observation at or before it.
 * - Covered seconds: seconds of the hour for which a non-expired observation exists.
 *   An observation taken before the hour still covers the beginning of the hour.
 *   Validity is clipped at the hour boundary.
 * - Hourly average: integral of the value over covered seconds / covered seconds.
 *   Uncovered seconds are excluded from both. No coverage -> no average (null).
 * - Coverage: coveredSeconds / 3600; below 0.75 the hour is partial.
 *
 * Hours are UTC. The golden test vector lives in hourly-stats.spec.ts.
 */

export interface ObservationPoint {
  /** Unix seconds when the observation was taken. */
  t: number;
  /** Total free bikes measured for the city. */
  value: number;
}

export interface HourlyStats {
  coveredSeconds: number;
  /** Integral over covered seconds / covered seconds, rounded to 2 dp. */
  avgFreeBikes: number;
  /** coveredSeconds / hourSeconds, rounded to 4 dp. */
  coverage: number;
  /** true when raw coverage is below the 0.75 threshold. */
  partial: boolean;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function computeHourlyStats(
  observations: ObservationPoint[],
  hourStart: number,
  maxStalenessSeconds: number,
  hourSeconds = 3600,
  partialCoverageThreshold = 0.75,
): HourlyStats | null {
  const hourEnd = hourStart + hourSeconds;

  // Only observations that can cover some instant of the hour:
  // taken before the hour ends and still valid after the hour starts.
  const relevant = observations
    .filter((o) => o.t < hourEnd && o.t + maxStalenessSeconds > hourStart)
    .sort((a, b) => a.t - b.t);

  let coveredSeconds = 0;
  let integral = 0;
  let cursor = hourStart;
  let active: { value: number; expiresAt: number } | null = null;
  let idx = 0;

  // Value at the start of the hour: latest observation at or before hourStart.
  while (idx < relevant.length && relevant[idx].t <= hourStart) {
    active = {
      value: relevant[idx].value,
      expiresAt: relevant[idx].t + maxStalenessSeconds,
    };
    idx++;
  }

  // Sweep the hour. The value only changes at observation instants and at the
  // expiry instant of the currently active observation.
  while (cursor < hourEnd) {
    if (!active) {
      if (idx >= relevant.length) break; // nothing covers the rest of the hour
      const o = relevant[idx++];
      active = { value: o.value, expiresAt: o.t + maxStalenessSeconds };
      cursor = Math.max(cursor, o.t);
      continue;
    }

    const nextObsAt = idx < relevant.length ? relevant[idx].t : Infinity;
    const end = Math.min(active.expiresAt, nextObsAt, hourEnd);
    if (end > cursor) {
      coveredSeconds += end - cursor;
      integral += active.value * (end - cursor);
      cursor = end;
    }
    if (cursor >= hourEnd) break;

    if (nextObsAt <= cursor) {
      // A newer observation takes over (observations "at" an instant count).
      const o = relevant[idx++];
      active = { value: o.value, expiresAt: o.t + maxStalenessSeconds };
    } else if (active.expiresAt <= cursor) {
      active = null; // expired: uncovered gap until the next observation
    }
  }

  if (coveredSeconds === 0) return null;

  const rawCoverage = coveredSeconds / hourSeconds;
  return {
    coveredSeconds,
    avgFreeBikes: roundTo(integral / coveredSeconds, 2),
    coverage: roundTo(rawCoverage, 4),
    partial: rawCoverage < partialCoverageThreshold,
  };
}
