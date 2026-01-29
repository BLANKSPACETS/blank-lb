# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-rc.1] - 2026-01-29

### Added

- **Core Load Balancing**
  - `LoadBalancer` service with `handleRequest` method
  - `LoadBalancer.live()` for quick setup with defaults
  - `LoadBalancer.layer()` for custom dependency injection

- **Endpoint Types**
  - `Endpoint` class with URL, health check path, weight, and timeout
  - `GeoEndpoint` class with geographic targeting configuration
  - `endpoint()` and `geoEndpoint()` convenience constructors

- **Availability Methods**
  - `fail-forward` — Sequential failover on error or status codes (default)
  - `async-block` — Sequential health checks before forwarding
  - `promise-any` — Parallel health check race

- **Geo Steering**
  - Route by continent (AF, AN, AS, EU, NA, OC, SA)
  - Route by country (ISO 3166-1 alpha-2)
  - Route by region (ISO 3166-2)
  - Route by Cloudflare colo (IATA codes)
  - Smart fallback to default endpoints

- **Health Checking**
  - `HealthChecker` service with pluggable implementation
  - `HealthCheckerLive` — Production implementation using fetch
  - `HealthCheckerTest` — Always-healthy mock for testing

- **Observability**
  - `X-Load-Balancer-Endpoint` header
  - `X-Load-Balancer-Latency` header
  - `X-Load-Balancer-Endpoint-Gather-Latency` header
  - `X-Load-Balancer-Tried-Count` header (on failover)
  - `X-Load-Balancer-Tried-Endpoints` header (on failover)

- **Error Handling**
  - `NoHealthyEndpointsError` — All endpoints exhausted
  - `EndpointUnhealthyError` — Health check failed (timeout/status/network)
  - `CircuitOpenError` — Circuit breaker open (reserved for future use)
  - `RequestForwardError` — Request forwarding failed

- **Recovery**
  - `recoveryFn` option for handling total failures
  - `RecoveryContext` with tried endpoints and last error

### Notes

This is the first release candidate. The API is considered stable but may receive minor adjustments based on feedback before the 1.0.0 release.

**Planned for future releases:**
- Circuit breaker pattern with pluggable state stores (Memory, KV, Durable Objects)
- Weighted load balancing
- Response time steering
- OpenTelemetry integration

---

## [Unreleased]

### Planned

- Circuit breaker with `StateStore` service
- `StateStoreMemory`, `StateStoreKV`, `StateStoreDO` implementations
- Weighted endpoint selection
- Response time-based steering
- `@effect/opentelemetry` integration
