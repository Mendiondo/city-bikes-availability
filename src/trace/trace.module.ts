import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NetworkMapping } from '../availability/entities/network-mapping.entity';
import { CityBikesClient } from '../availability/citybikes/citybikes.client';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';
import {
  AVAILABILITY_CONFIG,
  loadConfigFromEnv,
} from '../availability/availability.config';

@Module({
  imports: [TypeOrmModule.forFeature([NetworkMapping])],
  controllers: [TraceController],
  providers: [
    { provide: AVAILABILITY_CONFIG, useFactory: () => loadConfigFromEnv() },
    CityBikesClient,
    TraceService,
  ],
  exports: [TraceService],
})
export class TraceModule {}
