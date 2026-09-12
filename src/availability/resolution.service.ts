import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { City } from '../city/entities/city.entity';
import { CityBikesClient } from './citybikes/citybikes.client';
import { NetworkMapping } from './entities/network-mapping.entity';
import { providerMatchesCity } from './normalize';

export interface ResolutionResult {
  cities: number;
  mappedNetworks: number;
  unresolvedCities: string[];
}

/**
 * Resolves each of our fixed cities to the CityBikes network(s) that serve it.
 * The provider models bike-share *networks*, not cities: one city can have
 * several networks (summed later), and a network's location string is
 * free-form. The matching rules live in normalize.ts and are documented in
 * README.md; the resulting rows are persisted for auditability.
 */
@Injectable()
export class ResolutionService {
  private readonly logger = new Logger(ResolutionService.name);

  constructor(
    private readonly client: CityBikesClient,
    @InjectRepository(NetworkMapping)
    private readonly networkMappingRepository: Repository<NetworkMapping>,
    @InjectRepository(City)
    private readonly cityRepo: Repository<City>,
  ) {}

  /** Resolve only when no mapping exists yet (used on boot). */
  async resolveIfNeeded(): Promise<ResolutionResult | null> {
    if ((await this.networkMappingRepository.count()) > 0) return null;
    return this.resolve();
  }

  /**
   * Re-derive the whole mapping from the live provider network list.
   * Deterministic: cities are processed in id order, networks in id order,
   * and a network is assigned to at most one city (first match wins, with a
   * warning). Replaces the previous mapping atomically.
   */
  async resolve(): Promise<ResolutionResult> {
    const [networks, cities] = await Promise.all([
      this.client.listNetworks(),
      this.cityRepo.find({ order: { id: 'ASC' } }),
    ]);
    const sortedNetworks = [...networks].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const resolvedAt = new Date().toISOString();
    const assignedNetworkIds = new Set<string>();
    const rows: NetworkMapping[] = [];
    const unresolvedCities: string[] = [];

    for (const city of cities) {
      const matches = sortedNetworks.filter(
        (network) =>
          !assignedNetworkIds.has(network.id) &&
          network.location.city != null &&
          network.location.country != null &&
          providerMatchesCity(
            network.location.city,
            network.location.country,
            city.name,
            city.country,
          ),
      );
      if (matches.length === 0) {
        unresolvedCities.push(`${city.name} (${city.country.trim()})`);
        this.logger.warn(
          `No CityBikes network matched city "${city.name}" ${city.country.trim()}`,
        );
        continue;
      }
      for (const network of matches) {
        assignedNetworkIds.add(network.id);
        rows.push(
          this.networkMappingRepository.create({
            networkId: network.id,
            networkName: network.name ?? '',
            providerCity: network.location.city ?? '',
            providerCountry: network.location.country ?? '',
            cityId: city.id,
            resolvedAt,
          }),
        );
      }
      this.logger.log(
        `City "${city.name}" ${city.country.trim()} -> networks [${matches
          .map((m) => m.id)
          .join(', ')}]`,
      );
    }

    await this.networkMappingRepository.manager.transaction(async (em) => {
      await em.clear(NetworkMapping);
      await em.save(rows);
    });

    return {
      cities: cities.length,
      mappedNetworks: rows.length,
      unresolvedCities,
    };
  }

  getMappings(): Promise<NetworkMapping[]> {
    return this.networkMappingRepository.find({
      order: { cityId: 'ASC', networkId: 'ASC' },
    });
  }
}
