/**
 * @blank-utils/load-balancer
 *
 * A Cloudflare Workers-based load balancer built with Effect-TS
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { LoadBalancer, endpoint } from "@blank-utils/load-balancer"
 *
 * const lb = LoadBalancer.live({
 *   endpoints: [
 *     endpoint("https://api1.example.com"),
 *     endpoint("https://api2.example.com"),
 *   ],
 *   availability: { type: "fail-forward" },
 * })
 *
 * export default {
 *   async fetchAPI(request: Request): Promise<Response> {
 *     const program = Effect.gen(function* () {
 *       const loadBalancer = yield* LoadBalancer
 *       return yield* loadBalancer.handleRequest(request)
 *     })
 *
 *     return Effect.runPromise(program.pipe(Effect.provide(lb)))
 *   },
 * }
 * ```
 */
export { Endpoint, endpoint } from "./Endpoint.js"
export type { EndpointUrl, HealthCheckPath } from "./Endpoint.js"

export { GeoEndpoint, geoEndpoint, GeoConfig, ContinentCode } from "./GeoEndpoint.js"
export type {
    GeoContinentConfig,
    GeoCountryConfig,
    GeoRegionConfig,
    GeoColoConfig,
} from "./GeoEndpoint.js"

// Errors
export {
    NoHealthyEndpointsError,
    EndpointUnhealthyError,
    CircuitOpenError,
    RequestForwardError,
} from "./Errors.js"

// Services
export { LoadBalancer } from "./LoadBalancer.js"
export type { LoadBalancerOptions, CfRequest, SteeringConfig } from "./LoadBalancer.js"

export { HealthChecker, HealthCheckerLive, HealthCheckerTest } from "./HealthChecker.js"

// Availability methods
export {
    AvailabilityMethod,
    AvailabilityMethodType,
    FailForwardOptions,
    AsyncBlockOptions,
    PromiseAnyOptions,
    DEFAULT_FAILOVER_STATUSES,
    failForward,
    asyncBlock,
    promiseAny,
} from "./AvailabilityMethod.js"

// Geo steering
export { selectGeoEndpoints } from "./GeoSteering.js"
export type { CfProperties } from "./GeoSteering.js"

// Recovery
export { withRecovery } from "./Recovery.js"
export type { RecoveryContext, RecoveryFn } from "./Recovery.js"

// Headers
export { HEADERS, addLoadBalancerHeaders } from "./Headers.js"

// Forward
export { forwardRequest } from "./Forward.js"
