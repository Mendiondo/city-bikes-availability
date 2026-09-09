import { computeHourlyStats, roundTo } from './hourly-stats';

const STALENESS = 900; // default maxStaleness, seconds
// Hour under test: 12:00:00Z to 13:00:00Z on an arbitrary date.
const hourStart = Date.UTC(2026, 0, 15, 12, 0, 0) / 1000;
const at = (hour: number, minute: number, second = 0) =>
  Date.UTC(2026, 0, 15, hour, minute, second) / 1000;

describe('computeHourlyStats', () => {
  it('reproduces the golden test vector exactly', () => {
    const stats = computeHourlyStats(
      [
        { t: at(11, 52), value: 100 },
        { t: at(12, 10), value: 130 },
        { t: at(12, 15), value: 130 },
        { t: at(12, 50), value: 70 },
      ],
      hourStart,
      STALENESS,
    );

    expect(stats).not.toBeNull();
    expect(stats!.coveredSeconds).toBe(2220);
    expect(stats!.avgFreeBikes).toBe(108.11);
    expect(stats!.coverage).toBe(0.6167);
    expect(stats!.partial).toBe(true);
  });

  it('returns null when there are no observations at all', () => {
    expect(computeHourlyStats([], hourStart, STALENESS)).toBeNull();
  });

  it('returns null when every observation expired before the hour', () => {
    // 11:50:59 + 900 s = 12:00:59... use one that expires before 12:00:00.
    const stats = computeHourlyStats(
      [{ t: at(11, 30), value: 42 }], // expires at 11:45:00
      hourStart,
      STALENESS,
    );
    expect(stats).toBeNull();
  });

  it('returns null when the only observations are at or after the hour end', () => {
    expect(
      computeHourlyStats([{ t: at(13, 0), value: 5 }], hourStart, STALENESS),
    ).toBeNull();
    expect(
      computeHourlyStats([{ t: at(14, 0), value: 5 }], hourStart, STALENESS),
    ).toBeNull();
  });

  it('lets a pre-hour observation cover the start of the hour while valid', () => {
    // Taken 5 min before the hour, valid until 12:10:00 -> covers 600 s.
    const stats = computeHourlyStats(
      [{ t: at(11, 55), value: 50 }],
      hourStart,
      STALENESS,
    );
    expect(stats).toEqual({
      coveredSeconds: 600,
      avgFreeBikes: 50,
      coverage: roundTo(600 / 3600, 4),
      partial: true,
    });
  });

  it('an observation expiring exactly at the hour start covers nothing', () => {
    // [t, t + 900) ends exactly at 12:00:00 -> zero covered seconds.
    const stats = computeHourlyStats(
      [{ t: at(11, 45), value: 99 }],
      hourStart,
      STALENESS,
    );
    expect(stats).toBeNull();
  });

  it('clips validity at the hour end', () => {
    // Taken at 12:59:30, valid for 900 s, but only 30 s remain in the hour.
    const stats = computeHourlyStats(
      [{ t: at(12, 59, 30), value: 7 }],
      hourStart,
      STALENESS,
    );
    expect(stats).toEqual({
      coveredSeconds: 30,
      avgFreeBikes: 7,
      coverage: roundTo(30 / 3600, 4),
      partial: true,
    });
  });

  it('an observation exactly at the hour start applies from the start', () => {
    const stats = computeHourlyStats(
      [{ t: at(12, 0), value: 10 }],
      hourStart,
      STALENESS,
    );
    expect(stats!.coveredSeconds).toBe(900);
    expect(stats!.avgFreeBikes).toBe(10);
  });

  it('full-hour coverage is not partial and averages the value', () => {
    // One observation every 900 s, the first one before the hour starts.
    const stats = computeHourlyStats(
      [
        { t: at(11, 59), value: 12 },
        { t: at(12, 14), value: 12 },
        { t: at(12, 29), value: 12 },
        { t: at(12, 44), value: 12 },
        { t: at(12, 59), value: 12 },
      ],
      hourStart,
      STALENESS,
    );
    expect(stats).toEqual({
      coveredSeconds: 3600,
      avgFreeBikes: 12,
      coverage: 1,
      partial: false,
    });
  });

  it('excludes uncovered seconds from the average denominator', () => {
    // 10 bikes for 900 covered seconds, nothing else: average is 10, not 2.5.
    const stats = computeHourlyStats(
      [{ t: at(12, 0), value: 10 }],
      hourStart,
      STALENESS,
    );
    expect(stats!.avgFreeBikes).toBe(10);
    expect(stats!.coveredSeconds).toBe(900);
  });

  it('uses the most recent observation at each instant', () => {
    // 100 from 12:00 to 12:05, then 200 for 900 s -> (100*300 + 200*900)/1200.
    const stats = computeHourlyStats(
      [
        { t: at(12, 0), value: 100 },
        { t: at(12, 5), value: 200 },
      ],
      hourStart,
      STALENESS,
    );
    expect(stats!.coveredSeconds).toBe(1200);
    expect(stats!.avgFreeBikes).toBe(175);
  });

  it('marks coverage exactly 0.75 as not partial', () => {
    // Three non-overlapping 900 s observations -> 2700 covered seconds.
    const stats = computeHourlyStats(
      [
        { t: at(12, 0), value: 1 },
        { t: at(12, 15), value: 1 },
        { t: at(12, 30), value: 1 },
      ],
      hourStart,
      STALENESS,
    );
    expect(stats!.coveredSeconds).toBe(2700);
    expect(stats!.coverage).toBe(0.75);
    expect(stats!.partial).toBe(false);
  });

  it('marks coverage just below 0.75 as partial', () => {
    // 900 + 900 covered seconds, then a 12:45:01 observation clipped by the
    // hour end covers 899 more -> 2699 (just under 2700 = 0.75 coverage).
    const stats = computeHourlyStats(
      [
        { t: at(12, 0), value: 1 },
        { t: at(12, 15), value: 1 },
        { t: at(12, 45, 1), value: 1 },
      ],
      hourStart,
      STALENESS,
    );
    expect(stats!.coveredSeconds).toBe(2699);
    expect(stats!.partial).toBe(true);
  });

  it('honours a configurable maxStaleness', () => {
    // With 300 s staleness the golden observations cover less of the hour.
    const stats = computeHourlyStats(
      [
        { t: at(11, 52), value: 100 }, // expires 11:57 -> covers nothing
        { t: at(12, 10), value: 130 }, // covers 12:10-12:15
        { t: at(12, 15), value: 130 }, // covers 12:15-12:20
        { t: at(12, 50), value: 70 }, // covers 12:50-12:55
      ],
      hourStart,
      300,
    );
    expect(stats!.coveredSeconds).toBe(900);
    expect(stats!.avgFreeBikes).toBe(roundTo((130 * 600 + 70 * 300) / 900, 2));
  });
});
