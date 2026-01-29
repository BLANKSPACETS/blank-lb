# Integration Testing with Cloudflare Workers

This directory contains a complete integration test setup for testing the load balancer against real Cloudflare Worker infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Test Runner                           │
│               (test-runner.ts)                          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP requests
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Worker (Wrangler)               │
│                   (worker.ts)                           │
│    ┌─────────────────────────────────────────────┐     │
│    │            Load Balancer                     │     │
│    │   - Geo Steering                            │     │
│    │   - Fail-Forward Availability               │     │
│    │   - Health Checking                         │     │
│    └─────────────────────────────────────────────┘     │
└────────────────────────┬────────────────────────────────┘
                         │ Proxied requests
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     ┌─────────┐   ┌─────────┐   ┌─────────┐
     │ Backend │   │ Backend │   │ Backend │
     │  :3000  │   │  :3001  │   │  :3002  │
     │ primary │   │secondary│   │tertiary │
     │ us-east │   │ eu-west │   │ap-south │
     └─────────┘   └─────────┘   └─────────┘
```

## Quick Start

### 1. Start the Backend Servers

```bash
bun run examples/integration/backends.ts
```

This starts 3 Elysia servers simulating backends in different regions:
- **Primary** (localhost:3000) - us-east
- **Secondary** (localhost:3001) - eu-west  
- **Tertiary** (localhost:3002) - ap-south

### 2. Start the Wrangler Dev Server

In a new terminal:

```bash
cd examples/integration
npx wrangler dev
```

This starts the Cloudflare Worker locally on `http://localhost:8787`.

### 3. Run Integration Tests

In a new terminal:

```bash
bun run examples/integration/test-runner.ts
```

## What Gets Tested

| Test | Description |
|------|-------------|
| Basic routing | Requests reach one of the backend servers |
| LB headers | X-Load-Balancer-Endpoint and X-Load-Balancer-Latency are present |
| Health check | /health endpoint is proxied correctly |
| POST echo | Request body is forwarded correctly |
| Concurrent requests | Multiple simultaneous requests succeed |
| Latency measurement | Response times are within acceptable range |

## Testing Failover

To test failover behavior, stop one of the backend servers:

```bash
# In the backends terminal, press Ctrl+C to stop all
# Then start only some backends:
```

Or modify `backends.ts` to simulate unhealthy backends:

```typescript
createBackend({ port: 3000, name: "primary", region: "us-east", healthy: false })
```

## Testing Geo Steering

The worker is configured with geo steering based on continents:
- **NA, SA** → Primary (localhost:3000)
- **EU, AF** → Secondary (localhost:3001)
- **AS, OC** → Tertiary (localhost:3002)

To test geo steering, you can:

1. **Deploy to Cloudflare** and make requests from different locations
2. **Use Wrangler's `--local` flag with custom headers** to simulate geo data

## Files

| File | Purpose |
|------|---------|
| `backends.ts` | Elysia servers simulating backend APIs |
| `worker.ts` | Cloudflare Worker using the load balancer |
| `wrangler.toml` | Wrangler configuration |
| `test-runner.ts` | Integration test suite |

## Production Deployment

For production, update the backend URLs in `worker.ts`:

```typescript
const BACKENDS = {
    primary: endpoint("https://api-east.yoursite.com", { healthCheckPath: "/health" }),
    secondary: endpoint("https://api-eu.yoursite.com", { healthCheckPath: "/health" }),
    tertiary: endpoint("https://api-asia.yoursite.com", { healthCheckPath: "/health" }),
}
```

Then deploy:

```bash
cd examples/integration
npx wrangler deploy
```
