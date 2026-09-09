import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCityDto } from './dto/create-city.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { City } from './entities/city.entity';
import { readFile } from 'node:fs/promises';

@Injectable()
export class CityService {
  constructor(
    @InjectRepository(City)
    private readonly cityRepository: Repository<City>,
  ) {}

  async create(createCityDto: CreateCityDto) {
    const expenseType = this.cityRepository.create(createCityDto);
    return await this.cityRepository.save(expenseType);
  }

  findAll() {
    return this.cityRepository.find();
  }

  findOne(id: number) {
    return this.cityRepository.findOne({
      where: { id },
    });
  }

  async remove(id: number) {
    const expenseType = await this.findOne(id);
    if (!expenseType) throw new NotFoundException();

    return await this.cityRepository.remove(expenseType);
  }

  /**
   * Idempotently load the fixed city list from files/cities.txt.
   * Each line is "<name> <CC>" where CC is the ISO country code; the name
   * may itself contain spaces, commas and state codes ("San Francisco, CA US").
   */
  async loadCities() {
    try {
      const buffer = await readFile('./files/cities.txt', 'utf8');
      const lines = buffer
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const existing = new Set(
        (await this.cityRepository.find()).map((city) =>
          cityKey(city.name, city.country),
        ),
      );

      let loaded = 0;
      const skipped: string[] = [];
      for (const line of lines) {
        const match = /^(?<name>.+?)\s+(?<country>[A-Z]{2})$/.exec(line);
        if (!match?.groups) {
          skipped.push(line);
          continue;
        }
        const { name, country } = match.groups;
        if (existing.has(cityKey(name, country))) continue;
        await this.create({ name, country });
        existing.add(cityKey(name, country));
        loaded++;
      }
      if (skipped.length > 0) {
        console.warn(`Skipped unparseable city lines: ${skipped.join(' | ')}`);
      }
      return { loaded, skipped, total: await this.cityRepository.count() };
    } catch (error: unknown) {
      console.error(error);
      throw error;
    }
  }
}

/** Compare ignoring the stray whitespace present in the seeded db rows. */
function cityKey(name: string, country: string): string {
  return `${name.trim()}|${country.trim()}`;
}
