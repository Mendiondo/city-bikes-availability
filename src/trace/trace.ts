import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { networkDetailResponseSchema } from '../availability/citybikes/citybikes.schemas';
import type {
  AvailabilityTrace,
  ComparisonReport,
  Observation,
  ReplayResult,
  TraceEntry,
  TraceCityBikesClient,
  TraceCityBikesRateLimit,
  TraceMapping,
} from './trace.interface';

export async function readTrace(path: string): Promise<AvailabilityTrace> {
  const trace = JSON.parse(await readFile(path, 'utf8')) as AvailabilityTrace;
  if (trace.version !== 1 || !Array.isArray(trace.entries)) {
    throw new Error(`Unsupported or invalid trace file: ${path}`);
  }
  return trace;
}

export async function writeTrace(
  path: string,
  trace: AvailabilityTrace,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
}

export async function recordTrace(options: {
  output: string;
  mappings: TraceMapping[];
  durationMs: number;
  baseUrl: string;
  client: TraceCityBikesClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  includeNetworkList?: boolean;
}): Promise<AvailabilityTrace> {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedEpochMs = now();
  const trace: AvailabilityTrace = {
    version: 1,
    startedAt: new Date(startedEpochMs).toISOString(),
    durationMs: options.durationMs,
    mappings: options.mappings,
    entries: [],
  };

  const record = async (url: string, bodyFactory: () => Promise<unknown>) => {
    const fetchedAt = now();
    let body: unknown;
    let status = 200;
    try {
      body = await bodyFactory();
    } catch (error) {
      status = 0;
      body = { error: error instanceof Error ? error.message : String(error) };
    }
    const rateLimit = options.client.getRateLimit();
    trace.entries.push({
      at: new Date(fetchedAt).toISOString(),
      elapsedMs: fetchedAt - startedEpochMs,
      method: 'GET',
      url,
      status,
      headers: {
        'ratelimit-limit': String(rateLimit.limit),
        'ratelimit-remaining': String(rateLimit.remaining),
        'ratelimit-reset': String(rateLimit.resetSeconds),
      },
      body,
    });
  };

  if (options.includeNetworkList) {
    await record(`${options.baseUrl}/networks`, async () => ({
      networks: await options.client.listNetworks(),
    }));
  }

  const end = startedEpochMs + options.durationMs;
  while (now() <= end) {
    for (const mapping of options.mappings) {
      await record(
        `${options.baseUrl}/networks/${encodeURIComponent(mapping.networkId)}`,
        async () => ({
          network: await options.client.getNetwork(mapping.networkId),
        }),
      );
    }
    if (now() >= end) break;
    await sleep(rateLimitDelayMs(options.client.getRateLimit()));
  }
  trace.durationMs = Math.max(0, now() - startedEpochMs);
  await writeTrace(options.output, trace);
  return trace;
}

function rateLimitDelayMs(rateLimit: TraceCityBikesRateLimit): number {
  if (rateLimit.remaining <= 0)
    return Math.max(1000, rateLimit.resetSeconds * 1000);
  return Math.max(
    1,
    Math.ceil((rateLimit.resetSeconds * 1000) / rateLimit.remaining),
  );
}

function rateLimitDelayAt(trace: AvailabilityTrace, virtualMs: number): number {
  const latest = trace.entries
    .filter((entry) => entry.elapsedMs <= virtualMs)
    .at(-1);
  if (!latest) return 1000;
  return rateLimitDelayMs({
    limit: headerNumber(latest, 'ratelimit-limit', 1),
    remaining: headerNumber(latest, 'ratelimit-remaining', 0),
    resetSeconds: headerNumber(latest, 'ratelimit-reset', 1),
  });
}

