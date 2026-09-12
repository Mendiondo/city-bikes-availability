import { z } from 'zod';

/**
 * Runtime boundary validation for the untrusted CityBikes API.
 * Everything that arrives over the network is parsed through these schemas
 * before it is allowed into the rest of the system. Unknown fields are
 * ignored; required fields must be present and well-typed.
 */

export const networkSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  location: z.object({
    city: z.string().nullish(),
    country: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
  }),
});

export const networkListResponseSchema = z.object({
  networks: z.array(networkSummarySchema),
});

export const stationSchema = z.object({
  id: z.string(),
  /** May be missing on misbehaving stations; summed as 0 and documented. */
  free_bikes: z.number().int().nonnegative().nullish(),
  empty_slots: z.number().int().nonnegative().nullish(),
  timestamp: z.string().nullish(),
});

export const networkDetailResponseSchema = z.object({
  network: z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    stations: z.array(stationSchema).nullish(),
  }),
});

export type NetworkSummary = z.infer<typeof networkSummarySchema>;
export type NetworkDetail = z.infer<
  typeof networkDetailResponseSchema
>['network'];
export type Station = z.infer<typeof stationSchema>;
