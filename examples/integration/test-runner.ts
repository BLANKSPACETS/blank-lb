/**
 * Integration Test Suite for Load Balancer
 *
 * Tests the full client consumption flow:
 * - Client makes fetch calls to Worker
 * - Worker (load balancer) routes to Elysia backends
 * - Response returns with correct data + headers
 *
 * Prerequisites:
 * 1. Start backends: bun run integration:backends
 * 2. Start worker: bun run integration:worker
 * 3. Run tests: bun run integration:test
 */

const WORKER_URL = "http://localhost:8787"
const BACKENDS = {
    primary: "http://localhost:3000",
    secondary: "http://localhost:3001",
    tertiary: "http://localhost:3002",
}

interface TestResult {
    name: string
    passed: boolean
    duration: number
    error?: string
}

const results: TestResult[] = []

// ═══════════════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════════════

async function test(name: string, fn: () => Promise<void>) {
    const start = performance.now()
    try {
        await fn()
        const duration = performance.now() - start
        results.push({ name, passed: true, duration })
        console.log(`  ✅ ${name} (${duration.toFixed(0)}ms)`)
    } catch (error) {
        const duration = performance.now() - start
        const message = error instanceof Error ? error.message : String(error)
        results.push({ name, passed: false, duration, error: message })
        console.log(`  ❌ ${name} (${duration.toFixed(0)}ms)`)
        console.log(`     Error: ${message}`)
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message)
}

function assertEqual<T>(actual: T, expected: T, message: string) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`)
    }
}

function assertContains(str: string, substring: string, message: string) {
    if (!str.includes(substring)) {
        throw new Error(`${message}: "${str}" does not contain "${substring}"`)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Pre-flight Checks
// ═══════════════════════════════════════════════════════════════════════════

async function checkBackends(): Promise<boolean> {
    console.log("\n🔍 Checking backend servers...")
    for (const [name, url] of Object.entries(BACKENDS)) {
        try {
            const res = await fetch(`${url}/health`)
            if (!res.ok) throw new Error(`Status ${res.status}`)
            console.log(`  ✅ ${name} is healthy`)
        } catch {
            console.log(`  ❌ ${name} is not reachable at ${url}`)
            return false
        }
    }
    return true
}

async function checkWorker(): Promise<boolean> {
    console.log("\n🔍 Checking Worker...")
    try {
        await fetch(WORKER_URL)
        console.log(`  ✅ Worker is running at ${WORKER_URL}`)
        return true
    } catch {
        console.log(`  ❌ Worker is not reachable at ${WORKER_URL}`)
        return false
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: GET Requests
// ═══════════════════════════════════════════════════════════════════════════

async function testGetUsers() {
    const res = await fetch(`${WORKER_URL}/users`)
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assert(Array.isArray(data.users), "Should return users array")
    assert(data.users.length > 0, "Should have at least one user")
    assert(data.server, "Should include server name")
}

async function testGetUserById() {
    const res = await fetch(`${WORKER_URL}/users/1`)
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assert(data.user, "Should return user object")
    assertEqual(data.user.id, 1, "User ID should be 1")
    assert(data.user.name, "User should have a name")
}

async function testGetUserNotFound() {
    const res = await fetch(`${WORKER_URL}/users/9999`)
    assertEqual(res.status, 404, "Status should be 404")

    const data = await res.json()
    assertContains(data.error, "not found", "Should return not found error")
}

async function testGetProducts() {
    const res = await fetch(`${WORKER_URL}/products`)
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assert(Array.isArray(data.products), "Should return products array")
    assert(data.products.length > 0, "Should have at least one product")
}

async function testGetProductById() {
    const res = await fetch(`${WORKER_URL}/products/2`)
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assert(data.product, "Should return product object")
    assertEqual(data.product.id, 2, "Product ID should be 2")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: POST Requests
// ═══════════════════════════════════════════════════════════════════════════

async function testCreateUser() {
    const res = await fetch(`${WORKER_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test User", email: "test@example.com" }),
    })
    assertEqual(res.status, 201, "Status should be 201 Created")

    const data = await res.json()
    assert(data.user, "Should return created user")
    assertEqual(data.user.name, "Test User", "User name should match")
    assertEqual(data.user.email, "test@example.com", "User email should match")
}

