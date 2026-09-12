import { jest } from '@jest/globals';
import { loadConfigFromEnv } from '../availability.config';
import { CityBikesClient } from './citybikes.client';

const config = loadConfigFromEnv({ NODE_ENV: 'test' });
const client = new CityBikesClient(config);

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('CityBikesClient boundary validation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('parses a valid network list', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        networks: [
          {
            id: 'bicing',
            name: 'Bicing',
            href: '/v2/networks/bicing',
            location: {
              city: 'Barcelona',
              country: 'ES',
              latitude: 41.38,
              longitude: 2.17,
            },
          },
        ],
      }),
    );
    const networks = await client.listNetworks();
    expect(networks).toHaveLength(1);
    expect(networks[0].id).toBe('bicing');
  });

  it('rejects a malformed network list instead of trusting it', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse({ networks: [{ id: 123, location: { city: null } }] }),
      );
    await expect(client.listNetworks()).rejects.toThrow(/failed validation/);
  });

  it('rejects a payload that is not even the expected shape', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse('<html>oops</html>'));
    await expect(client.listNetworks()).rejects.toThrow(/failed validation/);
  });

  it('rejects non-2xx responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 500));
    await expect(client.getNetwork('bicing')).rejects.toThrow(/HTTP 500/);
  });

  it('captures the provider rate-limit headers', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ network: { id: 'bicing', stations: [] } }, 200, {
        'ratelimit-limit': '100',
        'ratelimit-remaining': '37',
        'ratelimit-reset': '42',
      }),
    );

    await client.getNetwork('bicing');

    expect(client.getRateLimit()).toEqual({
      limit: 100,
      remaining: 37,
      resetSeconds: 42,
    });
  });

  it('rejects network-level failures', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket hang up'));
    await expect(client.getNetwork('bicing')).rejects.toThrow(/socket hang up/);
  });

  it('accepts stations with missing free_bikes (nullish at the boundary)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        network: {
          id: 'bicing',
          name: 'Bicing',
          stations: [
            { id: 'a', free_bikes: 3, empty_slots: 4, timestamp: 'x' },
            { id: 'b' }, // no free_bikes: tolerated, summed as 0 upstream
            { id: 'c', free_bikes: null },
          ],
        },
      }),
    );
    const network = await client.getNetwork('bicing');
    expect(network.stations).toHaveLength(3);
    expect(network.stations?.[0].free_bikes).toBe(3);
    expect(network.stations?.[1].free_bikes).toBeUndefined();
  });

  it('rejects stations with negative free_bikes', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        network: { id: 'bicing', stations: [{ id: 'a', free_bikes: -1 }] },
      }),
    );
    await expect(client.getNetwork('bicing')).rejects.toThrow(
      /failed validation/,
    );
  });
});
