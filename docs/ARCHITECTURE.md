# Architecture Design Document — Distributed Document Search Service

## 1. High-Level System Architecture

```
                                ┌─────────────────┐
                                │   Load Balancer  │
                                │  (NGINX / ALB)   │
                                └────────┬─────────┘
                                         │
                    ┌────────────────────┬┴────────────────────┐
                    │                    │                      │
              ┌─────▼─────┐      ┌──────▼──────┐       ┌──────▼──────┐
              │  App Node  │      │  App Node   │       │  App Node   │
              │ (NestJS)   │      │  (NestJS)   │       │  (NestJS)   │
              └──┬───┬───┬─┘      └──┬──┬───┬──┘       └──┬──┬───┬──┘
                 │   │   │           │  │   │              │  │   │
        ┌────────┘   │   └───────┐   │  │   │     ┌───────┘  │   └───────┐
        ▼            ▼           ▼   │  │   │     ▼           ▼           ▼
  ┌──────────┐ ┌──────────┐ ┌───────▼──▼───▼───────┐  ┌──────────┐
  │PostgreSQL│ │  Redis    │ │   Elasticsearch      │  │  Bull     │
  │ (Primary │ │ (Cluster) │ │   Cluster            │  │  Queue    │
  │  + Read  │ │           │ │ ┌───────┬───────┐    │  │ (Redis)   │
  │ Replicas)│ │ • Cache   │ │ │ Data  │ Data  │    │  │           │
  │          │ │ • Rate    │ │ │ Node 1│ Node 2│    │  │ • Async   │
  │ • Tenant │ │   Limit   │ │ └───────┴───────┘    │  │   Index   │
  │   Meta   │ │ • Session │ │ • Tenant Indices     │  │ • Retry   │
  │ • Doc    │ │ • Queue   │ │ • Full-text Search   │  │   Logic   │
  │   Store  │ │   Backend │ │ • Relevance Ranking  │  │           │
  └──────────┘ └──────────┘ └───────────────────────┘  └──────────┘
```

## 2. Data Flow Diagrams

### Indexing Flow (Write Path)

```
Client ──POST /documents──▶ API Gateway
                                │
                         ┌──────▼──────┐
                         │ TenantGuard │  Validate X-Tenant-ID
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │  Rate Limit │  Per-tenant throttling
                         └──────┬──────┘
                                │
                         ┌──────▼──────────┐
                         │ DocumentsService │
                         │  1. Validate DTO │
                         │  2. Save to PG   │
                         │  3. Queue index  │
                         └──────┬──────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Bull Queue (Redis)   │
                    │ "document-indexing"     │
                    └───────────┬───────────┘
                                │ (async)
                    ┌───────────▼───────────┐
                    │ DocumentsProcessor     │
                    │ 1. Fetch from PG       │
                    │ 2. Index to ES         │
                    │ 3. Update indexStatus  │
                    │ Retry: 3x exponential  │
                    └───────────────────────┘
```

### Search Flow (Read Path)

```
Client ──GET /search?q=...──▶ API Gateway
                                   │
                            ┌──────▼──────┐
                            │ TenantGuard │
                            └──────┬──────┘
                                   │
                            ┌──────▼──────┐
                            │  Rate Limit │
                            └──────┬──────┘
                                   │
                            ┌──────▼──────────┐
                            │  SearchService   │
                            │  1. Check Redis  │──── HIT ──▶ Return cached
                            │     cache        │
                            │  2. MISS: query  │
                            │     Elasticsearch│
                            │  3. Cache result │
                            │  4. Return       │
                            └──────────────────┘
```

## 3. Database/Storage Strategy

### PostgreSQL — Source of Truth
- **Why**: ACID compliance for document metadata, tenant management, audit trail
- **Schema**: Two main tables — `tenants` (tenant config, rate limits) and `documents` (metadata, content, index status)
- **Indexing**: B-tree on `tenantId + createdAt` for time-range queries; unique index on tenant slug

### Elasticsearch — Search Engine
- **Why**: Purpose-built for full-text search with BM25 relevance scoring, fuzzy matching, faceted aggregations, and hit highlighting
- **Index Strategy**: One index per tenant (`documents_{tenant_slug}`) for data isolation and independent scaling
- **Mapping**: Custom analyzers with English stopwords; multi-field mapping on `title` (text + keyword + suggest)
- **Sharding**: 2 primary shards per index, 1 replica — balances search parallelism and fault tolerance

### Redis — Cache + Queue + Rate Limiting
- **Why**: Sub-millisecond latency, versatile data structures, atomic operations
- **Cache**: Search results cached with TTL (5 min default), tenant-scoped keys
- **Queue Backend**: Bull queue for async document indexing with retry semantics
- **Rate Limiting**: Token bucket per tenant using `@nestjs/throttler` backed by Redis

