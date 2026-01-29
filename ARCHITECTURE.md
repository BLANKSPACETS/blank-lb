# BLANK Load Balancer — Architecture & Design

> A Cloudflare Workers-based load balancer built with Effect-TS

---

## Overview

**BLANK-LB** is a lightweight, extensible load balancer designed to run on Cloudflare Workers. It provides failover, health checks, and geo-steering capabilities with a focus on type safety, composability, and observability.

This document outlines the architecture, compares approaches, and proposes an Effect-TS implementation strategy.

---


### What It Does Well

| Feature | Description |
|---------|-------------|
| **Simple API** | `new LoadBalancer({ endpoints: [...] })` is easy to understand |
| **Geo Steering** | Routes by continent, country, region, or Cloudflare colo |
| **Multiple Availability Methods** | `fail-forward`, `async-block`, `promise.any` |
| **Recovery Function** | Hook to handle total failure (e.g., dump to R2) |
| **Observability Headers** | Adds `X-Load-Balancer-*` headers for debugging |

### Current Limitations

| Issue | Impact |
|-------|--------|
| **No typed errors** | Throws generic `Error("No available endpoints")` |
| **Mutable state** | `this.endpoints` is reassigned during geo selection |
| **No retry/backoff** | Immediate failover with no delay strategy |
| **No timeout handling** | Relies on fetch defaults |
| **No circuit breaker** | Unhealthy endpoints are retried every request |
| **No metrics/tracing** | Headers are useful but no structured telemetry |
| **Class-based architecture** | Harder to compose and test |

---

## Proposed Architecture: Effect-TS Approach

### Why Effect?

1. **Typed Errors** — Every failure mode is explicit in the type signature
2. **Services & Layers** — Dependency injection without classes
3. **Structured Concurrency** — `Effect.race`, `Effect.retry`, timeouts built-in
4. **Observability** — Tracing and metrics via `@effect/opentelemetry`
5. **Composability** — Small, testable functions that compose

### Core Modules

```
src/
├── index.ts              # Main export (LoadBalancer service)
├── Endpoint.ts           # Endpoint data type & operations
├── GeoEndpoint.ts        # Geo-aware endpoint
├── LoadBalancer.ts       # LoadBalancer service definition
├── AvailabilityMethod.ts # Failover strategies
├── HealthCheck.ts        # Health check service
├── CircuitBreaker.ts     # Circuit breaker pattern
├── StateStore.ts         # Pluggable persistence (KV, DO, Memory)
├── Errors.ts             # Typed error definitions
├── Headers.ts            # Response header utilities
└── Config.ts             # Configuration schema
```

---

## Data Types

### Endpoint

```ts
import { Data, Schema } from "effect"

export class Endpoint extends Data.Class<{
  readonly url: string
  readonly healthCheckPath: string
  readonly weight: number  // for weighted load balancing (future)
}> {}

export const EndpointSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.pattern(/^https?:\/\/.+/)),
  healthCheckPath: Schema.optionalWith(Schema.String, { default: () => "/" }),
  weight: Schema.optionalWith(Schema.Number, { default: () => 1 }),
})
```

### GeoEndpoint

```ts
export const GeoType = Schema.Literal("continent", "country", "region", "colo")

export const GeoConfig = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("continent"),
    continents: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("country"),
    countries: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("region"),
    regions: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("colo"),
    colos: Schema.Array(Schema.String),
  }),
)

export class GeoEndpoint extends Data.Class<{
  readonly endpoint: Endpoint
  readonly geo: typeof GeoConfig.Type
}> {}
```

---

## Error Types

```ts
import { Data } from "effect"

export class NoHealthyEndpointsError extends Data.TaggedError("NoHealthyEndpointsError")<{
  readonly triedEndpoints: ReadonlyArray<Endpoint>
  readonly lastError?: unknown
}> {}

export class EndpointUnhealthyError extends Data.TaggedError("EndpointUnhealthyError")<{
  readonly endpoint: Endpoint
  readonly reason: "timeout" | "status" | "network"
  readonly statusCode?: number
}> {}

export class CircuitOpenError extends Data.TaggedError("CircuitOpenError")<{
  readonly endpoint: Endpoint
  readonly openedAt: Date
  readonly failures: number
}> {}

export class RequestForwardError extends Data.TaggedError("RequestForwardError")<{
  readonly endpoint: Endpoint
  readonly cause: unknown
}> {}
```

