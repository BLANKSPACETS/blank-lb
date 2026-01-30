/**
 * @blank-utils/load-balancer
 *
 * Forward requests to endpoints
 */
import { Effect, Schedule, Duration } from "effect"
import type { Endpoint } from "./Endpoint.js"
import { RequestForwardError } from "./Errors.js"

/**
 * HTTP methods that should NOT have a body
 */
const BODYLESS_METHODS = ["GET", "HEAD", "OPTIONS"] as const

/**
 * Check if a method should have a body
 */
export const methodSupportsBody = (method: string): boolean =>
    !BODYLESS_METHODS.includes(method.toUpperCase() as (typeof BODYLESS_METHODS)[number])

/**
 * Buffered body type - either ArrayBuffer for methods that support body, or null
 */
export type BufferedBody = ArrayBuffer | null

/**
 * Retry policy options for requests to endpoints.
 */
export interface RetryOptions {
    /**
     * Maximum number of retries per endpoint
     * @default 0
     */
    readonly maxRetries?: number
    /**
     * Initial delay before first retry
     * @default "100 millis"
     */
    readonly initialDelay?: Duration.DurationInput
    /**
     * Maximum backoff delay
     * @default "5 seconds"
     */
    readonly maxDelay?: Duration.DurationInput
    /**
     * Exponential backoff factor
     * @default 2
     */
    readonly factor?: number
}

/**
 * Buffer a request body for potential retries.
 * Returns null for methods that don't support body (GET, HEAD, OPTIONS).
 * 
 * This should be called ONCE before any forwarding attempts to avoid
 * consuming the ReadableStream multiple times.
 */
export const bufferRequestBody = (
    request: Request,
): Effect.Effect<BufferedBody, RequestForwardError> =>
    Effect.gen(function* () {
        // Don't buffer body for methods that shouldn't have one
        if (!methodSupportsBody(request.method)) {
            return null
        }

        // If there's no body, return null
        if (!request.body) {
            return null
        }

        // Buffer the body as ArrayBuffer for retry support
        const body = yield* Effect.tryPromise({
            try: () => request.arrayBuffer(),
            catch: (cause) =>
                new RequestForwardError({
                    endpoint: { url: request.url } as Endpoint,
                    cause,
                }),
        })

        return body
    })

/**
 * Forward a request to an endpoint.
 * 
 * @param endpoint - The endpoint to forward to
 * @param request - The original request (used for method, headers, URL path)
 * @param bufferedBody - Pre-buffered body from bufferRequestBody (enables retries)
 */
export const forwardRequest = (
    endpoint: Endpoint,
    request: Request,
    bufferedBody: BufferedBody = null,
): Effect.Effect<Response, RequestForwardError> =>
    Effect.gen(function* () {
        const url = new URL(request.url)
        const targetUrl = endpoint.buildTargetUrl(url.pathname, url.search)

        // Determine body to send
        // - Use buffered body if provided (enables retry support)
        // - Strip body for GET/HEAD/OPTIONS even if buffered body exists
        const body = methodSupportsBody(request.method) ? bufferedBody : null

        const response = yield* Effect.tryPromise({
            try: () =>
                fetch(targetUrl, {
                    method: request.method,
                    headers: request.headers,
                    body,
                    redirect: "follow",
                    signal: AbortSignal.timeout(endpoint.timeoutMs),
                }),
            catch: (cause) => new RequestForwardError({ endpoint, cause }),
        })

        return response
    })

/**
 * Forward a request with retry policy (exponential backoff).
 * 
 * @param endpoint - The endpoint to forward to
 * @param request - The original request
 * @param bufferedBody - Pre-buffered body for retries
 * @param retryOptions - Retry configuration
 */
export const forwardRequestWithRetry = (
    endpoint: Endpoint,
    request: Request,
    bufferedBody: BufferedBody = null,
    retryOptions?: RetryOptions,
): Effect.Effect<Response, RequestForwardError> => {
    const effect = forwardRequest(endpoint, request, bufferedBody)

    if (!retryOptions || (retryOptions.maxRetries ?? 0) <= 0) {
        return effect
    }

    const {
        maxRetries = 0,
        initialDelay = "100 millis",
        factor = 2,
    } = retryOptions

    // Schedule: Exponential backoff limited by max retries
    const policy = Schedule.exponential(initialDelay, factor).pipe(
        Schedule.intersect(Schedule.recurs(maxRetries)),
    )

    return effect.pipe(Effect.retry(policy))
}

/**
 * Forward a request to an endpoint (legacy API - buffers body internally).
 * 
 * ⚠️ WARNING: This function buffers the body on each call. If you're using
 * failover (trying multiple endpoints), use `bufferRequestBody` once and
 * pass the result to `forwardRequest` for each attempt.
 * 
 * @deprecated Use forwardRequest with pre-buffered body for failover scenarios
 */
export const forwardRequestSimple = (
    endpoint: Endpoint,
    request: Request,
): Effect.Effect<Response, RequestForwardError> =>
    Effect.gen(function* () {
        const bufferedBody = yield* bufferRequestBody(request)
        return yield* forwardRequest(endpoint, request, bufferedBody)
    })
