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
 * A measurement of a city's total free bikes at instant takenAt (unix seconds).
 * Append-only; observations are the raw input of the hourly aggregation.
 */
@Entity({ name: 'observation' })
@Index(['cityId', 'takenAt'])
export class Observation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  cityId: number;

  @ManyToOne(() => City, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cityId' })
  city: City;

  @Column({ type: 'integer' })
  takenAt: number;

  @Column({ type: 'integer' })
  freeBikes: number;
}