## 4. API Design

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/v1/documents` | Index a new document | `X-Tenant-ID` |
| `GET` | `/api/v1/documents` | List tenant documents (paginated) | `X-Tenant-ID` |
| `GET` | `/api/v1/documents/:id` | Get document by ID | `X-Tenant-ID` |
| `DELETE` | `/api/v1/documents/:id` | Delete document + remove from index | `X-Tenant-ID` |
| `GET` | `/api/v1/search?q=...` | Full-text search with facets | `X-Tenant-ID` |
| `POST` | `/api/v1/tenants` | Provision a tenant | — |
| `GET` | `/api/v1/tenants` | List all tenants | — |
| `GET` | `/api/v1/health` | Liveness check | — |
| `GET` | `/api/v1/health/ready` | Readiness check (all deps) | — |

### Request/Response Contract

**POST /api/v1/documents**
```json
// Request
{
  "title": "Elasticsearch Best Practices",
  "content": "When running ES in production...",
  "tags": ["elasticsearch", "devops"],
  "metadata": { "author": "Jane Doe", "department": "Engineering" }
}

// Response (201)
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tenantId": "acme-corp",
  "title": "Elasticsearch Best Practices",
  "content": "When running ES in production...",
  "tags": ["elasticsearch", "devops"],
  "metadata": { "author": "Jane Doe", "department": "Engineering" },
  "indexStatus": "pending",
  "createdAt": "2026-03-08T12:00:00.000Z",
  "updatedAt": "2026-03-08T12:00:00.000Z"
}
```

**GET /api/v1/search?q=elasticsearch&fuzzy=true&highlight=true**
```json
{
  "hits": [
    {
      "id": "550e8400-...",
      "score": 8.23,
      "document": { "title": "...", "content": "...", "tags": [...] },
      "highlight": {
        "title": ["<mark>Elasticsearch</mark> Best Practices"],
        "content": ["When running <mark>ES</mark> in production..."]
      }
    }
  ],
  "total": 15,
  "took": 12,
  "page": 1,
  "limit": 20,
  "facets": {
    "tags": [
      { "key": "elasticsearch", "count": 5 },
      { "key": "devops", "count": 3 }
    ]
  }
}
```

## 5. Consistency Model and Trade-offs

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Document writes** | Strong consistency (PG) | ACID guarantees for source of truth |
| **Search index** | Eventual consistency | Async queue with `refresh: wait_for` gives near-real-time (~1s) |
| **Cache** | TTL-based expiration | 5-minute TTL balances freshness vs. performance; invalidation on write |
| **Multi-tenancy** | Index-per-tenant | Strongest isolation; avoids noisy-neighbor; independent lifecycle |

**Trade-off Analysis**: We accept eventual consistency between PostgreSQL (source of truth) and Elasticsearch (search index) because:
1. Search is inherently approximate — users expect relevance-ranked results, not transactional reads
2. The queue provides at-least-once delivery with 3 retries and exponential backoff
3. The `indexStatus` field on the document entity lets clients poll for indexing completion if needed

## 6. Caching Strategy

```
Layer 1: Application Cache (Redis)
├── Search results: key = "search:{tenantId}:{queryHash}", TTL = 5min
├── Invalidation: on document create/delete, clear tenant's cache namespace
└── Cache-aside pattern: check cache → miss → query ES → cache result

Layer 2: Elasticsearch Internal Caches
├── Node query cache: filters cached per shard
├── Fielddata cache: aggregations on keyword fields
└── Request cache: identical queries cached at shard level

Layer 3: OS Page Cache
└── Elasticsearch memory-maps indices; OS caches hot segments
```

## 7. Message Queue for Asynchronous Operations

**Bull (Redis-backed)** handles the `document-indexing` queue:
- **index** job: Reads document from PG, indexes to Elasticsearch, updates `indexStatus`
- **delete** job: Removes document from Elasticsearch index
- **Retry policy**: 3 attempts with exponential backoff (1s, 2s, 4s)
- **Dead letter**: Failed jobs after all retries logged for manual inspection
- **Concurrency**: Configurable workers per node (default: 5 concurrent)

**Why Bull over Kafka/RabbitMQ**: For this prototype's scale, Bull provides task queue semantics (retries, backoff, job status) without operational overhead of a separate message broker. In production, migrate to RabbitMQ or Kafka for durability guarantees and consumer group semantics.

## 8. Multi-Tenancy Approach

```
┌─────────────────────────────────────────────┐
│              Request Flow                    │
│                                             │
│  Header: X-Tenant-ID: acme-corp             │
│           │                                 │
│  ┌────────▼────────┐                       │
│  │  TenantGuard    │ Validates header       │
│  │  Sets tenantId  │ on request object      │
│  └────────┬────────┘                       │
│           │                                 │
│  ┌────────▼────────┐                       │
│  │ PostgreSQL      │ WHERE tenantId = ?     │
│  │ Row-level       │                       │
│  │ isolation       │                       │
│  └────────┬────────┘                       │
│           │                                 │
│  ┌────────▼────────────────┐               │
│  │ Elasticsearch           │               │
│  │ Index: documents_acme   │ Index-level   │
│  │ (separate per tenant)   │ isolation     │
│  └────────┬────────────────┘               │
│           │                                 │
│  ┌────────▼────────┐                       │
│  │ Redis Cache     │ Key prefix:           │
│  │ search:acme:... │ tenant-scoped         │
│  └─────────────────┘                       │
└─────────────────────────────────────────────┘
```

**Isolation Levels**:
- **Data**: Separate ES indices per tenant; PG rows scoped by `tenantId` column
- **Performance**: Per-tenant rate limiting prevents noisy-neighbor
- **Configuration**: Per-tenant settings stored in `tenants` table (rate limits, feature flags)
- **Security**: TenantGuard rejects requests without valid tenant header; all queries scoped
