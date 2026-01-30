/**
 * @blank-utils/load-balancer
 *
 * Endpoint data type representing a backend URL
 */
import { Schema } from "effect"

/**
 * Schema for validating endpoint URLs (must be http:// or https://)
 */
export const EndpointUrl = Schema.String.pipe(
    Schema.pattern(/^https?:\/\/.+/),
    Schema.brand("EndpointUrl"),
)
export type EndpointUrl = typeof EndpointUrl.Type

/**
 * Schema for health check path (must start with /)
 */
export const HealthCheckPath = Schema.String.pipe(
    Schema.pattern(/^\/.*/),
    Schema.brand("HealthCheckPath"),
)
export type HealthCheckPath = typeof HealthCheckPath.Type

/**
 * An Endpoint represents a backend URL that can receive load-balanced traffic.
 */
export class Endpoint extends Schema.Class<Endpoint>("Endpoint")({
    /**
     * The base URL of the endpoint (e.g., "https://api.example.com")
     * Must start with http:// or https://
     */
    url: Schema.String.pipe(
        Schema.pattern(/^https?:\/\/.+/, {
            message: () => "URL must start with http:// or https://",
        }),
    ),

    /**
     * Health check pathname for availability checks
     * Must start with /
     * @default "/"
     */
    healthCheckPath: Schema.optionalWith(
        Schema.String.pipe(
            Schema.pattern(/^\/.*/, {
                message: () => "Health check path must start with /",
            }),
        ),
        { default: () => "/" },
    ),

    /**
     * Weight for weighted load balancing (higher = more traffic)
     * @default 1
     */
    weight: Schema.optionalWith(Schema.Number.pipe(Schema.positive()), {
        default: () => 1,
    }),

    /**
     * Optional timeout for requests to this endpoint in milliseconds
     * @default 30000
     */
    timeoutMs: Schema.optionalWith(Schema.Number.pipe(Schema.positive()), {
        default: () => 30000,
    }),
}) {
    /**
     * Get the normalized URL (without trailing slash)
     */
    get normalizedUrl(): string {
        return this.url.replace(/\/$/, "")
    }

    /**
     * Get the full health check URL
     */
    get healthCheckUrl(): string {
        return this.normalizedUrl + this.healthCheckPath
    }

    /**
     * Build target URL by combining endpoint base with request path
     */
    buildTargetUrl(pathname: string, search: string): string {
        return this.normalizedUrl + pathname + search
    }
}

/**
 * Create an endpoint with just a URL (convenience function)
 */
export const endpoint = (
    url: string,
    options?: {
        readonly healthCheckPath?: string
        readonly weight?: number
        readonly timeoutMs?: number
    },
): Endpoint =>
    new Endpoint({
        url,
        healthCheckPath: options?.healthCheckPath ?? "/",
        weight: options?.weight ?? 1,
        timeoutMs: options?.timeoutMs ?? 30000,
    })
