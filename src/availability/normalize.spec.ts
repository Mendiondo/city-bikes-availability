import { cityNameKeys, normalizeName, providerMatchesCity } from './normalize';

// Cases taken from the real CityBikes network list (api.citybik.es/v2/networks).
describe('normalizeName', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(normalizeName('  Göteborg ')).toBe('goteborg');
    expect(normalizeName('Montréal,  QC')).toBe('montreal, qc');
    expect(normalizeName('京都府 (Kyoto)')).toBe('京都府 (kyoto)');
  });
});

describe('cityNameKeys', () => {
  it('includes full name, base name and parenthetical', () => {
    expect(cityNameKeys('San Francisco, CA')).toEqual([
      'san francisco, ca',
      'san francisco',
    ]);
    expect(cityNameKeys('京都府 (Kyoto)')).toContain('kyoto');
    expect(cityNameKeys('Barcelona')).toEqual(['barcelona']);
  });
});

describe('providerMatchesCity', () => {
  const cases: Array<[string, string, string, string, boolean]> = [
    // provider city, provider country, our city, our country, expected
    ['Barcelona', 'ES', 'Barcelona', 'ES', true],
    ['Portland, OR', 'US', 'Portland, OR', 'US', true],
    ['Madrid', 'ES', 'Madrid', ' ES', true], // our db rows have a leading space
    ['Köln', 'DE', 'Köln', 'DE', true],
    ['München', 'DE', 'München', 'DE', true],
    ['Montréal, QC', 'CA', 'Montréal, QC', 'CA', true],
    ['Göteborg', 'SE', 'Göteborg', 'SE', true],
    ['Lisbon', 'PT', 'Lisbon', 'PT', true],
    ['London', 'GB', 'London', 'GB', true],
    ['Valencia, área metropolitana', 'ES', 'Valencia', 'ES', true],
    ['New York', 'US', 'New York, NY', 'US', true], // provider omits state
    ['San Francisco Bay Area, CA', 'US', 'San Francisco, CA', 'US', true],
    ['Kyoto/Otsu', 'JP', '京都府 (Kyoto)', 'JP', true], // multi-city network
    ['京都府 (Kyoto)', 'JP', '京都府 (Kyoto)', 'JP', true],
    // must NOT match
    ['Berlin-Buch', 'DE', 'Berlin', 'DE', false], // '-' does not extend a name
    ['Rivas-Vaciamadrid', 'ES', 'Madrid', 'ES', false],
    ['Dorchester, Weymouth and Portland', 'GB', 'Portland, OR', 'US', false],
    ['Barcelona', 'ES', 'Barcelona', 'US', false], // country guard
    ['Paris, TX', 'US', 'Paris', 'FR', false],
  ];

  it.each(cases)(
    '%s (%s) vs %s (%s) -> %s',
    (providerCity, providerCountry, cityName, cityCountry, expected) => {
      expect(
        providerMatchesCity(
          providerCity,
          providerCountry,
          cityName,
          cityCountry,
        ),
      ).toBe(expected);
    },
  );
});
