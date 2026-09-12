## Find networks by city name
- Candidate keys to match a city:
 * the full normalized name ("san francisco, ca"),
 * the part before the first comma ("san francisco"),
 * the content of any parentheses, for bilingual entries ("京都府 (kyoto)" -> "kyoto"). 
- The networkId=mibisivalencia has a neighborhood name with the city name: "Valencia, área metropolitana" and has been included in the search
- The networkId=bay-wheels has a neighborhood name with the city name: "San Francisco Bay Area, CA" and has been included in the search
- The networkId=charichari-kyoto-otsu has a neighborhood name with the city name: "Kyoto/Otsu", don't have the city name in Japanese and has been included in the search

## Get networks data
- When bursting the "http://api.citybik.es/v2/networks/network_id" API retuns this error: CityBikes request failed for https://api.citybik.es/v2/networks/callabike-berlin: HTTP 429
- When testing the "Record" mode exceeded the API limits and received the error with status 429:
  * {
      "message": "Rate limit exceeded. Contact info@citybik.es for an access token. Thanks :)",
      "request_id": "21096752b04ebb151c5dfc67a5c1a54c"
    } 
  * With the response headers is possible to manage the remaining requests before burst the API where:
    ratelimit-limit: total requests the API can handle
    ratelimit-remaining: remaining requests avilable before exceeded the limmit
    ratelimit-reset: remaining seconds to reset the remaining requests to the total limit

## Tools
Used copilot with models set to Auto

## Method
Used prompts and refined the design when necessary

## AI failures
- AI create poolInterval parameters that could not properly reach city API limits, so I changed to use the response headers data instead
  ```
  pollIntervalSeconds: positiveInt(env, 'POLL_INTERVAL_SECONDS', 300),
  pollJitterSeconds: positiveInt(env, 'POLL_JITTER_SECONDS', 1),
  pollSpacingMs: positiveInt(env, 'POLL_SPACING_MS', 250),
  ```
- When creating the record/replay/compare services AI created separate call and configs(intervalMs, jitterMs spacingMs - see bellow) to handle city API limits, so I changed to use the same calls as in the availability service as the same response headers limits
  ```
    const record = async (url: string) => {
    const fetchedAt = now();
    let response: Response;
    try {
      response = await fetcher.fetch(url, {
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      trace.entries.push({
        at: new Date(fetchedAt).toISOString(),
        elapsedMs: fetchedAt - startedEpochMs,
        method: 'GET',
        url,
        status: 0,
        headers: {},
        body: { error: error instanceof Error ? error.message : String(error) },
      });
      return;
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    trace.entries.push({
      at: new Date(fetchedAt).toISOString(),
      elapsedMs: fetchedAt - startedEpochMs,
      method: 'GET',
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    });
  };
  ```

  ```
  export function replayTrace(options: {
    trace: AvailabilityTrace;
    policy: 'adaptive' | 'fixed';
    baseUrl: string;
    intervalMs: number;
    jitterMs: number;
    spacingMs: number;
    maxStalenessMs: number;
    requestBudget: number;
    random?: () => number;
  }): ReplayResult {
  ```

## Something you wrote yourself
  - Default city CRUD and service to load them from a txt file

## Something you rejected
  - The configs created to handle API limits, as described above

## Your least-trusted code.
  - The trace.ts service got big and should be refactored to improve understanding and maintenance