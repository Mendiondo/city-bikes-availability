import { Inject, Injectable } from '@nestjs/common';
import { z, ZodError } from 'zod';
import { AVAILABILITY_CONFIG } from '../availability.config';
import type { AvailabilityConfig } from '../availability.config';
import {
  NetworkDetail,
  networkDetailResponseSchema,
  NetworkSummary,
  networkListResponseSchema,
} from './citybikes.schemas';

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Thin HTTP client for the CityBikes API. Every response is treated as
 * untrusted input and validated with Zod at this boundary; callers only ever
 * see parsed, well-typed data or an Error.
 */
@Injectable()
export class CityBikesClient {
  private rateLimit: RateLimitInfo = {
    limit: 1,
    remaining: 0,
    resetSeconds: 1,
  };

  constructor(
    @Inject(AVAILABILITY_CONFIG)
    private readonly config: AvailabilityConfig,
  ) {}

  listNetworks(): Promise<NetworkSummary[]> {
    console.log('List Networks...');
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

  getRateLimit(): RateLimitInfo {
    return { ...this.rateLimit };
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
      this.rateLimit = rateLimitFrom(response.headers ?? new Headers());
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      body = await response.json();
      console.log(`${this.config.baseUrl}${path}`, new Date().toISOString());
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

function rateLimitFrom(headers: Headers): RateLimitInfo {
  return {
    limit: headerNumber(headers, 'ratelimit-limit', 1),
    remaining: headerNumber(headers, 'ratelimit-remaining', 0),
    resetSeconds: headerNumber(headers, 'ratelimit-reset', 1),
  };
}

function headerNumber(
  headers: Headers,
  name: string,
  fallback: number,
): number {
  const value = Number(headers.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
