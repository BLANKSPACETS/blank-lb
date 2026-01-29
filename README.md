# @blank-utils/load-balancer

> A type-safe, composable load balancer for Cloudflare Workers built with Effect-TS

[![npm version](https://img.shields.io/npm/v/@blank-utils/load-balancer.svg)](https://www.npmjs.com/package/@blank-utils/load-balancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🎯 **Type-Safe Errors** — Every failure mode is explicit in the type signature
- 🌍 **Geo Steering** — Route by continent, country, region, or Cloudflare colo
- ⚡ **Multiple Failover Strategies** — `fail-forward`, `async-block`, `promise-any`
- 🔄 **Recovery Hook** — Handle total failures gracefully (logging, R2 dump, etc.)
- 📊 **Observability Headers** — Built-in `X-Load-Balancer-*` headers for debugging
- 🧩 **Composable** — Built on Effect services and layers for easy testing and extension
- ☁️ **Cloudflare Native** — Designed specifically for Cloudflare Workers runtime

## Installation

```bash
# pnpm (recommended)
pnpm add @blank-utils/load-balancer effect

# bun
bun add @blank-utils/load-balancer effect

# npm
npm install @blank-utils/load-balancer effect
```

## Quick Start

### Basic Usage

```ts
import { Effect } from "effect"
import { LoadBalancer, endpoint } from "@blank-utils/load-balancer"

// Define your endpoints
const lb = LoadBalancer.live({
  endpoints: [
    endpoint("https://api1.example.com"),
    endpoint("https://api2.example.com"),
    endpoint("https://api3.example.com"),
  ],
  availability: { type: "fail-forward" },
})

export default {
  async fetch(request: Request): Promise<Response> {
    const program = Effect.gen(function* () {
      const loadBalancer = yield* LoadBalancer
      return yield* loadBalancer.handleRequest(request)
    })

    return Effect.runPromise(program.pipe(Effect.provide(lb)))
  },
}
```

### Geo Steering

Route traffic based on geographic location:

```ts
import { LoadBalancer, geoEndpoint, endpoint } from "@blank-utils/load-balancer"

const lb = LoadBalancer.live({
  geoEndpoints: [
    geoEndpoint("https://us.api.example.com", {
      type: "continent",
      continents: ["NA", "SA"],
    }),
    geoEndpoint("https://eu.api.example.com", {
      type: "continent",
      continents: ["EU", "AF"],
    }),
    geoEndpoint("https://asia.api.example.com", {
      type: "continent",
      continents: ["AS", "OC"],
    }),
  ],
  steering: {
    type: "geo",
    defaultEndpoints: [endpoint("https://us.api.example.com")],
  },
  availability: { type: "fail-forward" },
})
```

### Custom Health Check Path

```ts
endpoint("https://api.example.com", {
  healthCheckPath: "/health",
  weight: 2, // For future weighted load balancing
  timeoutMs: 5000,
})
```

## Availability Methods

### Fail-Forward (Default)

Tries endpoints in order. Fails over on network errors or specific HTTP status codes.

```ts
{
  availability: {
    type: "fail-forward",
    failoverOnStatuses: [502, 503, 504], // default
  }
}
```

### Async-Block

Performs sequential health checks on each endpoint before forwarding.

```ts
{
  availability: { type: "async-block" }
}
```

### Promise-Any

Races health checks in parallel, uses the first healthy endpoint.

```ts
{
  availability: { type: "promise-any" }
}
```

## Recovery Function

Handle total failures gracefully:

```ts
import { Effect } from "effect"

const lb = LoadBalancer.live({
  endpoints: [endpoint("https://api.example.com")],
  recoveryFn: (request, context) =>
    Effect.gen(function* () {
      // Log to external service
      console.error("All endpoints failed:", {
        triedEndpoints: context.triedEndpoints.map((ep) => ep.url),
        lastError: context.lastError,
      })

      // Return a fallback response
      return new Response("Service temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "30" },
      })

      // Or return undefined to propagate the error
      // return undefined
    }),
})
```

## Response Headers

The load balancer adds observability headers to successful responses:

| Header | Description |
|--------|-------------|
| `X-Load-Balancer-Endpoint` | The endpoint URL that served the request |
| `X-Load-Balancer-Latency` | Total request latency in milliseconds |
| `X-Load-Balancer-Endpoint-Gather-Latency` | Time to select the endpoint in milliseconds |
| `X-Load-Balancer-Tried-Count` | Number of endpoints tried (only on failover) |
| `X-Load-Balancer-Tried-Endpoints` | Comma-separated endpoint URLs tried |

## Error Types

All errors are typed and can be handled explicitly:

```ts
import {
  NoHealthyEndpointsError,
  EndpointUnhealthyError,
  RequestForwardError,
} from "@blank-utils/load-balancer"

program.pipe(
  Effect.catchTag("NoHealthyEndpointsError", (error) => {
    console.log("Tried endpoints:", error.triedEndpoints)
    return Effect.succeed(new Response("No healthy endpoints", { status: 503 }))
  })
)
```

## API Reference

### Exports

```ts
// Data Types
export { Endpoint, endpoint } from "@blank-utils/load-balancer"
export { GeoEndpoint, geoEndpoint, GeoConfig, ContinentCode } from "@blank-utils/load-balancer"

// Services
export { LoadBalancer } from "@blank-utils/load-balancer"
export { HealthChecker, HealthCheckerLive, HealthCheckerTest } from "@blank-utils/load-balancer"

// Errors
export {
  NoHealthyEndpointsError,
  EndpointUnhealthyError,
  CircuitOpenError,
  RequestForwardError,
} from "@blank-utils/load-balancer"

// Availability Methods
export {
  failForward,
  asyncBlock,
  promiseAny,
  DEFAULT_FAILOVER_STATUSES,
} from "@blank-utils/load-balancer"

// Utilities
export { selectGeoEndpoints } from "@blank-utils/load-balancer"
export { withRecovery } from "@blank-utils/load-balancer"
export { addLoadBalancerHeaders, HEADERS } from "@blank-utils/load-balancer"
export { forwardRequest } from "@blank-utils/load-balancer"
```

### Types

```ts
import type {
  LoadBalancerOptions,
  CfRequest,
  SteeringConfig,
  CfProperties,
  RecoveryContext,
  RecoveryFn,
  GeoContinentConfig,
  GeoCountryConfig,
  GeoRegionConfig,
  GeoColoConfig,
} from "@blank-utils/load-balancer"
```

## Roadmap

- [ ] Circuit breaker pattern with pluggable state store (KV, Durable Objects)
- [ ] Weighted load balancing
- [ ] Response time steering
- [ ] OpenTelemetry integration

## Requirements

- **Runtime**: Cloudflare Workers
- **Dependencies**: `effect` ^3.0.0

## License

MIT © blank

---

Built with ❤️ using [Effect-TS](https://effect.website)
