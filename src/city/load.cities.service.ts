import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CityService } from './city.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const cityService = app.get(CityService);

  await cityService.loadCities();
  console.log('Service executed');

  await app.close();
}

void run();