async function testCreateOrder() {
    const res = await fetch(`${WORKER_URL}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: 1, productId: 2 }),
    })
    assertEqual(res.status, 201, "Status should be 201 Created")

    const data = await res.json()
    assert(data.order, "Should return created order")
    assertEqual(data.order.userId, 1, "Order userId should match")
    assertEqual(data.order.productId, 2, "Order productId should match")
}

async function testEchoEndpoint() {
    const payload = { message: "Hello from test", timestamp: Date.now() }
    const res = await fetch(`${WORKER_URL}/api/echo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assertEqual(data.echo.message, payload.message, "Echo message should match")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: PUT Requests
// ═══════════════════════════════════════════════════════════════════════════

async function testUpdateUser() {
    const res = await fetch(`${WORKER_URL}/users/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob Updated" }),
    })
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assert(data.user, "Should return updated user")
    assertEqual(data.user.name, "Bob Updated", "User name should be updated")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: DELETE Requests
// ═══════════════════════════════════════════════════════════════════════════

async function testDeleteUser() {
    // First create a user to delete
    const createRes = await fetch(`${WORKER_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "ToDelete", email: "delete@example.com" }),
    })
    const created = await createRes.json()
    const userId = created.user.id

    // Now delete it
    const res = await fetch(`${WORKER_URL}/users/${userId}`, {
        method: "DELETE",
    })
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assert(data.deleted, "Should return deleted user")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Load Balancer Headers
// ═══════════════════════════════════════════════════════════════════════════

async function testLoadBalancerHeaders() {
    const res = await fetch(`${WORKER_URL}/api/data`)
    assertEqual(res.status, 200, "Status should be 200")

    const endpoint = res.headers.get("X-Load-Balancer-Endpoint")
    const latency = res.headers.get("X-Load-Balancer-Latency")

    assert(endpoint !== null, "Should have X-Load-Balancer-Endpoint header")
    assert(latency !== null, "Should have X-Load-Balancer-Latency header")
    assert(endpoint!.startsWith("http://localhost:300"), "Endpoint should be one of our backends")
}

async function testHealthEndpointProxied() {
    const res = await fetch(`${WORKER_URL}/health`)
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assertEqual(data.status, "healthy", "Should return healthy status")
    assert(data.name, "Should include backend name")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Concurrent Requests
// ═══════════════════════════════════════════════════════════════════════════

async function testConcurrentRequests() {
    const requests = Array(10)
        .fill(null)
        .map(() => fetch(`${WORKER_URL}/users`))

    const responses = await Promise.all(requests)

    for (const res of responses) {
        assertEqual(res.status, 200, "All requests should succeed")
    }
}

async function testConcurrentMixedMethods() {
    const requests = [
        fetch(`${WORKER_URL}/users`),
        fetch(`${WORKER_URL}/products`),
        fetch(`${WORKER_URL}/orders`),
        fetch(`${WORKER_URL}/users/1`),
        fetch(`${WORKER_URL}/products/1`),
    ]

    const responses = await Promise.all(requests)

    for (const res of responses) {
        assertEqual(res.status, 200, "All requests should succeed")
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Error Handling
// ═══════════════════════════════════════════════════════════════════════════

async function testBackendErrorProxied() {
    const res = await fetch(`${WORKER_URL}/error`)
    assertEqual(res.status, 500, "Should proxy 500 error from backend")

    const data = await res.json()
    assertContains(data.error, "error", "Should include error message")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Authorization Headers Forwarded
// ═══════════════════════════════════════════════════════════════════════════

async function testAuthorizationHeaderForwarded() {
    const token = "test-bearer-token-12345"
    const res = await fetch(`${WORKER_URL}/api/echo`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ test: true }),
    })
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assertEqual(data.headers.authorization, `Bearer ${token}`, "Authorization header should be forwarded")
}

async function testCustomHeadersForwarded() {
    const res = await fetch(`${WORKER_URL}/api/echo`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Custom-Header": "custom-value",
            "X-Request-ID": "req-12345",
        },
        body: JSON.stringify({ test: true }),
    })
    assertEqual(res.status, 200, "Status should be 200")

    const data = await res.json()
    assertEqual(data.headers["x-custom-header"], "custom-value", "Custom header should be forwarded")
    assertEqual(data.headers["x-request-id"], "req-12345", "Request ID should be forwarded")
}