---

## Services

### HealthChecker Service

```ts
import { Context, Effect, Layer } from "effect"

export class HealthChecker extends Context.Tag("HealthChecker")<
  HealthChecker,
  {
    readonly check: (endpoint: Endpoint) => Effect.Effect<boolean, EndpointUnhealthyError>
  }
>() {}

export const HealthCheckerLive = Layer.succeed(HealthChecker, {
  check: (endpoint) =>
    Effect.tryPromise({
      try: () => fetch(endpoint.url + endpoint.healthCheckPath),
      catch: () => new EndpointUnhealthyError({ endpoint, reason: "network" }),
    }).pipe(
      Effect.timeout("5 seconds"),
      Effect.flatMap((res) =>
        res.ok
          ? Effect.succeed(true)
          : Effect.fail(new EndpointUnhealthyError({
              endpoint,
              reason: "status",
              statusCode: res.status,
            }))
      ),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(new EndpointUnhealthyError({ endpoint, reason: "timeout" }))
      ),
    ),
})
```

### LoadBalancer Service

```ts
import { Context, Effect, Layer, Array as Arr } from "effect"

export class LoadBalancer extends Context.Tag("LoadBalancer")<
  LoadBalancer,
  {
    readonly handleRequest: (
      request: Request<unknown, IncomingRequestCfProperties>
    ) => Effect.Effect<Response, NoHealthyEndpointsError>
  }
>() {}
```

---

## Availability Methods

### Fail-Forward (Default)

```ts
export const failForward = (
  endpoints: ReadonlyArray<Endpoint>,
  request: Request,
  failoverStatuses: ReadonlyArray<number> = [502, 503, 504],
): Effect.Effect<Response, NoHealthyEndpointsError, never> =>
  Effect.gen(function* () {
    const tried: Endpoint[] = []

    for (const endpoint of endpoints) {
      tried.push(endpoint)

      const result = yield* forwardRequest(endpoint, request).pipe(
        Effect.either,
      )

      if (result._tag === "Right") {
        const response = result.right

        if (!failoverStatuses.includes(response.status)) {
          return addLoadBalancerHeaders(response, endpoint, tried)
        }
        // Failover status, try next
      }
      // Network error, try next
    }

    return yield* new NoHealthyEndpointsError({ triedEndpoints: tried })
  })
```

### Promise.any Style (Parallel Health Checks)

```ts
export const promiseAny = (
  endpoints: ReadonlyArray<Endpoint>,
  request: Request,
): Effect.Effect<Response, NoHealthyEndpointsError, HealthChecker> =>
  Effect.gen(function* () {
    const checker = yield* HealthChecker

    const healthyEndpoint = yield* Effect.raceAll(
      endpoints.map((ep) =>
        checker.check(ep).pipe(
          Effect.as(ep),
          Effect.catchAll(() => Effect.never), // Ignore failures
        )
      ),
    ).pipe(
      Effect.timeout("10 seconds"),
      Effect.catchTag("TimeoutException", () =>
        Effect.fail(new NoHealthyEndpointsError({ triedEndpoints: endpoints }))
      ),
    )

    return yield* forwardRequest(healthyEndpoint, request)
  })
```

---

## Geo Steering

```ts
export const matchesRequest = (
  geo: GeoConfig,
  cf: IncomingRequestCfProperties,
): boolean => {
  switch (geo.type) {
    case "continent":
      return cf.continent !== undefined && geo.continents.includes(cf.continent)
    case "country":
      return cf.country !== undefined && geo.countries.includes(cf.country)
    case "region":
      return cf.regionCode !== undefined && geo.regions.includes(cf.regionCode)
    case "colo":
      return geo.colos.includes(cf.colo)
  }
}

export const selectEndpoints = (
  geoEndpoints: ReadonlyArray<GeoEndpoint>,
  request: Request<unknown, IncomingRequestCfProperties>,
  defaultEndpoints: ReadonlyArray<Endpoint> = [],
): ReadonlyArray<Endpoint> => {
  const cf = request.cf
  if (!cf) return defaultEndpoints.length > 0 ? defaultEndpoints : geoEndpoints.map(g => g.endpoint)

  const matched = geoEndpoints
    .filter((ge) => matchesRequest(ge.geo, cf))
    .map((ge) => ge.endpoint)

  if (matched.length > 0) return matched

  return defaultEndpoints.length > 0
    ? defaultEndpoints
    : geoEndpoints.map((g) => g.endpoint)
}
```

