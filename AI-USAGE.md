This project was first created by Nest.js scaffold with typeORM and better-sqlite3 database and Zod for validation
Created a CRUD for city and a script to read and save the default cities from /files/cities.txt
Ran the following prompt in Copilot:
- Build a small service that tracks how many bikes are available in a fixed list of cities and stores
  an hourly average for each one, using the public CityBikes API at https://api.citybik.es/v2/.
  The service must keep itself close to the live data without hammering the provider. That tradeoff is the assignment. Everything else is scaffolding around it.
  Validate external data at the boundary, at runtime with Zod. Untrusted input arriving over a network, not a typed object.
  There are 20 cities already loaded from /files/cities.txt into sqlite db. 
  Resolving a city to the thing you actually have to fetch is your job, and the provider's data model
  may not map onto cities the way you first assume. Whatever mapping you implement, state it in
  your docs and make it reproducible.
  For every city and every clock hour, store the time-weighted average number of free bikes
  across that city, plus how much of the hour you actually had data for.
  Definitions, which are binding:
  Observation: a measurement of a city's total free bikes at an instant t .
  Validity: an observation taken at t describes the city for the interval [t, t +
  maxStaleness) , where maxStaleness defaults to 900 seconds and is configurable.
  After that it expires: it does not describe the city any more.
  Value at an instant: the value of the most recent non-expired observation at or before that
  instant.
  Covered seconds: the seconds of the hour for which a non-expired observation exists. An
  observation taken before the hour started still covers the beginning of the hour, as long as it
  has not expired. Validity is clipped at the hour boundary: an hour is never influenced by
  seconds outside it.
  Hourly average: the integral of the value over the covered seconds, divided by the covered
  seconds. Uncovered seconds are excluded from both. If nothing covers the hour, store no
  average rather than zero.
  Coverage: covered seconds divided by 3600. An hour with coverage below 0.75 is stored but
  flagged partial .
  Hours are UTC.
  Golden test vector
  Your implementation must reproduce this exactly. Ship it as a test.
  Given maxStaleness = 900s , the hour 12:00:00Z to 13:00:00Z , and these
  observations of one city's total:
  San Francisco,
  CA
  US Göteborg SE
  Observation instant (UTC) Total free bikes
  The expected result for that hour is:
  3. Requirements
  All of the following are stated as hard requirements.
  11:52:00 100
  12:10:00 130
  12:15:00 130
  12:50:00 70
  covered seconds 2220
  average free bikes 108.11 (2 dp)
  coverage 0.6167 (4 dp)
  partial true
  Field Expected
  Three plausible readings of "average free bikes per hour" give
  110.00, 107.50 and 103.57 on this vector. All three are wrong. If you
  get one of them, your definition does not match the one above, and
  every number your service stores is wrong in the same way.
