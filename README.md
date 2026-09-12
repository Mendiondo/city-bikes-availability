# city-bikes-availability

Tracks free-bike availability for a fixed list of 20 cities
([files/cities.txt](files/cities.txt), loaded into sqlite via `POST /city/load`)
using the public [CityBikes API](https://api.citybik.es/v2/), and stores a
time-weighted hourly average per city together with how much of the hour was
actually covered by data.

## How it works

```
files/cities.txt --(POST /city/load)--> city table
        |
GET /v2/networks --(Zod-validated)--> resolution --> network_mapping table
        |                                            (city -> networks)
GET /v2/networks/{id} per mapped network, every poll cycle
        |  (Zod-validated at the boundary)
        v
observation table (cityId, takenAt, freeBikes)  --raw, append-only--
        |
        v  hourly aggregation, once per completed UTC hour
hourly_stat table (cityId, hourStart, avgFreeBikes, coveredSeconds,
                   coverage, partial)
```

All provider responses are parsed with Zod ([citybikes.schemas.ts](src/availability/citybikes/citybikes.schemas.ts))
before use: untrusted input arrives as `unknown` and is never trusted as a
typed object. Invalid payloads, non-2xx responses and network failures are
treated the same way: the cycle logs a warning, the affected network backs
off, and the missing data simply shows up as lower coverage for that hour.

## City -> network mapping (the contract)

CityBikes does not model cities; it models **networks** (bike-share systems)
with a free-form `location.city`/`location.country`. One city can have several
networks, and a network's location string is not normalized. Resolution
([normalize.ts](src/availability/normalize.ts), [resolution.service.ts](src/availability/resolution.service.ts))
works as follows:

1. Normalize both sides: lowercase, strip diacritics (NFD), collapse
   whitespace. `Göteborg` = `goteborg`, `Montréal, QC` = `montreal, qc`.
2. Country codes must match exactly (case/space-insensitive). This kills
   false positives like `Dorchester, Weymouth and Portland (GB)` vs our
   `Portland, OR (US)`.
3. Our city matches a network when any of its keys — full name, the part
   before the first comma, or the parenthetical of bilingual entries
   (`京都府 (Kyoto)` also matches as `kyoto`) — equals the provider's full
   city or its part before the first comma, **or** when the provider's base
   starts with the key followed by a space or `/`.
4. Consequences, verified against the live network list:
   - multiple networks per city are all assigned, and their free bikes are
     **summed** (Barcelona = `bicing` + `ambici-amb`);
   - metropolitan names extending the city are included:
     `San Francisco Bay Area, CA` -> `bay-wheels` counts for San Francisco,
     `Valencia, área metropolitana` -> `mibisivalencia` counts for Valencia,
     `Kyoto/Otsu` -> `charichari-kyoto-otsu` counts for Kyoto;
   - `New York` matches `New York, NY` (provider omits the state);
   - `-` does not extend a name: `Berlin-Buch` is **not** Berlin,
     `Rivas-Vaciamadrid` is **not** Madrid.
5. A network is assigned to at most one city (cities are processed in id
   order; a collision would be logged). Cities with no matching network are
   logged as unresolved and simply get no observations.

This resolution is **reproducible**: it is deterministic for a given provider
network list, the result is persisted in the `network_mapping` table with the
raw provider `city`/`country` strings and the resolution timestamp, and it can
be inspected with `GET /availability/mappings` and re-derived at any time with
`POST /availability/resolve`. On boot, resolution runs only if the mapping
table is empty. The integration test
([availability.integration.spec.ts](src/availability/availability.integration.spec.ts))
replays a snapshot of the real network list and asserts the mapping for all
20 cities, including the edge cases above.

## Observation semantics

- One request per mapped network per poll cycle; a city's observation is the
  sum of `free_bikes` over all its networks, stamped with the receipt instant
  (unix seconds) of the last response. The receipt instant is used because
  per-station `timestamp` fields are heterogeneous and can lag.
- Stations with a missing `free_bikes` count as 0 (rare; kept lenient at the
  Zod boundary).
- An observation is stored only when **all** of the city's networks answered —
  a partial sum would silently undercount the city. A failing network instead
  lowers the city's coverage, which is what the `partial` flag is for.

## Hourly aggregation (binding definitions)

Implemented as a pure sweep in [hourly-stats.ts](src/availability/hourly/hourly-stats.ts):

- **Observation**: measurement of a city's total free bikes at instant `t`.
- **Validity**: covers `[t, t + maxStaleness)`, `maxStaleness` defaults to
  900 s and is configurable. After that it expires.
- **Value at an instant**: the most recent non-expired observation at or
  before it.
- **Covered seconds**: seconds of the hour with a non-expired observation. A
  pre-hour observation still covers the hour start; validity is clipped at
  the hour boundary. Hours are UTC.
- **Hourly average**: integral of the value over covered seconds divided by
  covered seconds; uncovered seconds are excluded from both. Stored at 2 dp.
  If nothing covers the hour, **no row is stored** (never zero).
- **Coverage**: covered seconds / 3600, stored at 4 dp. Below 0.75 the hour
  is stored with `partial = true`.

### Golden test vector

Shipped as a test in [hourly-stats.spec.ts](src/availability/hourly/hourly-stats.spec.ts)
and again end-to-end through the database in
[availability.integration.spec.ts](src/availability/availability.integration.spec.ts).
With `maxStaleness = 900`, hour 12:00:00Z–13:00:00Z, observations
`(11:52:00, 100)`, `(12:10:00, 130)`, `(12:15:00, 130)`, `(12:50:00, 70)`:

| Field              | Expected |
| ------------------ | -------- |
| covered seconds    | 2220     |
| average free bikes | 108.11   |
| coverage           | 0.6167   |
| partial            | true     |

(The naive readings 110.00, 107.50 and 103.57 are wrong; the test pins the
binding definition.)

## Keeping close to live data without hammering the provider

- Poll timing follows the provider response headers: `ratelimit-limit`,
  `ratelimit-remaining`, and `ratelimit-reset`. Requests are delayed by the
  reset window divided by the remaining request budget; when no requests
  remain, polling waits until reset.
- A failing network applies exponential backoff to that rate-derived delay
  instead of being retried hot.
- With 900 s staleness, a 300 s cycle keeps coverage at 1.0 even when a full
  cycle is lost; two lost cycles still leave ~1/3 coverage and are flagged
  partial instead of corrupting averages.

## Configuration

| Env var                 | Default                      | Meaning                        |
| ----------------------- | ---------------------------- | ------------------------------ |
| `CITYBIKES_BASE_URL`    | `https://api.citybik.es/v2`  | provider base URL              |
| `MAX_STALENESS_SECONDS` | `900`                        | observation validity window    |
| `REQUEST_TIMEOUT_MS`    | `10000`                      | per-request timeout            |
| `POLLING_ENABLED`       | `true` (`false` under tests) | background poller switch       |
| `AGGREGATION_ENABLED`   | `true` (`false` under tests) | hourly aggregation loop switch |

## HTTP endpoints

- `POST /city/load` — idempotently load the 20 cities from files/cities.txt.
- `GET /availability/mappings` — the auditable city -> network mapping.
- `POST /availability/resolve` — re-run resolution against the live provider.
- `GET /availability/cities/:cityId/hourly?from=&to=` — stored hourly stats
  (unix-second bounds optional).
- `GET /availability/cities/:cityId/latest` — most recent raw observation.

## Run it

```bash
npm install
npm run build
npm run start:dev        # resolves networks on first boot, then polls
npm test                 # unit tests incl. the golden vector
npm run test:e2e
```

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```