function headerNumber(
  entry: TraceEntry,
  name: string,
  fallback: number,
): number {
  const value = Number(entry.headers[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function responseFor(
  trace: AvailabilityTrace,
  url: string,
  virtualMs: number,
): TraceEntry | undefined {
  const candidates = trace.entries.filter(
    (entry) => entry.url === url && entry.elapsedMs <= virtualMs,
  );
  return candidates.at(-1);
}

function responseValue(
  trace: AvailabilityTrace,
  mapping: TraceMapping,
  virtualMs: number,
  baseUrl: string,
): number | undefined {
  const entry = responseFor(
    trace,
    `${baseUrl}/networks/${encodeURIComponent(mapping.networkId)}`,
    virtualMs,
  );
  if (!entry || entry.status < 200 || entry.status >= 300) return undefined;
  return valueFromEntry(entry);
}

function valueFromEntry(entry: TraceEntry): number | undefined {
  const parsed = networkDetailResponseSchema.safeParse(entry.body);
  if (!parsed.success) return undefined;
  return (parsed.data.network.stations ?? []).reduce(
    (sum, station) => sum + (station.free_bikes ?? 0),
    0,
  );
}

interface TraceRequest {
  networkId: string;
  atMs: number;
  value: number | undefined;
}

function coverageAndFreshness(
  observations: Observation[],
  durationMs: number,
  maxStalenessMs: number,
): { coverage: number; meanFreshnessSeconds: number } {
  const byCity = new Map<number, Observation[]>();
  for (const observation of observations) {
    const list = byCity.get(observation.cityId) ?? [];
    list.push(observation);
    byCity.set(observation.cityId, list);
  }
  let coveredMs = 0;
  let freshnessArea = 0;
  let cityCount = 0;
  for (const cityObservations of byCity.values()) {
    cityCount++;
    cityObservations.sort((a, b) => a.takenMs - b.takenMs);
    for (let index = 0; index < cityObservations.length; index++) {
      const start = Math.max(0, cityObservations[index].takenMs);
      const end = Math.min(
        durationMs,
        cityObservations[index].takenMs + maxStalenessMs,
        cityObservations[index + 1]?.takenMs ?? durationMs,
      );
      if (end <= start) continue;
      const length = end - start;
      coveredMs += length;
      freshnessArea += (length * length) / 2;
    }
  }
  const denominator = Math.max(1, cityCount * durationMs);
  return {
    coverage: coveredMs / denominator,
    meanFreshnessSeconds:
      coveredMs === 0 ? 0 : freshnessArea / coveredMs / 1000,
  };
}

export function replayTrace(options: {
  trace: AvailabilityTrace;
  policy: 'adaptive' | 'fixed';
  baseUrl: string;
  maxStalenessMs: number;
  requestBudget: number;
  random?: () => number;
}): ReplayResult {
  const random = options.random ?? (() => 0.5);
  const failures = new Map<string, number>();
  const backoffUntil = new Map<string, number>();
  const observations: Observation[] = [];
  const requests: TraceRequest[] = [];
  const lastNetworkValues = new Map<string, number>();
  let redundantFetches = 0;
  let virtualMs = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  let completeObservations = 0;

  while (
    virtualMs <= options.trace.durationMs &&
    requests.length < options.requestBudget
  ) {
    let lastRequestMs = virtualMs;
    for (const cityId of new Set(
      options.trace.mappings.map((mapping) => mapping.cityId),
    )) {
      const cityMappings = options.trace.mappings.filter(
        (mapping) => mapping.cityId === cityId,
      );
      let successful = 0;
      let lastSuccessMs = virtualMs;
      for (const mapping of cityMappings) {
        if (requests.length > 0) {
          lastRequestMs += rateLimitDelayAt(options.trace, lastRequestMs);
        }
        if (requests.length >= options.requestBudget) break;
        const blockedUntil = backoffUntil.get(mapping.networkId) ?? -1;
        if (options.policy === 'adaptive' && blockedUntil > virtualMs) continue;
        const requestMs = lastRequestMs;
        const value = responseValue(
          options.trace,
          mapping,
          requestMs,
          options.baseUrl,
        );
        requests.push({ networkId: mapping.networkId, atMs: requestMs, value });
        if (value === undefined) {
          failedRequests++;
          if (options.policy === 'adaptive') {
            const count = (failures.get(mapping.networkId) ?? 0) + 1;
            failures.set(mapping.networkId, count);
            backoffUntil.set(
              mapping.networkId,
              requestMs +
                rateLimitDelayAt(options.trace, requestMs) * 2 ** (count - 1),
            );
          }
          continue;
        }
        if (lastNetworkValues.get(mapping.networkId) === value) {
          redundantFetches++;
        }
        lastNetworkValues.set(mapping.networkId, value);
        successfulRequests++;
        successful++;
        lastSuccessMs = requestMs;
        failures.delete(mapping.networkId);
        backoffUntil.delete(mapping.networkId);
      }
      if (successful === cityMappings.length && successful > 0) {
        observations.push({
          cityId,
          takenMs: lastSuccessMs,
          value: cityMappings.reduce(
            (sum, mapping) =>
              sum + (lastNetworkValues.get(mapping.networkId) ?? 0),
            0,
          ),
        });
        completeObservations++;
      }
    }
    virtualMs += rateLimitDelayAt(options.trace, virtualMs);
    if (options.policy === 'adaptive') virtualMs += Math.floor(random() * 1000);
  }

  const quality = coverageAndFreshness(
    observations,
    options.trace.durationMs,
    options.maxStalenessMs,
  );
  const secondBuckets = new Map<number, number>();
  for (const request of requests) {
    const time = request.atMs;
    const second = Math.floor(time / 1000);
    secondBuckets.set(second, (secondBuckets.get(second) ?? 0) + 1);
  }
  return {
    policy: options.policy,
    requests: requests.length,
    requestsUsed: requests.length,
    successfulRequests,
    failedRequests,
    redundantFetchRatio:
      requests.length === 0 ? 0 : redundantFetches / requests.length,
    completeObservations,
    ...quality,
    ...replayMetrics(
      options.trace,
      observations,
      options.maxStalenessMs,
      options.baseUrl,
    ),
    peakRequestsPerSecond: Math.max(0, ...secondBuckets.values()),
  };
}

function replayMetrics(
  trace: AvailabilityTrace,
  observations: Observation[],
  maxStalenessMs: number,
  baseUrl: string,
): Pick<
  ReplayResult,
  | 'meanStalenessSeconds'
  | 'p95StalenessSeconds'
  | 'r5WindowCompliance'
  | 'meanAbsoluteError'
> {
  const cityIds = new Set(trace.mappings.map((mapping) => mapping.cityId));
  const staleness = stalenessMetrics(observations, cityIds, trace.durationMs);
  return {
    ...staleness,
    r5WindowCompliance: r5Compliance(observations, cityIds, trace.durationMs),
    meanAbsoluteError: hourlyMeanAbsoluteError(
      trace,
      observations,
      maxStalenessMs,
      baseUrl,
    ),
  };
}

function stalenessMetrics(
  observations: Observation[],
  cityIds: Set<number>,
  durationMs: number,
): { meanStalenessSeconds: number; p95StalenessSeconds: number } {
  const segments: Array<{ ageMs: number; durationMs: number }> = [];
  for (const cityId of cityIds) {
    const cityObservations = observations
      .filter((observation) => observation.cityId === cityId)
      .sort((a, b) => a.takenMs - b.takenMs);
    const boundaries = [
      0,
      ...cityObservations.map((observation) =>
        Math.min(durationMs, Math.max(0, observation.takenMs)),
      ),
      durationMs,
    ];
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (end <= start) continue;
      const latest = [...cityObservations]
        .reverse()
        .find((observation) => observation.takenMs <= start);
      segments.push({
        ageMs: latest === undefined ? start : start - latest.takenMs,
        durationMs: end - start,
      });
    }
  }
  const totalMs = segments.reduce(
    (sum, segment) => sum + segment.durationMs,
    0,
  );
  if (totalMs === 0) {
    return { meanStalenessSeconds: 0, p95StalenessSeconds: 0 };
  }
  const meanMs =
    segments.reduce(
      (sum, segment) => sum + segment.ageMs * segment.durationMs,
      0,
    ) / totalMs;
  const target = totalMs * 0.95;
  let accumulated = 0;
  let p95Ms = 0;
  for (const segment of [...segments].sort((a, b) => a.ageMs - b.ageMs)) {
    accumulated += segment.durationMs;
    if (accumulated >= target) {
      p95Ms = segment.ageMs;
      break;
    }
  }
  return {
    meanStalenessSeconds: meanMs / 1000,
    p95StalenessSeconds: p95Ms / 1000,
  };
}

function r5Compliance(
  observations: Observation[],
  cityIds: Set<number>,
  durationMs: number,
): number {
  const windowMs = 300_000;
  const windows = Math.ceil(durationMs / windowMs);
  if (windows === 0 || cityIds.size === 0) return 0;
  let covered = 0;
  for (const cityId of cityIds) {
    covered += new Set(
      observations
        .filter((observation) => observation.cityId === cityId)
        .map((observation) => Math.floor(observation.takenMs / windowMs)),
    ).size;
  }
  return covered / (windows * cityIds.size);
}

interface HourlyAccumulator {
  area: number;
  coveredMs: number;
}

function hourlyMeanAbsoluteError(
  trace: AvailabilityTrace,
  observations: Observation[],
  maxStalenessMs: number,
  baseUrl: string,
): number {
  const truth = hourlyTruth(trace, baseUrl);
  const stored = hourlyStored(observations, trace.durationMs, maxStalenessMs);
  const errors: number[] = [];
  for (const [key, expected] of truth) {
    const actual = stored.get(key);
    if (
      actual === undefined ||
      expected.coveredMs === 0 ||
      actual.coveredMs === 0
    ) {
      continue;
    }
    errors.push(
      Math.abs(
        expected.area / expected.coveredMs - actual.area / actual.coveredMs,
      ),
    );
  }
  return errors.length === 0
    ? 0
    : errors.reduce((sum, error) => sum + error, 0) / errors.length;
}

function hourlyTruth(
  trace: AvailabilityTrace,
  baseUrl: string,
): Map<string, HourlyAccumulator> {
  const result = new Map<string, HourlyAccumulator>();
  for (const cityId of new Set(
    trace.mappings.map((mapping) => mapping.cityId),
  )) {
    const mappings = trace.mappings.filter(
      (mapping) => mapping.cityId === cityId,
    );
    const values = new Map<string, number>();
    const events = trace.entries
      .map((entry) => ({
        entry,
        mapping: mappings.find(
          (mapping) =>
            entry.url ===
            `${baseUrl}/networks/${encodeURIComponent(mapping.networkId)}`,
        ),
      }))
      .filter(
        (event): event is { entry: TraceEntry; mapping: TraceMapping } =>
          event.mapping !== undefined &&
          event.entry.status >= 200 &&
          event.entry.status < 300,
      )
      .sort((a, b) => a.entry.elapsedMs - b.entry.elapsedMs);
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      const value = valueFromEntry(event.entry);
      if (value === undefined) continue;
      values.set(event.mapping.networkId, value);
      if (values.size !== mappings.length) continue;
      addHourlySegment(
        result,
        cityId,
        event.entry.elapsedMs,
        events[index + 1]?.entry.elapsedMs ?? trace.durationMs,
        [...values.values()].reduce((sum, item) => sum + item, 0),
      );
    }
  }
  return result;
}

function hourlyStored(
  observations: Observation[],
  durationMs: number,
  maxStalenessMs: number,
): Map<string, HourlyAccumulator> {
  const result = new Map<string, HourlyAccumulator>();
  for (const cityId of new Set(
    observations.map((observation) => observation.cityId),
  )) {
    const cityObservations = observations
      .filter((observation) => observation.cityId === cityId)
      .sort((a, b) => a.takenMs - b.takenMs);
    for (let index = 0; index < cityObservations.length; index++) {
      const observation = cityObservations[index];
      addHourlySegment(
        result,
        cityId,
        observation.takenMs,
        Math.min(
          durationMs,
          observation.takenMs + maxStalenessMs,
          cityObservations[index + 1]?.takenMs ?? durationMs,
        ),
        observation.value,
      );
    }
  }
  return result;
}

function addHourlySegment(
  result: Map<string, HourlyAccumulator>,
  cityId: number,
  startMs: number,
  endMs: number,
  value: number,
): void {
  const hourMs = 3_600_000;
  for (
    let hourStart = Math.floor(startMs / hourMs) * hourMs;
    hourStart < endMs;
    hourStart += hourMs
  ) {
    const overlap = Math.max(
      0,
      Math.min(endMs, hourStart + hourMs) - Math.max(startMs, hourStart),
    );
    if (overlap === 0) continue;
    const key = `${cityId}:${hourStart}`;
    const current = result.get(key) ?? { area: 0, coveredMs: 0 };
    current.area += value * overlap;
    current.coveredMs += overlap;
    result.set(key, current);
  }
}

export function compareTrace(options: {
  trace: AvailabilityTrace;
  baseUrl: string;
  maxStalenessMs: number;
  requestBudget?: number;
}): ComparisonReport {
  const naturalBudget = Math.max(1, options.trace.mappings.length);
  const requestBudget = options.requestBudget ?? naturalBudget;
  const common = { ...options, requestBudget };
  const adaptive = replayTrace({ ...common, policy: 'adaptive' });
  const fixed = replayTrace({ ...common, policy: 'fixed' });
  const wins: string[] = [];
  const losses: Array<{ metric: string; explanation: string }> = [];
  if (adaptive.requestsUsed < fixed.requestsUsed) wins.push('requests used');
  else if (adaptive.requestsUsed > fixed.requestsUsed) {
    losses.push({
      metric: 'requests used',
      explanation:
        'The adaptive policy consumed more upstream requests under the shared budget.',
    });
  }
  if (adaptive.meanStalenessSeconds < fixed.meanStalenessSeconds)
    wins.push('mean staleness');
  else if (adaptive.meanStalenessSeconds > fixed.meanStalenessSeconds) {
    losses.push({
      metric: 'mean staleness',
      explanation: 'The fixed policy kept observations newer over this trace.',
    });
  }
  if (adaptive.p95StalenessSeconds < fixed.p95StalenessSeconds)
    wins.push('p95 staleness');
  else if (adaptive.p95StalenessSeconds > fixed.p95StalenessSeconds) {
    losses.push({
      metric: 'p95 staleness',
      explanation: 'The fixed policy had a lower worst-case staleness tail.',
    });
  }
  if (adaptive.redundantFetchRatio < fixed.redundantFetchRatio)
    wins.push('redundant fetch ratio');
  else if (adaptive.redundantFetchRatio > fixed.redundantFetchRatio) {
    losses.push({
      metric: 'redundant fetch ratio',
      explanation:
        'The adaptive policy repeated unchanged network values more often.',
    });
  }
  if (adaptive.r5WindowCompliance > fixed.r5WindowCompliance)
    wins.push('R5 window compliance');
  else if (adaptive.r5WindowCompliance < fixed.r5WindowCompliance) {
    losses.push({
      metric: 'R5 window compliance',
      explanation: 'The fixed policy populated more five-minute city windows.',
    });
  }
  if (adaptive.meanAbsoluteError < fixed.meanAbsoluteError)
    wins.push('mean absolute error');
  else if (adaptive.meanAbsoluteError > fixed.meanAbsoluteError) {
    losses.push({
      metric: 'mean absolute error',
      explanation:
        'The fixed policy tracked the trace ground truth more closely.',
    });
  }
  if (adaptive.coverage > fixed.coverage) wins.push('coverage');
  else if (adaptive.coverage < fixed.coverage) {
    losses.push({
      metric: 'coverage',
      explanation:
        'The fixed policy polls without adaptive backoff, so it can retain more successful observations during failures.',
    });
  }
  if (adaptive.meanFreshnessSeconds < fixed.meanFreshnessSeconds)
    wins.push('freshness');
  else if (adaptive.meanFreshnessSeconds > fixed.meanFreshnessSeconds) {
    losses.push({
      metric: 'freshness',
      explanation:
        'The fixed policy uses a steadier cadence; jitter can delay the next successful observation.',
    });
  }
  if (adaptive.failedRequests < fixed.failedRequests)
    wins.push('failed request pressure');
  else if (adaptive.failedRequests > fixed.failedRequests) {
    losses.push({
      metric: 'failed request pressure',
      explanation:
        'The adaptive policy made more requests while the trace was returning failures.',
    });
  }
  if (adaptive.peakRequestsPerSecond < fixed.peakRequestsPerSecond)
    wins.push('request burstiness');
  else if (adaptive.peakRequestsPerSecond > fixed.peakRequestsPerSecond) {
    losses.push({
      metric: 'request burstiness',
      explanation:
        'The adaptive schedule produced a larger one-second request bucket in this trace.',
    });
  }
  return {
    traceDurationSeconds: options.trace.durationMs / 1000,
    requestBudget,
    adaptive,
    fixed,
    wins,
    losses,
    targetMet: wins.length >= 2,
  };
}
