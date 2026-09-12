import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import type { ComparisonReport, ReplayResult } from './trace.interface';
import { TraceService } from './trace.service';

interface RecordResult {
  output: string;
  durationSeconds: number;
  mappings: number;
  responses: number;
}

@Controller('trace')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  @Post('record')
  record(@Body() body: Record<string, unknown>): Promise<RecordResult> {
    return this.traceService.record({
      output: stringValue(body.output, 'trace.json'),
      hours: numberValue(body.hours, 2, 'hours'),
    });
  }

  @Post('replay')
  replay(@Body() body: Record<string, unknown>): Promise<ReplayResult> {
    const policy = body.policy === undefined ? 'adaptive' : body.policy;
    if (policy !== 'adaptive' && policy !== 'fixed') {
      throw new BadRequestException('policy must be adaptive or fixed');
    }
    return this.traceService.replay({
      tracePath: stringValue(body.tracePath),
      policy,
      budget: optionalNumber(body.budget, 'budget'),
    });
  }

  @Post('compare')
  compare(@Body() body: Record<string, unknown>): Promise<ComparisonReport> {
    return this.traceService.compare({
      tracePath: stringValue(body.tracePath),
      budget: optionalNumber(body.budget, 'budget'),
    });
  }
}

function stringValue(value: unknown, fallback?: string): string {
  const result = value ?? fallback;
  if (typeof result !== 'string' || result.trim() === '') {
    throw new BadRequestException('A non-empty string is required');
  }
  return result;
}

function numberValue(value: unknown, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) {
    throw new BadRequestException(`${name} must be a non-negative number`);
  }
  return result;
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return numberValue(value, 0, name);
}
