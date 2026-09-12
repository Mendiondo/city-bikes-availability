import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareTrace, recordTrace, replayTrace } from './trace';
import type { AvailabilityTrace } from './trace.interface';

const detail = (freeBikes: number) => ({
  network: {
    id: 'net-a',
    stations: [{ id: 'station-a', free_bikes: freeBikes }],
  },
});

const trace: AvailabilityTrace = {
  version: 1,
  startedAt: '2026-09-11T00:00:00.000Z',
  durationMs: 120_000,
  mappings: [
    { cityId: 1, networkId: 'net-a' },
    { cityId: 1, networkId: 'net-b' },
  ],
  entries: [
    {
      at: '2026-09-11T00:00:00.000Z',
      elapsedMs: 0,
      method: 'GET',
      url: 'https://example.test/networks/net-a',
      status: 200,
      headers: { etag: 'a' },
      body: detail(10),
    },
    {
      at: '2026-09-11T00:00:00.000Z',
      elapsedMs: 0,
      method: 'GET',
      url: 'https://example.test/networks/net-b',
      status: 200,
      headers: {},
      body: {
        network: { id: 'net-b', stations: [{ id: 'b', free_bikes: 5 }] },
      },
    },
    {
      at: '2026-09-11T00:01:00.000Z',
      elapsedMs: 60_000,
      method: 'GET',
      url: 'https://example.test/networks/net-a',
      status: 200,
      headers: { etag: 'b' },
      body: detail(20),
    },
    {
      at: '2026-09-11T00:01:00.000Z',
      elapsedMs: 60_000,
      method: 'GET',
      url: 'https://example.test/networks/net-b',
      status: 200,
      headers: {},
      body: {
        network: { id: 'net-b', stations: [{ id: 'b', free_bikes: 5 }] },
      },
    },
  ],
};

describe('trace tooling', () => {
  it('records raw response metadata and writes a replayable trace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'city-bikes-trace-'));
    const output = join(directory, 'trace.json');
    const recorded = await recordTrace({
      output,
      mappings: [{ cityId: 1, networkId: 'net-a' }],
      durationMs: 0,
      baseUrl: 'https://example.test',
      includeNetworkList: true,
      now: () => 1_000_000,
      client: {
        listNetworks: () => Promise.resolve([]),
        getNetwork: () => Promise.resolve(detail(10).network),
        getRateLimit: () => ({ limit: 100, remaining: 99, resetSeconds: 1 }),
      },
    });
    const persisted = JSON.parse(
      await readFile(output, 'utf8'),
    ) as AvailabilityTrace;
    expect(recorded.entries).toHaveLength(2);
    expect(persisted.entries[1]).toMatchObject({
      status: 200,
      headers: {
        'ratelimit-limit': '100',
        'ratelimit-remaining': '99',
        'ratelimit-reset': '1',
      },
      body: detail(10),
    });
    await rm(directory, { recursive: true, force: true });
  });

  it('replays the same trace deterministically under a virtual clock', () => {
    const options = {
      trace,
      policy: 'adaptive' as const,
      baseUrl: 'https://example.test',
      maxStalenessMs: 60_000,
      requestBudget: 4,
      random: () => 0.5,
    };
    expect(replayTrace(options)).toEqual(replayTrace(options));
    expect(replayTrace(options)).toMatchObject({
      requests: 4,
      requestsUsed: 4,
      successfulRequests: 4,
      redundantFetchRatio: 0.5,
      completeObservations: 2,
    });
    expect(replayTrace(options).coverage).toBeGreaterThan(0.5);
    expect(replayTrace(options).meanStalenessSeconds).toBeGreaterThanOrEqual(0);
    expect(replayTrace(options).p95StalenessSeconds).toBeGreaterThanOrEqual(0);
    expect(replayTrace(options).r5WindowCompliance).toBeGreaterThanOrEqual(0);
    expect(replayTrace(options).meanAbsoluteError).toBeGreaterThanOrEqual(0);
  });

  it('compares both policies under one request budget', () => {
    const report = compareTrace({
      trace,
      baseUrl: 'https://example.test',
      maxStalenessMs: 60_000,
      requestBudget: 4,
    });
    expect(report.requestBudget).toBe(4);
    expect(report.adaptive.requests).toBe(report.fixed.requests);
    expect(report.adaptive.peakRequestsPerSecond).toBe(
      report.fixed.peakRequestsPerSecond,
    );
  });
});
