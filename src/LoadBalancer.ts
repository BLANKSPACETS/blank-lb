/**
 * @blank-utils/load-balancer
 *
 * LoadBalancer service - the main entry point
 */
import { Context, Effect, Layer, Schema } from "effect"
import type { AvailabilityMethod } from "./AvailabilityMethod.js"
import {
    asyncBlock,
    failForward,
    promiseAny,
} from "./AvailabilityMethod.js"
import { Endpoint } from "./Endpoint.js"
import { NoHealthyEndpointsError } from "./Errors.js"
import type { GeoEndpoint } from "./GeoEndpoint.js"
import type { CfProperties } from "./GeoSteering.js"
import { selectGeoEndpoints } from "./GeoSteering.js"
import { HealthChecker, HealthCheckerLive } from "./HealthChecker.js"
import type { RecoveryContext, RecoveryFn } from "./Recovery.js"
import { withRecovery } from "./Recovery.js"

/**
 * Steering configuration
 */
export const SteeringConfig = Schema.Struct({
    type: Schema.Literal("geo"),
    /**
     * Default endpoints to use when no geo match is found
     */
    defaultEndpoints: Schema.optionalWith(Schema.Array(Schema.Any), {
        default: () => [],
    }),
})
export type SteeringConfig = typeof SteeringConfig.Type

/**
 * LoadBalancer configuration options
 */
export interface LoadBalancerOptions {
    /**
     * Endpoints to load balance (regular endpoints without geo steering)
     */
    readonly endpoints?: ReadonlyArray<Endpoint>

    /**
     * Geo endpoints (when using geo steering)
     */
    readonly geoEndpoints?: ReadonlyArray<GeoEndpoint>

    /**
     * Steering configuration (e.g., geo steering)
     */
    readonly steering?: {
        readonly type: "geo"
        readonly defaultEndpoints?: ReadonlyArray<Endpoint>
    }

    /**
     * Availability method configuration
     * @default { type: "fail-forward" }
     */
    readonly availability?: AvailabilityMethod

    /**
     * Recovery function called when all endpoints fail
     */
    readonly recoveryFn?: RecoveryFn
}

/**
 * Request type with optional Cloudflare properties
 */
export interface CfRequest extends Request {
    readonly cf?: CfProperties
}

/**
 * LoadBalancer service interface
 */
export class LoadBalancer extends Context.Tag("@blank-utils/LoadBalancer")<
    LoadBalancer,
    {
        /**
         * Handle an incoming request by forwarding to an available endpoint
         */
        readonly handleRequest: (
            request: CfRequest,
        ) => Effect.Effect<Response, NoHealthyEndpointsError>
    }
>() {
    /**
     * Create a LoadBalancer layer with the given options
     */
    static layer(
        options: LoadBalancerOptions,
    ): Layer.Layer<LoadBalancer, never, HealthChecker> {
        return Layer.effect(
            LoadBalancer,
            Effect.gen(function* () {
                const healthChecker = yield* HealthChecker

                return {
                    handleRequest: (request: CfRequest) =>
                        Effect.gen(function* () {
                            // Determine which endpoints to try
                            const endpointsToTry = getEndpointsToTry(options, request.cf)

                            if (endpointsToTry.length === 0) {
                                return yield* new NoHealthyEndpointsError({ triedEndpoints: [] })
                            }

                            // Get availability method
                            const availability = options.availability ?? {
                                type: "fail-forward" as const,
                                failoverOnStatuses: [502, 503, 504],
                            }

                            // Create recovery context (mutable per-request state is safe)
                            let triedEndpoints: Endpoint[] = []
                            let lastError: unknown

                            const getContext = (): RecoveryContext => ({
                                triedEndpoints,
                                lastError,
                            })

                            // Build the effect based on availability method
                            const healthCheckerLayer = Layer.succeed(HealthChecker, healthChecker)

                            const runWithMethod = (): Effect.Effect<
                                Response,
                                NoHealthyEndpointsError
                            > => {
                                switch (availability.type) {
                                    case "fail-forward": {
                                        const statuses = "failoverOnStatuses" in availability
                                            ? availability.failoverOnStatuses
                                            : [502, 503, 504]
                                        return failForward(endpointsToTry, request, statuses)
                                    }
                                    case "async-block":
                                        return asyncBlock(endpointsToTry, request).pipe(
                                            Effect.provide(healthCheckerLayer),
                                        )
                                    case "promise-any":
                                        return promiseAny(endpointsToTry, request).pipe(
                                            Effect.provide(healthCheckerLayer),
                                        )
                                }
                            }

                            let effect = runWithMethod()

                            // Track tried endpoints from error
                            effect = effect.pipe(
                                Effect.tapError((error) =>
                                    Effect.sync(() => {
                                        triedEndpoints = [...error.triedEndpoints]
                                        lastError = error.lastError
                                    }),
                                ),
                            )

                            // Apply recovery function if provided
                            if (options.recoveryFn) {
                                effect = withRecovery(
                                    effect,
                                    request,
                                    options.recoveryFn,
                                    getContext,
                                )
                            }

                            return yield* effect
                        }),
                }
            }),
        )
    }

    /**
     * Create a fully assembled LoadBalancer layer with HealthCheckerLive
     */
    static live(options: LoadBalancerOptions): Layer.Layer<LoadBalancer> {
        return LoadBalancer.layer(options).pipe(Layer.provide(HealthCheckerLive))
    }
}

/**
 * Get the list of endpoints to try based on configuration and geo data
 */
function getEndpointsToTry(
    options: LoadBalancerOptions,
    cf: CfProperties | undefined,
): ReadonlyArray<Endpoint> {
    // If geo steering is enabled
    if (options.steering?.type === "geo" && options.geoEndpoints) {
        return selectGeoEndpoints(
            options.geoEndpoints,
            cf,
            options.steering.defaultEndpoints,
        )
    }

    // Regular endpoints
    return options.endpoints ?? []
}
