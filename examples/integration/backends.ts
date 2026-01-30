/**
 * Backend servers for integration testing
 *
 * Run with: bun run examples/integration/backends.ts
 *
 * Creates 3 Elysia servers on ports 3000, 3001, 3002
 * Each server simulates a REST API with users, products, and orders
 */
import { Elysia, t } from "elysia"

interface ServerConfig {
    port: number
    name: string
    region: string
    healthy?: boolean
    delay?: number
}

// In-memory data store (shared concept, but each server has its own instance)
const createDataStore = (serverName: string) => ({
    users: [
        { id: 1, name: "Alice", email: "alice@example.com", server: serverName },
        { id: 2, name: "Bob", email: "bob@example.com", server: serverName },
        { id: 3, name: "Charlie", email: "charlie@example.com", server: serverName },
    ],
    products: [
        { id: 1, name: "Laptop", price: 999, server: serverName },
        { id: 2, name: "Phone", price: 699, server: serverName },
        { id: 3, name: "Tablet", price: 499, server: serverName },
    ],
    orders: [] as Array<{ id: number; userId: number; productId: number; server: string }>,
    nextOrderId: 1,
})

const createBackend = (config: ServerConfig) => {
    const { port, name, region, healthy = true, delay = 0 } = config
    const data = createDataStore(name)

    const app = new Elysia()
        // ═══════════════════════════════════════════════════════════
        // Health & Info
        // ═══════════════════════════════════════════════════════════
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

        // ═══════════════════════════════════════════════════════════
        // Users REST API
        // ═══════════════════════════════════════════════════════════
        .get("/users", () => ({
            users: data.users,
            total: data.users.length,
            server: name,
        }))
        .get("/users/:id", ({ params, set }) => {
            const user = data.users.find((u) => u.id === Number(params.id))
            if (!user) {
                set.status = 404
                return { error: "User not found", server: name }
            }
            return { user, server: name }
        })
        .post(
            "/users",
            ({ body, set }) => {
                const newUser = {
                    id: data.users.length + 1,
                    name: (body as { name: string }).name,
                    email: (body as { email: string }).email,
                    server: name,
                }
                data.users.push(newUser)
                set.status = 201
                return { user: newUser, server: name }
            },
            {
                body: t.Object({
                    name: t.String(),
                    email: t.String(),
                }),
            },
        )
        .put(
            "/users/:id",
            ({ params, body, set }) => {
                const index = data.users.findIndex((u) => u.id === Number(params.id))
                if (index === -1) {
                    set.status = 404
                    return { error: "User not found", server: name }
                }
                data.users[index] = {
                    ...data.users[index],
                    name: (body as { name?: string }).name ?? data.users[index].name,
                    email: (body as { email?: string }).email ?? data.users[index].email,
                }
                return { user: data.users[index], server: name }
            },
            {
                body: t.Object({
                    name: t.Optional(t.String()),
                    email: t.Optional(t.String()),
                }),
            },
        )
        .delete("/users/:id", ({ params, set }) => {
            const index = data.users.findIndex((u) => u.id === Number(params.id))
            if (index === -1) {
                set.status = 404
                return { error: "User not found", server: name }
            }
            const deleted = data.users.splice(index, 1)[0]
            return { deleted, server: name }
        })

        // ═══════════════════════════════════════════════════════════
        // Products REST API
        // ═══════════════════════════════════════════════════════════
        .get("/products", () => ({
            products: data.products,
            total: data.products.length,
            server: name,
        }))
        .get("/products/:id", ({ params, set }) => {
            const product = data.products.find((p) => p.id === Number(params.id))
            if (!product) {
                set.status = 404
                return { error: "Product not found", server: name }
            }
            return { product, server: name }
        })

        // ═══════════════════════════════════════════════════════════
        // Orders REST API
        // ═══════════════════════════════════════════════════════════
        .get("/orders", () => ({
            orders: data.orders,
            total: data.orders.length,
            server: name,
        }))
        .post(
            "/orders",
            ({ body, set }) => {
                const newOrder = {
                    id: data.nextOrderId++,
                    userId: (body as { userId: number }).userId,
                    productId: (body as { productId: number }).productId,
                    server: name,
                }
                data.orders.push(newOrder)
                set.status = 201
                return { order: newOrder, server: name }
            },
            {
                body: t.Object({
                    userId: t.Number(),
                    productId: t.Number(),
                }),
            },
        )

        // ═══════════════════════════════════════════════════════════
        // Echo & Debug
        // ═══════════════════════════════════════════════════════════
        .post("/api/echo", ({ body, headers }) => ({
            echo: body,
            headers: Object.fromEntries(Object.entries(headers)),
            server: name,
            region,
        }))
        .get("/api/data", () => ({
            message: `Response from ${name}`,
            server: name,
            region,
            port,
            timestamp: Date.now(),
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
console.log("📋 REST API Endpoints:")
console.log("   GET    /              - Server info")
console.log("   GET    /health        - Health check")
console.log("")
console.log("   GET    /users         - List all users")
console.log("   GET    /users/:id     - Get user by ID")
console.log("   POST   /users         - Create user")
console.log("   PUT    /users/:id     - Update user")
console.log("   DELETE /users/:id     - Delete user")
console.log("")
console.log("   GET    /products      - List all products")
console.log("   GET    /products/:id  - Get product by ID")
console.log("")
console.log("   GET    /orders        - List all orders")
console.log("   POST   /orders        - Create order")
console.log("")
console.log("   POST   /api/echo      - Echo request body")
console.log("   GET    /api/data      - Sample API response")
console.log("   GET    /slow          - Delayed response (5s)")
console.log("   GET    /error         - Returns 500 error")
console.log("\nPress Ctrl+C to stop all servers\n")

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down backend servers...")
    backends.forEach((app) => app.stop())
    process.exit(0)
})
