import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const CitySchema = z.object({
  name: z.string(),
  country: z.string().length(2),
});

export class CreateCityDto extends createZodDto(CitySchema) {}
