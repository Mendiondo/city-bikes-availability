import { jest } from '@jest/globals';
import { AvailabilityConfig } from '../availability.config';
import { CityBikesClient } from '../citybikes/citybikes.client';
import { NetworkMapping } from '../entities/network-mapping.entity';
import { PollerService } from './poller.service';

const config: AvailabilityConfig = {
  baseUrl: 'https://example.test',
  maxStalenessSeconds: 900,
  requestTimeoutMs: 1000,
  pollingEnabled: false,
  aggregationEnabled: false,
  partialCoverageThreshold: 0.75,
};

const mappings: Array<Pick<NetworkMapping, 'cityId' | 'networkId'>> = [
  { cityId: 1, networkId: 'net-a' },
  { cityId: 1, networkId: 'net-b' },
  { cityId: 2, networkId: 'net-c' },
];

function makePoller(client: Pick<CityBikesClient, 'getNetwork'>) {
  const saved: Array<{ cityId: number; takenAt: number; freeBikes: number }> =
    [];
  const networkMappingRepository = {
    find: jest.fn().mockResolvedValue(mappings),
  };
  const observationRepository = {
    create: (x: (typeof saved)[number]) => x,
    save: jest.fn((x: (typeof saved)[number]) => {
      saved.push(x);
      return Promise.resolve(x);
    }),
  };
  const resolution = { resolveIfNeeded: jest.fn() };
  (client as CityBikesClient).getRateLimit = jest.fn(() => ({
    limit: 100,
    remaining: 100,
    resetSeconds: 1,
  }));
  const poller = new PollerService(
    config,
    client as CityBikesClient,
    resolution as never,
    networkMappingRepository as never,
    observationRepository as never,
  );
  return { poller, saved };
}

const network = (freeBikes: number[]) => ({
  id: 'x',
  stations: freeBikes.map((n, i) => ({ id: `s${i}`, free_bikes: n })),
});

describe('PollerService.pollOnce', () => {
  it('stores one observation per city, summed over all of its networks', async () => {
    const getNetwork = jest.fn((id: string) => {
      if (id === 'net-a') return Promise.resolve(network([1, 2]));
      if (id === 'net-b') return Promise.resolve(network([4]));
      return Promise.resolve(network([10, 5]));
    });
    const { poller, saved } = makePoller({ getNetwork });

    const stored = await poller.pollOnce(() => 1_800_000_000_000);

    expect(stored).toBe(2);
    expect(saved).toEqual([
      { cityId: 1, takenAt: 1_800_000_000, freeBikes: 7 },
      { cityId: 2, takenAt: 1_800_000_000, freeBikes: 15 },
    ]);
  });

  it('stores nothing for a city when one of its networks fails', async () => {
    const getNetwork = jest.fn((id: string) => {
      if (id === 'net-b') return Promise.reject(new Error('boom'));
      return Promise.resolve(network([3]));
    });
    const { poller, saved } = makePoller({ getNetwork });

    const stored = await poller.pollOnce(() => 1_800_000_000_000);

    // city 1 is incomplete (net-b failed) -> skipped; city 2 is complete.
    expect(stored).toBe(1);
    expect(saved).toEqual([
      { cityId: 2, takenAt: 1_800_000_000, freeBikes: 3 },
    ]);
  });

  it('backs off a failing network instead of hammering it', async () => {
    const getNetwork = jest.fn((id: string) =>
      id === 'net-b'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(network([1])),
    );
    const { poller } = makePoller({ getNetwork });

    // First cycle: net-b fails, backoff is derived from 1 s / 100 remaining.
    await poller.pollOnce(() => 1_000_000_000_000);
    expect(getNetwork.mock.calls.filter(([id]) => id === 'net-b')).toHaveLength(
      1,
    );

    // Five milliseconds later it is still inside that rate-based backoff.
    await poller.pollOnce(() => 1_000_000_000_005);
    expect(getNetwork.mock.calls.filter(([id]) => id === 'net-b')).toHaveLength(
      1,
    );

    // After the backoff expires it is tried again.
    await poller.pollOnce(() => 1_000_000_000_020);
    expect(getNetwork.mock.calls.filter(([id]) => id === 'net-b')).toHaveLength(
      2,
    );
  });
});
