export interface TraceMapping {
  cityId: number;
  networkId: string;
}

export interface TraceEntry {
  at: string;
  elapsedMs: number;
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface AvailabilityTrace {
  version: 1;
  startedAt: string;
  durationMs: number;
  mappings: TraceMapping[];
  entries: TraceEntry[];
}

export interface ReplayResult {
  policy: 'adaptive' | 'fixed';
  requests: number;
  requestsUsed: number;
  successfulRequests: number;
  failedRequests: number;
  redundantFetchRatio: number;
  completeObservations: number;
  coverage: number;
  meanFreshnessSeconds: number;
  meanStalenessSeconds: number;
  p95StalenessSeconds: number;
  r5WindowCompliance: number;
  meanAbsoluteError: number;
  peakRequestsPerSecond: number;
}

export interface ComparisonReport {
  traceDurationSeconds: number;
  requestBudget: number;
  adaptive: ReplayResult;
  fixed: ReplayResult;
  wins: string[];
  losses: Array<{ metric: string; explanation: string }>;
  targetMet: boolean;
}

export interface LiveFetch {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface TraceCityBikesClient {
  listNetworks(): Promise<unknown[]>;
  getNetwork(networkId: string): Promise<unknown>;
  getRateLimit(): TraceCityBikesRateLimit;
}

export interface TraceCityBikesRateLimit {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface Observation {
  cityId: number;
  takenMs: number;
  value: number;
}
