import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { City } from '../../city/entities/city.entity';

/**
 * Stored result for one city and one UTC hour. A row exists only when the
 * hour had coverage; an hour with no covering observation stores nothing.
 */
@Entity({ name: 'hourly_stat' })
@Index(['cityId', 'hourStart'], { unique: true })
export class HourlyStat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  cityId: number;

  @ManyToOne(() => City, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cityId' })
  city: City;

  /** UTC hour start, unix seconds */
  @Column({ type: 'integer' })
  hourStart: number;

  /** time-weighted average over covered seconds, 2 dp */
  @Column({ type: 'real' })
  avgFreeBikes: number;

  @Column({ type: 'integer' })
  coveredSeconds: number;

  /** coveredSeconds / 3600, 4 dp */
  @Column({ type: 'real' })
  coverage: number;

  /** true when coverage < 0.75 */
  @Column({ type: 'boolean' })
  partial: boolean;

  /** unix seconds when this row was computed */
  @Column({ type: 'integer' })
  computedAt: number;
}
