import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { loadConfigFromEnv } from '../availability/availability.config';
import { CityBikesClient } from '../availability/citybikes/citybikes.client';
import { NetworkMapping } from '../availability/entities/network-mapping.entity';
import { compareTrace, readTrace, recordTrace, replayTrace } from './trace';
import type {
  AvailabilityTrace,
  ComparisonReport,
  ReplayResult,
  TraceMapping,
} from './trace.interface';

@Injectable()
export class TraceService {
  constructor(
    private readonly client: CityBikesClient,
    @InjectRepository(NetworkMapping)
    private readonly mappingRepository: Repository<NetworkMapping>,
  ) {}

  async listMappings(): Promise<TraceMapping[]> {
    const mappings = await this.mappingRepository.find({
      select: { cityId: true, networkId: true },
      order: { cityId: 'ASC', networkId: 'ASC' },
    });
    return mappings.map(({ cityId, networkId }) => ({ cityId, networkId }));
  }

  async record(options: { output: string; hours: number }): Promise<{
    output: string;
    durationSeconds: number;
    mappings: number;
    responses: number;
  }> {
    const config = loadConfigFromEnv();
    const mappings = await this.listMappings();
    if (mappings.length === 0) {
      throw new Error('No network mappings found. Resolve mappings first.');
    }
    const trace = await recordTrace({
      output: options.output,
      mappings,
      durationMs: options.hours * 3_600_000,
      baseUrl: config.baseUrl,
      client: this.client,
      includeNetworkList: true,
    });
    return {
      output: options.output,
      durationSeconds: trace.durationMs / 1000,
      mappings: mappings.length,
      responses: trace.entries.length,
    };
  }

  async replay(options: {
    tracePath: string;
    policy?: 'adaptive' | 'fixed';
    budget?: number;
  }): Promise<ReplayResult> {
    const config = loadConfigFromEnv();
    const trace = await readTrace(options.tracePath);
    return replayTrace({
      trace,
      policy: options.policy ?? 'adaptive',
      baseUrl: config.baseUrl,
      maxStalenessMs: config.maxStalenessSeconds * 1000,
      requestBudget: options.budget ?? Number.MAX_SAFE_INTEGER,
    });
  }

  async compare(options: {
    tracePath: string;
    budget?: number;
  }): Promise<ComparisonReport> {
    const config = loadConfigFromEnv();
    const trace: AvailabilityTrace = await readTrace(options.tracePath);
    return compareTrace({
      trace,
      baseUrl: config.baseUrl,
      maxStalenessMs: config.maxStalenessSeconds * 1000,
      requestBudget: options.budget,
    });
  }
}
