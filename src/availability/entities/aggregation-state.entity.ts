import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Per-city watermark for the hourly aggregation, so completed hours are
 * computed exactly once even when they yield no stored stat.
 */
@Entity({ name: 'aggregation_state' })
export class AggregationState {
  @PrimaryColumn({ type: 'integer' })
  cityId: number;

  /** Last UTC hour start (unix seconds) whose stats have been computed. */
  @Column({ type: 'integer' })
  lastComputedHourStart: number;
}
