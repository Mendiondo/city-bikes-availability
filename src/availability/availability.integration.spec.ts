import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { City } from '../city/entities/city.entity';
import { AVAILABILITY_CONFIG, AvailabilityConfig } from './availability.config';
import { CityBikesClient } from './citybikes/citybikes.client';
import { AggregationState } from './entities/aggregation-state.entity';
import { HourlyStat } from './entities/hourly-stat.entity';
import { NetworkMapping } from './entities/network-mapping.entity';
import { Observation } from './entities/observation.entity';
import { ResolutionService } from './resolution.service';
import { StatsService } from './stats.service';

const config: AvailabilityConfig = {
  baseUrl: 'https://example.test',
  maxStalenessSeconds: 900,
  requestTimeoutMs: 1000,
  pollingEnabled: false,
  aggregationEnabled: false,
  partialCoverageThreshold: 0.75,
};

// The fixed city list as stored in db/data.sqlite (country keeps its raw spacing).
const CITIES: Array<Pick<City, 'name' | 'country'>> = [
  { name: 'Barcelona', country: ' ES' },
  { name: 'Seattle, WA', country: ' US' },
  { name: 'Madrid', country: ' ES' },
  { name: 'Portland, OR', country: ' US' },
  { name: 'Valencia', country: ' ES' },
  { name: 'Berlin', country: ' DE' },
  { name: 'Bilbao', country: ' ES' },
  { name: 'Köln', country: ' DE' },
  { name: 'Paris', country: ' FR' },
  { name: 'München', country: ' DE' },
  { name: 'London', country: ' GB' },
  { name: 'Lisbon', country: ' PT' },
  { name: 'New York, NY', country: ' US' },
  { name: 'Toronto, ON', country: ' CA' },
  { name: 'Chicago, IL', country: ' US' },
  { name: 'Montréal, QC', country: ' CA' },
  { name: 'Los Angeles, CA', country: ' US' },
  { name: '京都府 (Kyoto)', country: ' JP' },
  { name: 'San Francisco, CA', country: ' US' },
  { name: 'Göteborg', country: ' SE' },
];

// Snapshot of the real provider network list for the relevant countries
// (api.citybik.es/v2/networks), including decoys that must not match.
const NETWORK_SNAPSHOT = [
  ['ambici-amb', 'Barcelona', 'ES'],
  ['bicing', 'Barcelona', 'ES'],
  ['bird-seattle', 'Seattle, WA', 'US'],
  ['lime-seattle', 'Seattle, WA', 'US'],
  ['bicimad', 'Madrid', 'ES'],
  ['bicinrivas', 'Rivas-Vaciamadrid', 'ES'],
  ['biketown', 'Portland, OR', 'US'],
  ['lime-portland', 'Portland, OR', 'US'],
  [
    'beryl-dorchester-weymouth-portland',
    'Dorchester, Weymouth and Portland',
    'GB',
  ],
  ['valenbisi', 'Valencia', 'ES'],
  ['mibisivalencia', 'Valencia, área metropolitana', 'ES'],
  ['callabike-berlin', 'Berlin', 'DE'],
  ['nextbike-berlin', 'Berlin', 'DE'],
  ['nextbike-campus-berlin-buch', 'Berlin-Buch', 'DE'],
  ['bilbon-bizi', 'Bilbao', 'ES'],
  ['bizkaibizi-bilbao', 'Bilbao', 'ES'],
  ['callabike-koln', 'Köln', 'DE'],
  ['kvb-rad-koln', 'Köln', 'DE'],
  ['velib', 'Paris', 'FR'],
  ['callabike-munchen', 'München', 'DE'],
  ['nextbike-myradl', 'München', 'DE'],
  ['santander-cycles', 'London', 'GB'],
  ['gira', 'Lisbon', 'PT'],
  ['citi-bike-nyc', 'New York, NY', 'US'],
  ['joco-new-york', 'New York', 'US'],
  ['bixi-toronto', 'Toronto, ON', 'CA'],
  ['divvy', 'Chicago, IL', 'US'],
  ['bixi-montreal', 'Montréal, QC', 'CA'],
  ['bird-los-angeles', 'Los Angeles, CA', 'US'],
  ['metro-bike-share', 'Los Angeles, CA', 'US'],
  ['spin-los-angeles', 'Los Angeles, CA', 'US'],
  ['docomo-cycle-kyoto', '京都府 (Kyoto)', 'JP'],
  ['hellocycling-kyoto', '京都府 (Kyoto)', 'JP'],
  ['charichari-kyoto-otsu', 'Kyoto/Otsu', 'JP'],
  ['bay-wheels', 'San Francisco Bay Area, CA', 'US'],
  ['lime-san-francisco', 'San Francisco, CA', 'US'],
  ['spin-san-francisco', 'San Francisco, CA', 'US'],
  ['e-cargobike-goteborg', 'Göteborg', 'SE'],
  ['styr-staell-goeteborg', 'Göteborg', 'SE'],
].map(([id, city, country]) => ({
  id,
  name: id,
  location: { city, country, latitude: 0, longitude: 0 },
}));

