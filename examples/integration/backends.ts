/**
 * Backend servers for integration testing
 * 
 * Run with: bun run examples/integration/backends.ts
 * 
 * Creates 3 Elysia servers on ports 3000, 3001, 3002
 */
import { Elysia } from "elysia"

interface ServerConfig {
    port: number
    name: string
    region: string
    healthy?: boolean
    delay?: number
}

const createBackend = (config: ServerConfig) => {
    const { port, name, region, healthy = true, delay = 0 } = config

    const app = new Elysia()
        .get("/", () => ({
            name,
            region,
            port,
            status: "running",
            timestamp: new Date().toISOString(),
        }))
        .get("/health", async ({ set }) => {
            if (delay > 0) {
                await Bun.sleep(delay)
            }

            if (!healthy) {
                set.status = 503
                return { status: "unhealthy", name, region }
            }

            return { status: "healthy", name, region }
        })
        .get("/api/data", () => ({
            message: `Response from ${name}`,
            server: name,
            region,
            port,
            timestamp: Date.now(),
        }))
        .post("/api/echo", ({ body }) => ({
            echo: body,
            server: name,
            region,
        }))
        .get("/slow", async () => {
            await Bun.sleep(5000)
            return { status: "slow response", server: name }
        })
        .get("/error", ({ set }) => {
            set.status = 500
            return { error: "Internal server error", server: name }
        })
        .listen(port)

    console.log(`🚀 ${name} (${region}) running on http://localhost:${port}`)
    return app
}

// Create three backend servers simulating different regions
const backends = [
    createBackend({ port: 3000, name: "primary", region: "us-east" }),
    createBackend({ port: 3001, name: "secondary", region: "eu-west" }),
    createBackend({ port: 3002, name: "tertiary", region: "ap-south" }),
]

console.log("\n✅ All backend servers are running!")
console.log("📋 Endpoints available:")
console.log("   GET  /          - Server info")
console.log("   GET  /health    - Health check")
console.log("   GET  /api/data  - Sample API response")
console.log("   POST /api/echo  - Echo request body")
console.log("   GET  /slow      - Delayed response (5s)")
console.log("   GET  /error     - Returns 500 error")
console.log("\nPress Ctrl+C to stop all servers\n")

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down backend servers...")
    backends.forEach((app) => app.stop())
    process.exit(0)
})
