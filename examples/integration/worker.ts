/**
 * Cloudflare Worker - Load Balancer Example
 * 
 * This worker uses the load balancer to route requests
 * to backend servers based on availability and geo location.
 */
import { Effect } from "effect"
import { LoadBalancer, endpoint, geoEndpoint } from "../../src/index.js"

// Backend endpoints (change these to your actual backends)
const BACKENDS = {
    primary: endpoint("http://localhost:3000", { healthCheckPath: "/health" }),
    secondary: endpoint("http://localhost:3001", { healthCheckPath: "/health" }),
    tertiary: endpoint("http://localhost:3002", { healthCheckPath: "/health" }),
}

// Geo-aware endpoints
const GEO_ENDPOINTS = [
    geoEndpoint("http://localhost:3000", { type: "continent", continents: ["NA", "SA"] }, { healthCheckPath: "/health" }),
    geoEndpoint("http://localhost:3001", { type: "continent", continents: ["EU", "AF"] }, { healthCheckPath: "/health" }),
    geoEndpoint("http://localhost:3002", { type: "continent", continents: ["AS", "OC"] }, { healthCheckPath: "/health" }),
]

// Create the load balancer layer
const loadBalancerLayer = LoadBalancer.live({
    // Use geo endpoints for geographic routing
    geoEndpoints: GEO_ENDPOINTS,
    // Default endpoints when no geo match
    endpoints: [BACKENDS.primary, BACKENDS.secondary, BACKENDS.tertiary],
    // Steering strategy
    steering: {
        type: "geo",
        defaultEndpoints: [BACKENDS.primary],
    },
    // Availability method
    availability: {
        type: "fail-forward",
        failoverOnStatuses: [502, 503, 504],
    },
    // Recovery function when all backends fail
    recoveryFn: (_request, context) =>
        Effect.succeed(
            new Response(
                JSON.stringify({
                    error: "All backends are unavailable",
                    triedEndpoints: context.triedEndpoints.map((e) => e.url),
                    lastError: String(context.lastError),
                }),
                {
                    status: 503,
                    headers: { "Content-Type": "application/json" },
                },
            ),
        ),
})

// Main request handler
const handleRequest = (request: Request) =>
    Effect.gen(function* () {
        const lb = yield* LoadBalancer
        return yield* lb.handleRequest(request)
    }).pipe(Effect.provide(loadBalancerLayer))

// Cloudflare Worker export
export default {
    async fetch(request: Request): Promise<Response> {
        try {
            return await Effect.runPromise(handleRequest(request))
        } catch (error) {
            console.error("Load balancer error:", error)
            return new Response(
                JSON.stringify({
                    error: "Load balancer error",
                    message: error instanceof Error ? error.message : String(error),
                }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            )
        }
    },
}
