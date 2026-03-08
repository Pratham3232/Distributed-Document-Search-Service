# Distributed Document Search Service

A multi-tenant document search service built with NestJS, Elasticsearch, PostgreSQL, and Redis. Designed for enterprise-scale full-text search with sub-second response times.

## Architecture

```
Client → NestJS API → PostgreSQL (source of truth)
                    → Elasticsearch (search index, per-tenant)
                    → Redis (cache + queue + rate limiting)
```

**Key design decisions**:
- **Tenant isolation**: Separate Elasticsearch index per tenant + row-level PG scoping
- **Async indexing**: Bull queue decouples write latency from index latency
- **Cache-aside**: Redis caches search results with 5-min TTL, invalidated on writes
- **Rate limiting**: Per-tenant token bucket via `@nestjs/throttler`

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design document.

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)

### Run with Docker Compose

```bash
# Start all services
docker-compose up -d

# Check health
curl http://localhost:3000/api/v1/health

# Check readiness (all dependencies)
curl http://localhost:3000/api/v1/health/ready
```

### Run Locally (Development)

```bash
# Start infrastructure only
docker-compose up -d postgres elasticsearch redis

# Install dependencies
npm install

# Start the app
npm run start:dev

# Seed sample data (3 tenants × 10 documents)
npm run seed
```

## API Reference

All document/search endpoints require the `X-Tenant-ID` header.

### Create a Tenant

```bash
curl -X POST http://localhost:3000/api/v1/tenants \
  -H "Content-Type: application/json" \
  -d '{"slug": "acme-corp", "name": "Acme Corporation", "rateLimitPerMinute": 200}'
```

### Index a Document

```bash
curl -X POST http://localhost:3000/api/v1/documents \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme-corp" \
  -d '{
    "title": "Elasticsearch Best Practices",
    "content": "When running Elasticsearch in production, consider shard sizing, use dedicated master nodes...",
    "tags": ["elasticsearch", "production", "devops"],
    "metadata": {"author": "Jane Doe", "department": "Engineering"}
  }'
```

### Search Documents

```bash
# Basic search
curl "http://localhost:3000/api/v1/search?q=elasticsearch" \
  -H "X-Tenant-ID: acme-corp"

# Fuzzy search with highlighting and tag filter
curl "http://localhost:3000/api/v1/search?q=elastisearch&fuzzy=true&highlight=true&tags=devops" \
  -H "X-Tenant-ID: acme-corp"

# Paginated search
curl "http://localhost:3000/api/v1/search?q=distributed+systems&page=2&limit=10" \
  -H "X-Tenant-ID: acme-corp"

# Date range filter
curl "http://localhost:3000/api/v1/search?q=architecture&dateFrom=2026-01-01&dateTo=2026-12-31" \
  -H "X-Tenant-ID: acme-corp"
```

### Get Document by ID

```bash
curl http://localhost:3000/api/v1/documents/{document-id} \
  -H "X-Tenant-ID: acme-corp"
```

### Delete a Document

```bash
curl -X DELETE http://localhost:3000/api/v1/documents/{document-id} \
  -H "X-Tenant-ID: acme-corp"
```

### List Tenant Documents

```bash
curl "http://localhost:3000/api/v1/documents?page=1&limit=20" \
  -H "X-Tenant-ID: acme-corp"
```

### Health Check

```bash
# Liveness
curl http://localhost:3000/api/v1/health

# Readiness (checks PG, ES, Redis)
curl http://localhost:3000/api/v1/health/ready
```

## Search Features

| Feature | Query Parameter | Example |
|---------|----------------|---------|
| Full-text search | `q` | `q=distributed systems` |
| Fuzzy matching | `fuzzy=true` | Handles typos like `elastisearch` |
| Highlighting | `highlight=true` | Returns `<mark>` wrapped matches |
| Tag facets | Returned in response | `facets.tags: [{key, count}]` |
| Tag filter | `tags=tag1,tag2` | Filter by one or more tags |
| Date range | `dateFrom`, `dateTo` | ISO date strings |
| Pagination | `page`, `limit` | `page=2&limit=10` |

## Testing

```bash
# Unit tests
npm test

# Unit tests with coverage
npm run test:cov

# E2E tests (requires running infrastructure)
npm run test:e2e
```

## Project Structure

```
src/
├── main.ts                          # Bootstrap, global pipes/filters
├── app.module.ts                    # Root module wiring
├── config/
│   └── configuration.ts             # Environment config loader
├── common/
│   ├── decorators/tenant.decorator.ts   # @TenantId() param decorator
│   ├── guards/tenant.guard.ts           # X-Tenant-ID validation
│   ├── interceptors/logging.interceptor.ts
│   ├── filters/http-exception.filter.ts
│   └── interfaces/tenant-request.interface.ts
├── modules/
│   ├── documents/
│   │   ├── documents.controller.ts  # CRUD endpoints
│   │   ├── documents.service.ts     # Business logic
│   │   ├── documents.processor.ts   # Bull queue consumer
│   │   ├── documents.module.ts
│   │   ├── dto/create-document.dto.ts
│   │   └── entities/document.entity.ts
│   ├── search/
│   │   ├── search.controller.ts     # GET /search
│   │   ├── search.service.ts        # Cache-aside search
│   │   ├── elasticsearch.service.ts # ES client wrapper
│   │   ├── search.module.ts
│   │   └── dto/search-query.dto.ts
│   ├── tenants/
│   │   ├── tenants.controller.ts
│   │   ├── tenants.service.ts
│   │   ├── tenants.module.ts
│   │   ├── dto/create-tenant.dto.ts
│   │   └── entities/tenant.entity.ts
│   └── health/
│       ├── health.controller.ts     # /health, /health/ready
│       ├── health.service.ts        # Dependency checks
│       └── health.module.ts
└── scripts/
    └── seed.ts                      # Sample data seeder

docs/
├── ARCHITECTURE.md                  # Architecture design document
└── PRODUCTION_READINESS.md          # Production readiness analysis
```

## Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Framework | NestJS (TypeScript) | Enterprise-grade DI, modular, decorator-based |
| Search | Elasticsearch 8.x | Industry standard for full-text search with BM25 ranking |
| Database | PostgreSQL 16 | ACID source of truth, JSON support, proven at scale |
| Cache | Redis 7 | Sub-ms latency, versatile (cache + queue + rate limit) |
| Queue | Bull (Redis-backed) | Simple task queue with retries, no extra infrastructure |
| Container | Docker + Compose | Reproducible local dev and production deployment |

## Documentation

- [Architecture Design Document](docs/ARCHITECTURE.md) — System diagrams, data flow, API contracts, trade-offs
- [Production Readiness Analysis](docs/PRODUCTION_READINESS.md) — Scalability, resilience, security, observability, operations
# Distributed-Document-Search-Service
