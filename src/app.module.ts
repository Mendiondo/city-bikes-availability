import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityModule } from './city/city.module';
import { AvailabilityModule } from './availability/availability.module';
import { City } from './city/entities/city.entity';
import { NetworkMapping } from './availability/entities/network-mapping.entity';
import { Observation } from './availability/entities/observation.entity';
import { HourlyStat } from './availability/entities/hourly-stat.entity';
import { AggregationState } from './availability/entities/aggregation-state.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'db/data.sqlite',
      entities: [
        City,
        NetworkMapping,
        Observation,
        HourlyStat,
        AggregationState,
      ],
      synchronize: true,
    }),
    CityModule,
    AvailabilityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
