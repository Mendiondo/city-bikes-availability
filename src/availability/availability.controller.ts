import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ResolutionService } from './resolution.service';
import { StatsService } from './stats.service';

@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly resolution: ResolutionService,
    private readonly stats: StatsService,
  ) {}

  /** The auditable city -> provider network mapping. */
  @Get('mappings')
  getMappings() {
    return this.resolution.getMappings();
  }

  /** Re-run city -> network resolution against the live provider list. */
  @Post('resolve')
  resolve() {
    return this.resolution.resolve();
  }

  /** Stored hourly stats for a city; optional unix-second from/to bounds. */
  @Get('cities/:cityId/hourly')
  getHourly(
    @Param('cityId', ParseIntPipe) cityId: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.stats.findHourly(cityId, toSeconds(from), toSeconds(to));
  }

  /** Most recent raw observation for a city. */
  @Get('cities/:cityId/latest')
  getLatest(@Param('cityId', ParseIntPipe) cityId: number) {
    return this.stats.latestObservation(cityId);
  }
}

function toSeconds(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
