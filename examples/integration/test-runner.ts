/**
 * Integration test runner for Cloudflare Worker
 * 
 * This script tests the load balancer against real Wrangler dev server.
 * 
 * Prerequisites:
 * 1. Start backend servers: bun run examples/integration/backends.ts
 * 2. Start wrangler dev: cd examples/integration && npx wrangler dev
 * 3. Run tests: bun run examples/integration/test-runner.ts
 */

const WORKER_URL = "http://localhost:8787"
const BACKEND_URLS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
]

interface TestResult {
    name: string
    passed: boolean
    message: string
    duration: number
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now()
    try {
        await fn()
        results.push({
            name,
            passed: true,
            message: "✓ Passed",
            duration: Date.now() - start,
        })
        console.log(`✅ ${name} (${Date.now() - start}ms)`)
    } catch (error) {
        results.push({
            name,
            passed: false,
            message: error instanceof Error ? error.message : String(error),
            duration: Date.now() - start,
        })
        console.log(`❌ ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message)
}

async function checkBackends(): Promise<boolean> {
    console.log("\n🔍 Checking backend servers...")
    for (const url of BACKEND_URLS) {
        try {
            const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })
            if (!res.ok) {
                console.log(`   ⚠️  ${url} - unhealthy (status ${res.status})`)
                return false
            }
            console.log(`   ✓ ${url} - healthy`)
        } catch {
            console.log(`   ❌ ${url} - unreachable`)
            return false
        }
    }
    return true
}

async function checkWorker(): Promise<boolean> {
    console.log("\n🔍 Checking Wrangler dev server...")
    try {
        await fetch(WORKER_URL, { signal: AbortSignal.timeout(2000) })
        console.log(`   ✓ Worker is running on ${WORKER_URL}`)
        return true
    } catch {
        console.log(`   ❌ Worker is not running. Start it with: cd examples/integration && npx wrangler dev`)
        return false
    }
}

// ============= Integration Tests =============

async function testBasicRouting(): Promise<void> {
    const res = await fetch(`${WORKER_URL}/api/data`)
    assert(res.ok, `Expected OK status, got ${res.status}`)

    const body = await res.json() as { server: string }
    assert(body.server !== undefined, "Expected server field in response")
    assert(["primary", "secondary", "tertiary"].includes(body.server),
        `Expected server to be one of primary/secondary/tertiary, got ${body.server}`)
}

async function testLoadBalancerHeaders(): Promise<void> {
    const res = await fetch(`${WORKER_URL}/api/data`)

    assert(res.headers.has("X-Load-Balancer-Endpoint"), "Expected X-Load-Balancer-Endpoint header")
    assert(res.headers.has("X-Load-Balancer-Latency"), "Expected X-Load-Balancer-Latency header")

    const latency = parseInt(res.headers.get("X-Load-Balancer-Latency") || "0")
    assert(latency >= 0, `Expected non-negative latency, got ${latency}`)
}

async function testHealthCheck(): Promise<void> {
    const res = await fetch(`${WORKER_URL}/health`)
    assert(res.ok, `Expected OK from /health, got ${res.status}`)

    const body = await res.json() as { status: string }
    assert(body.status === "healthy", `Expected healthy status, got ${body.status}`)
}

async function testEchoEndpoint(): Promise<void> {
    const payload = { test: "data", timestamp: Date.now() }

    const res = await fetch(`${WORKER_URL}/api/echo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })

    assert(res.ok, `Expected OK status, got ${res.status}`)

    const body = await res.json() as { echo: typeof payload; server: string }
    assert(body.echo.test === payload.test, "Expected echo to contain original data")
    assert(body.server !== undefined, "Expected server field")
}

async function testMultipleRequests(): Promise<void> {
    const requests = Array(10).fill(null).map(() =>
        fetch(`${WORKER_URL}/api/data`).then(r => r.json())
    )

    const responses = await Promise.all(requests)

    // All requests should succeed
    assert(responses.length === 10, "Expected 10 responses")

    // Each response should have server field
    for (const res of responses) {
        assert((res as { server: string }).server !== undefined, "Each response should have server field")
    }
}

async function testLatencyMeasurement(): Promise<void> {
    const latencies: number[] = []

    for (let i = 0; i < 5; i++) {
        const res = await fetch(`${WORKER_URL}/api/data`)
        const latency = parseInt(res.headers.get("X-Load-Balancer-Latency") || "0")
        latencies.push(latency)
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
    console.log(`   Average latency: ${avgLatency.toFixed(2)}ms`)

    assert(avgLatency < 500, `Expected average latency < 500ms, got ${avgLatency}ms`)
}

// ============= Main =============

async function main() {
    console.log("🧪 Load Balancer Integration Tests")
    console.log("==================================\n")

    // Pre-flight checks
    const backendsOk = await checkBackends()
    if (!backendsOk) {
        console.log("\n⚠️  Backend servers not ready. Start them with:")
        console.log("   bun run examples/integration/backends.ts")
        process.exit(1)
    }

    const workerOk = await checkWorker()
    if (!workerOk) {
        console.log("\n⚠️  Wrangler dev server not ready. Start it with:")
        console.log("   cd examples/integration && npx wrangler dev")
        process.exit(1)
    }

    console.log("\n📋 Running integration tests...\n")

    await test("Basic routing - request reaches backend", testBasicRouting)
    await test("Load balancer headers present", testLoadBalancerHeaders)
    await test("Health check passthrough", testHealthCheck)
    await test("POST echo endpoint", testEchoEndpoint)
    await test("Multiple concurrent requests", testMultipleRequests)
    await test("Latency measurement", testLatencyMeasurement)

    // Summary
    console.log("\n" + "=".repeat(40))
    const passed = results.filter(r => r.passed).length
    const failed = results.filter(r => !r.passed).length
    const totalTime = results.reduce((a, b) => a + b.duration, 0)

    console.log(`📊 Results: ${passed} passed, ${failed} failed (${totalTime}ms total)`)

    if (failed > 0) {
        console.log("\n❌ Failed tests:")
        for (const result of results.filter(r => !r.passed)) {
            console.log(`   - ${result.name}: ${result.message}`)
        }
        process.exit(1)
    } else {
        console.log("\n✅ All integration tests passed!")
    }
}

main().catch(console.error)
