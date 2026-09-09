import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { City } from '../../city/entities/city.entity';

/**
 * One CityBikes network assigned to one of our cities.
 * The raw provider fields are kept so the mapping is auditable and the
 * resolution rules in normalize.ts stay reproducible.
 */
@Entity({ name: 'network_mapping' })
export class NetworkMapping {
  @PrimaryColumn({ type: 'text' })
  networkId: string;

  @Column({ type: 'integer' })
  cityId: number;

  @ManyToOne(() => City, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cityId' })
  city: City;

  @Column({ type: 'text' })
  networkName: string;

  /** provider location.city at resolution time */
  @Column({ type: 'text' })
  providerCity: string;

  /** provider location.country at resolution time */
  @Column({ type: 'text' })
  providerCountry: string;

  /** ISO instant when this mapping was (re)computed */
  @Column({ type: 'text' })
  resolvedAt: string;
}