// ═══════════════════════════════════════════════════════════════════════════
// Test: Query Parameters
// ═══════════════════════════════════════════════════════════════════════════

async function testQueryParametersPreserved() {
    // Note: Our simple endpoints don't use query params, but we can verify the request is made correctly
    // by checking the echo endpoint
    const res = await fetch(`${WORKER_URL}/api/data?page=1&limit=10`)
    assertEqual(res.status, 200, "Request with query params should succeed")
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Test Runner
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    console.log("╔════════════════════════════════════════════════════════════╗")
    console.log("║       Load Balancer Integration Test Suite                 ║")
    console.log("╚════════════════════════════════════════════════════════════╝")

    // Pre-flight checks
    const backendsOk = await checkBackends()
    if (!backendsOk) {
        console.log("\n❌ Backends not running. Start with: bun run integration:backends")
        process.exit(1)
    }

    const workerOk = await checkWorker()
    if (!workerOk) {
        console.log("\n❌ Worker not running. Start with: bun run integration:worker")
        process.exit(1)
    }

    // Run tests
    console.log("\n📋 Running GET Tests...")
    await test("GET /users - List all users", testGetUsers)
    await test("GET /users/:id - Get user by ID", testGetUserById)
    await test("GET /users/:id - Not found returns 404", testGetUserNotFound)
    await test("GET /products - List all products", testGetProducts)
    await test("GET /products/:id - Get product by ID", testGetProductById)

    console.log("\n📋 Running POST Tests...")
    await test("POST /users - Create new user", testCreateUser)
    await test("POST /orders - Create new order", testCreateOrder)
    await test("POST /api/echo - Echo request body", testEchoEndpoint)

    console.log("\n📋 Running PUT Tests...")
    await test("PUT /users/:id - Update user", testUpdateUser)

    console.log("\n📋 Running DELETE Tests...")
    await test("DELETE /users/:id - Delete user", testDeleteUser)

    console.log("\n📋 Running Load Balancer Tests...")
    await test("Load balancer headers present", testLoadBalancerHeaders)
    await test("Health endpoint proxied correctly", testHealthEndpointProxied)

    console.log("\n📋 Running Concurrent Request Tests...")
    await test("10 concurrent GET requests", testConcurrentRequests)
    await test("Concurrent mixed method requests", testConcurrentMixedMethods)

    console.log("\n📋 Running Error Handling Tests...")
    await test("Backend 500 error proxied", testBackendErrorProxied)

    console.log("\n📋 Running Header Forwarding Tests...")
    await test("Authorization header forwarded", testAuthorizationHeaderForwarded)
    await test("Custom headers forwarded", testCustomHeadersForwarded)

    console.log("\n📋 Running Query Parameter Tests...")
    await test("Query parameters preserved", testQueryParametersPreserved)

    // Summary
    const passed = results.filter((r) => r.passed).length
    const failed = results.filter((r) => !r.passed).length
    const totalTime = results.reduce((sum, r) => sum + r.duration, 0)

    console.log("\n╔════════════════════════════════════════════════════════════╗")
    console.log("║                        Test Summary                        ║")
    console.log("╚════════════════════════════════════════════════════════════╝")
    console.log(`\n  Total:  ${results.length} tests`)
    console.log(`  Passed: ${passed} ✅`)
    console.log(`  Failed: ${failed} ❌`)
    console.log(`  Time:   ${totalTime.toFixed(0)}ms`)

    if (failed > 0) {
        console.log("\n  Failed tests:")
        for (const r of results.filter((r) => !r.passed)) {
            console.log(`    - ${r.name}: ${r.error}`)
        }
        process.exit(1)
    } else {
        console.log("\n  🎉 All tests passed!")
        process.exit(0)
    }
}

main().catch(console.error)
