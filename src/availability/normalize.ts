/**
 * Pure name-matching helpers for the city -> CityBikes network mapping.
 *
 * CityBikes models the world as *networks* (bike-share systems), each with one
 * free-form `location.city` + `location.country`. Our fixed city list uses
 * "Name[, ST] CC" style entries. The rules below are the whole mapping
 * contract; they are documented in README.md and covered by normalize.spec.ts.
 */

/** Lowercase, strip diacritics, collapse whitespace, trim. */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Candidate keys our city can be matched under:
 * - the full normalized name ("san francisco, ca"),
 * - the part before the first comma ("san francisco"),
 * - the content of any parentheses, for bilingual entries ("京都府 (kyoto)" -> "kyoto").
 */
export function cityNameKeys(cityName: string): string[] {
  const full = normalizeName(cityName);
  const keys = new Set<string>();
  if (full) keys.add(full);
  const base = full.split(',')[0].trim();
  if (base) keys.add(base);
  for (const match of cityName.matchAll(/\(([^)]+)\)/g)) {
    const inner = normalizeName(match[1]);
    if (inner) keys.add(inner);
  }
  return [...keys];
}

/**
 * True when a provider network location belongs to one of our cities.
 *
 * Country must match exactly (after trimming/case). Then any key of our city
 * matches when it equals the provider's full city or its base (part before the
 * first comma), or when the provider base starts with the key followed by a
 * space or '/', which covers metropolitan names such as
 * "San Francisco Bay Area, CA" and multi-city names such as "Kyoto/Otsu".
 * A '-' does not extend a name, so "Berlin-Buch" does not match Berlin.
 */
export function providerMatchesCity(
  providerCity: string,
  providerCountry: string,
  cityName: string,
  cityCountry: string,
): boolean {
  if (
    providerCountry.trim().toUpperCase() !== cityCountry.trim().toUpperCase()
  ) {
    return false;
  }
  const providerFull = normalizeName(providerCity);
  const providerBase = providerFull.split(',')[0].trim();
  for (const key of cityNameKeys(cityName)) {
    if (providerFull === key || providerBase === key) return true;
    if (
      providerBase.startsWith(key + ' ') ||
      providerBase.startsWith(key + '/')
    ) {
      return true;
    }
  }
  return false;
}
