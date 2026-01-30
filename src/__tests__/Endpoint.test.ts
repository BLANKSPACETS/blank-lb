/**
 * Endpoint tests
 */
import { describe, expect, it } from "@effect/vitest"
import { Endpoint, endpoint } from "../Endpoint.js"

describe("Endpoint", () => {
    describe("constructor", () => {
        it("creates an endpoint with required fields", () => {
            const ep = new Endpoint({ url: "https://api.example.com" })

            expect(ep.url).toBe("https://api.example.com")
            expect(ep.healthCheckPath).toBe("/")
            expect(ep.weight).toBe(1)
            expect(ep.timeoutMs).toBe(30000)
        })

        it("creates endpoint with valid options", () => {
            const ep = new Endpoint({
                url: "https://api.example.com",
                healthCheckPath: "/status",
                weight: 5,
            })

            expect(ep.url).toBe("https://api.example.com")
            expect(ep.healthCheckPath).toBe("/status")
            expect(ep.weight).toBe(5)
        })

        it("throws on invalid URL", () => {
            expect(() =>
                new Endpoint({
                    url: "invalid-url",
                }),
            ).toThrow()
        })

        it("throws on invalid health check path", () => {
            expect(() =>
                new Endpoint({
                    url: "https://api.example.com",
                    healthCheckPath: "status", // Missing leading slash
                }),
            ).toThrow()
        })

        it("creates an endpoint with custom options", () => {
            const ep = new Endpoint({
                url: "https://api.example.com",
                healthCheckPath: "/health",
                weight: 5,
                timeoutMs: 10000,
            })

            expect(ep.url).toBe("https://api.example.com")
            expect(ep.healthCheckPath).toBe("/health")
            expect(ep.weight).toBe(5)
            expect(ep.timeoutMs).toBe(10000)
        })
    })

    describe("endpoint() helper", () => {
        it("creates an endpoint with just URL", () => {
            const ep = endpoint("https://api.example.com")

            expect(ep.url).toBe("https://api.example.com")
            expect(ep.healthCheckPath).toBe("/")
            expect(ep.weight).toBe(1)
            expect(ep.timeoutMs).toBe(30000)
        })

        it("creates an endpoint with custom options", () => {
            const ep = endpoint("https://api.example.com", {
                healthCheckPath: "/status",
                weight: 3,
                timeoutMs: 5000,
            })

            expect(ep.url).toBe("https://api.example.com")
            expect(ep.healthCheckPath).toBe("/status")
            expect(ep.weight).toBe(3)
            expect(ep.timeoutMs).toBe(5000)
        })
    })

    describe("normalizedUrl", () => {
        it("removes trailing slash from URL", () => {
            const ep = endpoint("https://api.example.com/")
            expect(ep.normalizedUrl).toBe("https://api.example.com")
        })

        it("keeps URL without trailing slash unchanged", () => {
            const ep = endpoint("https://api.example.com")
            expect(ep.normalizedUrl).toBe("https://api.example.com")
        })

        it("removes only the final trailing slash", () => {
            const ep = endpoint("https://api.example.com/v1/")
            expect(ep.normalizedUrl).toBe("https://api.example.com/v1")
        })
    })

    describe("healthCheckUrl", () => {
        it("combines normalized URL with health check path", () => {
            const ep = endpoint("https://api.example.com/", {
                healthCheckPath: "/health",
            })
            expect(ep.healthCheckUrl).toBe("https://api.example.com/health")
        })

        it("uses default health check path", () => {
            const ep = endpoint("https://api.example.com")
            expect(ep.healthCheckUrl).toBe("https://api.example.com/")
        })
    })

    describe("buildTargetUrl", () => {
        it("builds URL with pathname and search", () => {
            const ep = endpoint("https://api.example.com")
            const targetUrl = ep.buildTargetUrl("/users", "?id=123")

            expect(targetUrl).toBe("https://api.example.com/users?id=123")
        })

        it("handles trailing slash in base URL", () => {
            const ep = endpoint("https://api.example.com/")
            const targetUrl = ep.buildTargetUrl("/users", "")

            expect(targetUrl).toBe("https://api.example.com/users")
        })

        it("handles empty search", () => {
            const ep = endpoint("https://api.example.com")
            const targetUrl = ep.buildTargetUrl("/users", "")

            expect(targetUrl).toBe("https://api.example.com/users")
        })

        it("handles complex paths", () => {
            const ep = endpoint("https://api.example.com/v1")
            const targetUrl = ep.buildTargetUrl("/users/123/posts", "?limit=10&offset=0")

            expect(targetUrl).toBe("https://api.example.com/v1/users/123/posts?limit=10&offset=0")
        })
    })

    describe("equality", () => {
        it("endpoints with same values are equal", () => {
            const ep1 = endpoint("https://api.example.com", { weight: 2 })
            const ep2 = endpoint("https://api.example.com", { weight: 2 })

            expect(ep1).toEqual(ep2)
        })

        it("endpoints with different values are not equal", () => {
            const ep1 = endpoint("https://api1.example.com")
            const ep2 = endpoint("https://api2.example.com")

            expect(ep1).not.toEqual(ep2)
        })
    })
})