---

## Future Enhancements

### Circuit Breaker

Prevent hammering unhealthy endpoints:

```ts
type CircuitState = 
  | { _tag: "Closed" }
  | { _tag: "Open"; openedAt: Date; failures: number }
  | { _tag: "HalfOpen" }
```

### StateStore Service (Pluggable Persistence)

The user decides where to store circuit breaker state. We provide a `StateStore` service with multiple implementations:

```ts
import { Context, Effect, Layer } from "effect"

export class StateStore extends Context.Tag("StateStore")<
  StateStore,
  {
    readonly get: <T>(key: string) => Effect.Effect<T | null>
    readonly set: <T>(key: string, value: T, ttl?: number) => Effect.Effect<void>
    readonly delete: (key: string) => Effect.Effect<void>
  }
>() {}

// === Implementation 1: In-Memory (default, no persistence across requests) ===
export const StateStoreMemory = Layer.succeed(StateStore, {
  get: (_key) => Effect.succeed(null),
  set: (_key, _value, _ttl) => Effect.void,
  delete: (_key) => Effect.void,
})

// === Implementation 2: Workers KV ===
export const StateStoreKV = (kv: KVNamespace) =>
  Layer.succeed(StateStore, {
    get: (key) =>
      Effect.tryPromise({
        try: () => kv.get(key, "json"),
        catch: () => null,
      }),
    set: (key, value, ttl) =>
      Effect.tryPromise({
        try: () => kv.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined),
        catch: () => undefined,
      }).pipe(Effect.asVoid),
    delete: (key) =>
      Effect.tryPromise({
        try: () => kv.delete(key),
        catch: () => undefined,
      }).pipe(Effect.asVoid),
  })

// === Implementation 3: Durable Objects ===
export const StateStoreDO = (stub: DurableObjectStub) =>
  Layer.succeed(StateStore, {
    get: (key) =>
      Effect.tryPromise({
        try: async () => {
          const res = await stub.fetch(`http://internal/state/${key}`)
          return res.ok ? res.json() : null
        },
        catch: () => null,
      }),
    set: (key, value, _ttl) =>
      Effect.tryPromise({
        try: () => stub.fetch(`http://internal/state/${key}`, {
          method: "PUT",
          body: JSON.stringify(value),
        }),
        catch: () => undefined,
      }).pipe(Effect.asVoid),
    delete: (key) =>
      Effect.tryPromise({
        try: () => stub.fetch(`http://internal/state/${key}`, { method: "DELETE" }),
        catch: () => undefined,
      }).pipe(Effect.asVoid),
  })
```

**User chooses their persistence layer:**

```ts
// Option A: No persistence (stateless, circuit breaker resets each request)
const MainLive = LoadBalancerLive.pipe(
  Layer.provide(StateStoreMemory),
)

// Option B: Workers KV (eventual consistency, good for most cases)
const MainLive = LoadBalancerLive.pipe(
  Layer.provide(StateStoreKV(env.LOAD_BALANCER_KV)),
)