describe('Availability integration (in-memory sqlite)', () => {
  let module: TestingModule;
  let resolution: ResolutionService;
  let stats: StatsService;
  let cityRepo: Repository<City>;
  let observationRepository: Repository<Observation>;
  let statRepo: Repository<HourlyStat>;
  let networkMappingRepository: Repository<NetworkMapping>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [
            City,
            NetworkMapping,
            Observation,
            HourlyStat,
            AggregationState,
          ],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([
          City,
          NetworkMapping,
          Observation,
          HourlyStat,
          AggregationState,
        ]),
      ],
      providers: [
        { provide: AVAILABILITY_CONFIG, useValue: config },
        {
          provide: CityBikesClient,
          useValue: {
            listNetworks: jest.fn().mockResolvedValue(NETWORK_SNAPSHOT),
          },
        },
        ResolutionService,
        StatsService,
      ],
    }).compile();

    resolution = module.get(ResolutionService);
    stats = module.get(StatsService);
    cityRepo = module.get(getRepositoryToken(City));
    observationRepository = module.get(getRepositoryToken(Observation));
    statRepo = module.get(getRepositoryToken(HourlyStat));
    networkMappingRepository = module.get(getRepositoryToken(NetworkMapping));

    await cityRepo.save(CITIES.map((c) => cityRepo.create(c)));
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves every one of the 20 cities to at least one network', async () => {
    const result = await resolution.resolve();
    expect(result.cities).toBe(20);
    expect(result.unresolvedCities).toEqual([]);

    const byCity = new Map<number, string[]>();
    for (const m of await networkMappingRepository.find()) {
      byCity.set(m.cityId, [...(byCity.get(m.cityId) ?? []), m.networkId]);
    }
    const barcelona = await cityRepo.findOneByOrFail({ name: 'Barcelona' });
    const sf = await cityRepo.findOneByOrFail({ name: 'San Francisco, CA' });
    const kyoto = await cityRepo.findOneByOrFail({ name: '京都府 (Kyoto)' });
    const berlin = await cityRepo.findOneByOrFail({ name: 'Berlin' });

    // Multiple networks per city are all assigned.
    expect(byCity.get(barcelona.id)).toEqual(
      expect.arrayContaining(['bicing', 'ambici-amb']),
    );
    // Metropolitan-area network names extend the city name.
    expect(byCity.get(sf.id)).toEqual(
      expect.arrayContaining([
        'bay-wheels',
        'lime-san-francisco',
        'spin-san-francisco',
      ]),
    );
    // Bilingual city entry matches both the native name and "Kyoto/Otsu".
    expect(byCity.get(kyoto.id)).toEqual(
      expect.arrayContaining([
        'docomo-cycle-kyoto',
        'hellocycling-kyoto',
        'charichari-kyoto-otsu',
      ]),
    );
    // Near-miss decoys are excluded.
    expect(byCity.get(berlin.id)).not.toContain('nextbike-campus-berlin-buch');
    const mappedIds = (await networkMappingRepository.find()).map((m) => m.networkId);
    expect(mappedIds).not.toContain('bicinrivas');
    expect(mappedIds).not.toContain('beryl-dorchester-weymouth-portland');
  });

  it('stores the golden vector exactly for a completed hour', async () => {
    const city = await cityRepo.findOneByOrFail({ name: 'Barcelona' });
    const hourStart = Date.UTC(2026, 0, 15, 12, 0, 0) / 1000;
    const at = (h: number, m: number) => Date.UTC(2026, 0, 15, h, m, 0) / 1000;
    await observationRepository.save([
      { cityId: city.id, takenAt: at(11, 52), freeBikes: 100 },
      { cityId: city.id, takenAt: at(12, 10), freeBikes: 130 },
      { cityId: city.id, takenAt: at(12, 15), freeBikes: 130 },
      { cityId: city.id, takenAt: at(12, 50), freeBikes: 70 },
    ]);

    const written = await stats.aggregateDue(at(13, 0) + 1); // just after 13:00
    // Hour 11 (tail of the 11:52 observation) and hour 12 (golden vector).
    expect(written).toBe(2);

    const row = await statRepo.findOneByOrFail({
      cityId: city.id,
      hourStart,
    });
    expect(row.coveredSeconds).toBe(2220);
    expect(row.avgFreeBikes).toBe(108.11);
    expect(row.coverage).toBe(0.6167);
    expect(row.partial).toBe(true);

    const hour11 = await statRepo.findOneByOrFail({
      cityId: city.id,
      hourStart: hourStart - 3600,
    });
    expect(hour11.coveredSeconds).toBe(480); // 11:52:00 -> 12:00:00, clipped
    expect(hour11.avgFreeBikes).toBe(100);
    expect(hour11.partial).toBe(true);

    // Advance to just after 15:00. Hour 13 is covered for 300 s by the 12:50
    // observation (valid until 13:05); hour 14 has no coverage at all and
    // must store no row.
    await stats.aggregateDue(at(15, 0) + 1);
    const hour13 = await statRepo.findOneByOrFail({
      cityId: city.id,
      hourStart: hourStart + 3600,
    });
    expect(hour13.coveredSeconds).toBe(300);
    expect(hour13.avgFreeBikes).toBe(70);
    expect(
      await statRepo.findOneBy({
        cityId: city.id,
        hourStart: hourStart + 7200,
      }),
    ).toBeNull();

    // Re-running aggregation does not duplicate or change rows.
    await stats.aggregateDue(at(15, 0) + 2);
    expect(await statRepo.count()).toBe(3);
  });
});
