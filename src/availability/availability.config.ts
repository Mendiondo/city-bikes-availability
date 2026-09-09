export interface AvailabilityConfig {
  /** Base URL of the CityBikes API (no trailing slash). */
  baseUrl: string;
  /** Seconds an observation stays valid after it was taken. Default 900. */
  maxStalenessSeconds: number;
  /** Nominal seconds between poll cycles (random jitter is added). Default 300. */
  pollIntervalSeconds: number;
  /** Max random extra delay between poll cycles, seconds. Default 30. */
  pollJitterSeconds: number;
  /** Pause between consecutive provider requests inside one cycle, ms. Default 250. */
  pollSpacingMs: number;
  /** Per-request timeout, ms. Default 10000. */
  requestTimeoutMs: number;
  /** Master switch for the background poller. */
  pollingEnabled: boolean;
  /** Master switch for the hourly aggregation loop. */
  aggregationEnabled: boolean;
  /** Hours with coverage below this are flagged partial. Binding: 0.75. */
  partialCoverageThreshold: number;
}

export const AVAILABILITY_CONFIG = 'AVAILABILITY_CONFIG';

const positiveInt = (
  env: NodeJS.ProcessEnv,
  name: string,
  dflt: number,
): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
};

const boolEnv = (raw: string | undefined, dflt: boolean): boolean => {
  if (raw === undefined || raw.trim() === '') return dflt;
  return raw === 'true' || raw === '1';
};

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AvailabilityConfig {
  // Background loops default to off under tests (jest sets NODE_ENV=test).
  const testEnv = env.NODE_ENV === 'test';
  return {
    baseUrl: (env.CITYBIKES_BASE_URL ?? 'https://api.citybik.es/v2').replace(
      /\/+$/,
      '',
    ),
    maxStalenessSeconds: positiveInt(env, 'MAX_STALENESS_SECONDS', 900),
    pollIntervalSeconds: positiveInt(env, 'POLL_INTERVAL_SECONDS', 300),
    pollJitterSeconds: positiveInt(env, 'POLL_JITTER_SECONDS', 30),
    pollSpacingMs: positiveInt(env, 'POLL_SPACING_MS', 250),
    requestTimeoutMs: positiveInt(env, 'REQUEST_TIMEOUT_MS', 10_000),
    pollingEnabled: boolEnv(env.POLLING_ENABLED, !testEnv),
    aggregationEnabled: boolEnv(env.AGGREGATION_ENABLED, !testEnv),
    partialCoverageThreshold: 0.75,
  };
}
