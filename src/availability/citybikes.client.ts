import { Inject, Injectable } from '@nestjs/common';
import { z, ZodError } from 'zod';
import { AVAILABILITY_CONFIG } from './availability.config';
import type { AvailabilityConfig } from './availability.config';
import {
  NetworkDetail,
  networkDetailResponseSchema,
  NetworkSummary,
  networkListResponseSchema,
} from './citybikes.schemas';

/**
 * Thin HTTP client for the CityBikes API. Every response is treated as
 * untrusted input and validated with Zod at this boundary; callers only ever
 * see parsed, well-typed data or an Error.
 */
@Injectable()
export class CityBikesClient {
  constructor(
    @Inject(AVAILABILITY_CONFIG)
    private readonly config: AvailabilityConfig,
  ) {}

  listNetworks(): Promise<NetworkSummary[]> {
    return this.getValidated('/networks', networkListResponseSchema).then(
      (body) => body.networks,
    );
  }

  getNetwork(networkId: string): Promise<NetworkDetail> {
    return this.getValidated(
      `/networks/${encodeURIComponent(networkId)}`,
      networkDetailResponseSchema,
    ).then((body) => body.network);
  }

  private async getValidated<S extends z.ZodType>(
    path: string,
    schema: S,
  ): Promise<z.infer<S>> {
    const url = `${this.config.baseUrl}${path}`;
    let body: unknown;
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      body = await response.json();
    } catch (error) {
      throw new Error(
        `CityBikes request failed for ${url}: ${describe(error)}`,
      );
    }
    try {
      return schema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues
          .slice(0, 5)
          .map(
            (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`,
          )
          .join('; ');
        throw new Error(
          `CityBikes response for ${url} failed validation: ${issues}`,
        );
      }
      throw error;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
