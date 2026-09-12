import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AVAILABILITY_CONFIG } from '../availability.config';
import type { AvailabilityConfig } from '../availability.config';
import { CityBikesClient } from '../citybikes/citybikes.client';
import { NetworkMapping } from '../entities/network-mapping.entity';
import { Observation } from '../entities/observation.entity';
import { ResolutionService } from '../resolution.service';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Keeps observations close to live data without hammering the provider:
 * - request timing follows the provider's ratelimit-remaining/reset headers;
 * - a failing network backs off exponentially instead of being retried hot;
 * - maxStaleness (900 s) tolerates a couple of missed cycles before coverage
 *   starts to drop.
 */
@Injectable()
export class PollerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private timer?: NodeJS.Timeout;
  private destroyed = false;
  private inFlight = false;
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly backoffUntil = new Map<string, number>();

  constructor(
    @Inject(AVAILABILITY_CONFIG)
    private readonly config: AvailabilityConfig,
    private readonly client: CityBikesClient,
    private readonly resolution: ResolutionService,
    @InjectRepository(NetworkMapping)
    private readonly networkMappingRepository: Repository<NetworkMapping>,
    @InjectRepository(Observation)
    private readonly observationRepository: Repository<Observation>,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.pollingEnabled) return;
    void this.resolution
      .resolveIfNeeded()
      .catch((error: unknown) =>
        this.logger.error(`Network resolution failed: ${messageOf(error)}`),
      )
      .finally(() => this.schedule(10_000)); // first cycle ~10 s after boot
  }

  onModuleDestroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delayMs: number) {
    if (this.destroyed) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref();
  }

  private async tick() {
    if (this.inFlight) {
      this.schedule(5_000); // previous cycle still running; retry shortly
      return;
    }
    this.inFlight = true;
    try {
      await this.pollOnce();
    } catch (error) {
      this.logger.error(`Poll cycle failed: ${messageOf(error)}`);
    } finally {
      this.inFlight = false;
      this.schedule(this.nextRateLimitDelayMs());
    }
  }

  /**
   * One measurement cycle: fetch every mapped network once and store one
   * observation per city. A city's observation is the sum of free bikes over
   * all of its networks, stamped with the receipt instant of the last
   * response. It is stored only when every network of the city was fetched —
   * a partial sum would silently undercount the city.
   *
   * @returns number of city observations stored
   */
  async pollOnce(now: () => number = () => Date.now()): Promise<number> {
    const mappings = await this.networkMappingRepository.find({
      order: { cityId: 'ASC', networkId: 'ASC' },
    });
    const byCity = new Map<number, NetworkMapping[]>();
    for (const mapping of mappings) {
      const list = byCity.get(mapping.cityId) ?? [];
      list.push(mapping);
      byCity.set(mapping.cityId, list);
    }

    let stored = 0;
    let firstRequest = true;
    for (const [cityId, cityNetworks] of byCity) {
      let totalFreeBikes = 0;
      let fetched = 0;
      let lastReceiptSeconds = 0;

      for (const mapping of cityNetworks) {
        if (!firstRequest) await sleep(this.nextRateLimitDelayMs());
        firstRequest = false;

        const backedOffUntil = this.backoffUntil.get(mapping.networkId);
        if (backedOffUntil !== undefined && backedOffUntil > now()) continue;

        try {
          const network = await this.client.getNetwork(mapping.networkId);
          totalFreeBikes += (network.stations ?? []).reduce(
            (sum, station) => sum + (station.free_bikes ?? 0),
            0,
          );
          fetched++;
          lastReceiptSeconds = Math.floor(now() / 1000);
          this.consecutiveFailures.delete(mapping.networkId);
          this.backoffUntil.delete(mapping.networkId);
        } catch (error) {
          const failures =
            (this.consecutiveFailures.get(mapping.networkId) ?? 0) + 1;
          this.consecutiveFailures.set(mapping.networkId, failures);
          const backoffMs = Math.min(
            this.nextRateLimitDelayMs() * 2 ** (failures - 1),
            3_600_000,
          );
          this.backoffUntil.set(mapping.networkId, now() + backoffMs);
          this.logger.warn(
            `Network ${mapping.networkId} fetch failed (${failures} in a row, ` +
              `backing off ${Math.round(backoffMs / 1000)}s): ${messageOf(error)}`,
          );
        }
      }

      if (fetched > 0 && fetched === cityNetworks.length) {
        await this.observationRepository.save(
          this.observationRepository.create({
            cityId,
            takenAt: lastReceiptSeconds,
            freeBikes: totalFreeBikes,
          }),
        );
        stored++;
      } else if (fetched > 0) {
        this.logger.warn(
          `City ${cityId}: only ${fetched}/${cityNetworks.length} networks ` +
            `fetched; storing no observation to avoid an undercounted total`,
        );
      }
    }
    return stored;
  }

  private nextRateLimitDelayMs(): number {
    const { limit, remaining, resetSeconds } = this.client.getRateLimit();
    const resetMs = Math.max(0, resetSeconds * 1000);
    if (remaining <= 0) return Math.max(1000, resetMs);

    // Spread the usable request budget across the reset window. Floor the
    // interval so fractional milliseconds do not accumulate as throttling.
    const usableRemaining = Math.min(remaining, Math.max(1, limit));
    return Math.max(1, Math.floor(resetMs / usableRemaining));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
