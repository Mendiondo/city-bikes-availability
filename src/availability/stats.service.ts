import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { City } from '../city/entities/city.entity';
import { AVAILABILITY_CONFIG } from './availability.config';
import type { AvailabilityConfig } from './availability.config';
import { AggregationState } from './entities/aggregation-state.entity';
import { HourlyStat } from './entities/hourly-stat.entity';
import { Observation } from './entities/observation.entity';
import { computeHourlyStats, HourlyStats } from './hourly/hourly-stats';

/**
 * Rolls raw observations up into stored per-city hourly stats.
 * Every minute it computes every completed UTC hour that has not been
 * aggregated yet (tracked per city in aggregation_state). Hours whose
 * coverage is zero store no row, per the binding definitions. Observations
 * are assumed append-only in real time (takenAt ~ now), so completed hours
 * never change retroactively.
 */
@Injectable()
export class StatsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StatsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(AVAILABILITY_CONFIG)
    private readonly config: AvailabilityConfig,
    @InjectRepository(City)
    private readonly cityRepo: Repository<City>,
    @InjectRepository(Observation)
    private readonly observationRepository: Repository<Observation>,
    @InjectRepository(HourlyStat)
    private readonly statRepo: Repository<HourlyStat>,
    @InjectRepository(AggregationState)
    private readonly stateRepo: Repository<AggregationState>,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.aggregationEnabled) return;
    void this.aggregateDue().catch((error: unknown) =>
      this.logger.error(`Hourly aggregation failed: ${messageOf(error)}`),
    );
    this.timer = setInterval(() => {
      void this.aggregateDue().catch((error: unknown) =>
        this.logger.error(`Hourly aggregation failed: ${messageOf(error)}`),
      );
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Compute and store stats for every completed UTC hour not yet aggregated.
   * @returns number of hourly stat rows written
   */
  async aggregateDue(
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<number> {
    const currentHourStart = Math.floor(nowSeconds / 3600) * 3600;
    const cities = await this.cityRepo.find({ order: { id: 'ASC' } });
    let stored = 0;

    for (const city of cities) {
      const first = await this.observationRepository.findOne({
        where: { cityId: city.id },
        order: { takenAt: 'ASC' },
      });
      if (!first) continue;
      const firstHour = Math.floor(first.takenAt / 3600) * 3600;
      if (firstHour >= currentHourStart) continue;

      const state = await this.stateRepo.findOne({
        where: { cityId: city.id },
      });
      const startHour = Math.max(
        firstHour,
        (state?.lastComputedHourStart ?? firstHour - 3600) + 3600,
      );

      for (let hour = startHour; hour < currentHourStart; hour += 3600) {
        const stat = await this.computeAndStore(city.id, hour, nowSeconds);
        if (stat) stored++;
      }
      await this.stateRepo.save({
        cityId: city.id,
        lastComputedHourStart: currentHourStart - 3600,
      });
    }
    return stored;
  }

  /**
   * Compute one city-hour from the stored observations that can cover it:
   * those taken in [hourStart - maxStaleness, hourEnd). Stores nothing and
   * returns null when the hour has no coverage.
   */
  async computeAndStore(
    cityId: number,
    hourStart: number,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<HourlyStats | null> {
    const observations = await this.observationRepository.find({
      where: {
        cityId,
        takenAt: Between(
          hourStart - this.config.maxStalenessSeconds,
          hourStart + 3600 - 1,
        ),
      },
      order: { takenAt: 'ASC' },
    });
    const stats = computeHourlyStats(
      observations.map((o) => ({ t: o.takenAt, value: o.freeBikes })),
      hourStart,
      this.config.maxStalenessSeconds,
      3600,
      this.config.partialCoverageThreshold,
    );
    if (!stats) return null;

    await this.statRepo.upsert(
      {
        cityId,
        hourStart,
        avgFreeBikes: stats.avgFreeBikes,
        coveredSeconds: stats.coveredSeconds,
        coverage: stats.coverage,
        partial: stats.partial,
        computedAt: nowSeconds,
      },
      ['cityId', 'hourStart'],
    );
    return stats;
  }

  findHourly(
    cityId: number,
    from?: number,
    to?: number,
  ): Promise<HourlyStat[]> {
    const bounded = from !== undefined || to !== undefined;
    return this.statRepo.find({
      where: {
        cityId,
        ...(bounded
          ? { hourStart: Between(from ?? 0, to ?? Number.MAX_SAFE_INTEGER) }
          : {}),
      },
      order: { hourStart: 'ASC' },
    });
  }

  latestObservation(cityId: number): Promise<Observation | null> {
    return this.observationRepository.findOne({
      where: { cityId },
      order: { takenAt: 'DESC' },
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