// Option C: Durable Objects (strong consistency, real-time state)
const MainLive = LoadBalancerLive.pipe(
  Layer.provide(StateStoreDO(env.LOAD_BALANCER_DO.get(id))),
)
```

### Weighted Load Balancing

```ts
export const selectByWeight = (endpoints: ReadonlyArray<Endpoint>): Endpoint => {
  const totalWeight = endpoints.reduce((sum, ep) => sum + ep.weight, 0)
  let random = Math.random() * totalWeight

  for (const endpoint of endpoints) {
    random -= endpoint.weight
    if (random <= 0) return endpoint
  }

  return endpoints[0]!
}
```

### Response Time Steering

Track latency and prefer faster endpoints:

```ts
// Use Workers Analytics Engine or Durable Objects to track p50/p99 latencies
// Prefer endpoints with lower latency for subsequent requests
```

### Observability

```ts
// Integration with @effect/opentelemetry for tracing
// Each request creates a span with:
// - lb.endpoint.url
// - lb.availability.method
// - lb.geo.matched
// - lb.failover.count
```

---

## Comparison: worker-lb vs BLANK-LB

| Feature | worker-lb | BLANK-LB (Effect) |
|---------|-----------|-------------------|
| Typed Errors | ❌ | ✅ |
| Composable | ❌ (class-based) | ✅ (services/layers) |
| Circuit Breaker | ❌ | 🔜 Planned |
| Weighted LB | ❌ | 🔜 Planned |
| Response Time Steering | 🔜 Planned | 🔜 Planned |
| Retry with Backoff | ❌ | ✅ Built-in |
| Timeouts | ❌ (relies on fetch) | ✅ Explicit |
| Tracing | ❌ | ✅ @effect/opentelemetry |
| Testing | Manual mocking | ✅ Layer-based DI |

---

## Implementation Phases

### Phase 1: Core (MVP)

- [ ] `Endpoint` and `GeoEndpoint` data types
- [ ] `HealthChecker` service
- [ ] `LoadBalancer` service with `fail-forward` method
- [ ] Response headers for observability
- [ ] Basic Cloudflare Worker export

### Phase 2: Failover Strategies

- [ ] `async-block` availability method
- [ ] `promise.any` availability method
- [ ] Configurable failover statuses
- [ ] Recovery function support

### Phase 3: Geo Steering

- [ ] Geo matching logic
- [ ] Default endpoint fallback
- [ ] Geo + availability method composition

### Phase 4: Advanced Features

- [ ] Circuit breaker with pluggable `StateStore`
- [ ] `StateStoreMemory` (default, stateless)
- [ ] `StateStoreKV` (Workers KV)
- [ ] `StateStoreDO` (Durable Objects)
- [ ] Weighted load balancing
- [ ] Response time steering
- [ ] OpenTelemetry integration

---

## Usage Example (Target API)

```ts
import { Effect, Layer } from "effect"
import {
  LoadBalancer,
  Endpoint,
  GeoEndpoint,
  HealthCheckerLive,
  StateStoreKV,  // or StateStoreMemory, StateStoreDO
} from "@blank-utils/load-balancer"

const endpoints = [
  new GeoEndpoint({
    endpoint: new Endpoint({ url: "https://us.api.example.com" }),
    geo: { type: "continent", continents: ["NA", "SA"] },
  }),
  new GeoEndpoint({
    endpoint: new Endpoint({ url: "https://eu.api.example.com" }),
    geo: { type: "continent", continents: ["EU", "AF"] },
  }),
]

const LoadBalancerLive = LoadBalancer.layer({
  endpoints,
  steering: { type: "geo" },
  availability: { type: "fail-forward" },
})

// User picks their persistence layer
const MainLive = LoadBalancerLive.pipe(
  Layer.provide(HealthCheckerLive),
  Layer.provide(StateStoreKV(env.LOAD_BALANCER_KV)), // <-- User chooses this
)

export default {
  async fetch(
    request: Request<unknown, IncomingRequestCfProperties>,
    env: Env,
  ): Promise<Response> {
    const program = Effect.gen(function* () {
      const lb = yield* LoadBalancer
      return yield* lb.handleRequest(request)
    })

    return Effect.runPromise(program.pipe(Effect.provide(MainLive)))
  },
}
```

---

## Decisions Made

| Question | Decision |
|----------|----------|
| **Package name** | `@blank-utils/load-balancer` |
| **State persistence** | User chooses via `StateStore` layer (`Memory`, `KV`, or `DO`) |

## Open Questions

1. **Bundling**: Ship as ESM-only? Support other runtimes (Bun, Node)?
2. **Compatibility**: Should we maintain API compatibility with `worker-lb` for easy migration?

---

## Next Steps

1. **Approve this architecture** or suggest changes
2. **Set up project structure** with Effect patterns
3. **Implement Phase 1** core functionality
4. **Write tests** using `@effect/vitest`
5. **Create example worker** for demonstration

---

*Document created: 2026-01-29*
