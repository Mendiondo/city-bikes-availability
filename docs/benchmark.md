## Record, replay, and compare polling

The trace tool records raw CityBikes responses, including the fetch instant, HTTP status, response headers, and body. It uses the persisted network mapping, so resolve mappings before recording. A two-hour trace is usually enough for a useful fixture:

```bash
curl -X POST http://localhost:3000/trace/record \
  -H 'content-type: application/json' \
  -d '{
    "output": "traces/city-bikes.json",
    "hours": 2
  }'
curl -X POST http://localhost:3000/trace/replay \
  -H 'content-type: application/json' \
  -d '{
    "tracePath": "traces/city-bikes.json",
    "policy": "adaptive",
    "budget": 1000
  }'
curl -X POST http://localhost:3000/trace/compare \
  -H 'content-type: application/json' \
  -d '{
    "tracePath": "traces/city-bikes.json",
    "budget": 1000
  }'
```

Replay with the fixed baseline:

```bash
curl -X POST http://localhost:3000/trace/replay \
  -H 'content-type: application/json' \
  -d '{"tracePath":"traces/city-bikes.json","policy":"fixed"}'
```

Replay never calls the network. It advances a virtual clock and selects the latest recorded response available at each request instant, making the same trace and options deterministic. Compare runs the adaptive scheduler and a fixed-interval, no-jitter baseline under the same request budget, then reports requests used, mean and p95 staleness, redundant fetch ratio, R5 five-minute window compliance, mean absolute error against trace ground truth, coverage, mean freshness, one-second request burstiness, wins, and losses. A loss is reported with the reason rather than hidden; `targetMet` is true when the adaptive scheduler wins at least two metrics. The result depends on the trace.
The only optional request controls are `budget` and replay `policy`; polling cadence is derived from the recorded provider rate-limit headers.