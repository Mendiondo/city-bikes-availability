import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { City } from '../city/entities/city.entity';
import { AVAILABILITY_CONFIG, loadConfigFromEnv } from './availability.config';
import { AvailabilityController } from './availability.controller';
import { CityBikesClient } from './citybikes.client';
import { AggregationState } from './entities/aggregation-state.entity';
import { HourlyStat } from './entities/hourly-stat.entity';
import { NetworkMapping } from './entities/network-mapping.entity';
import { Observation } from './entities/observation.entity';
import { PollerService } from './poller.service';
import { ResolutionService } from './resolution.service';
import { StatsService } from './stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      City,
      NetworkMapping,
      Observation,
      HourlyStat,
      AggregationState,
    ]),
  ],
  controllers: [AvailabilityController],
  providers: [
    { provide: AVAILABILITY_CONFIG, useFactory: () => loadConfigFromEnv() },
    CityBikesClient,
    ResolutionService,
    PollerService,
    StatsService,
  ],
  exports: [ResolutionService, StatsService, PollerService],
})
export class AvailabilityModule {}
