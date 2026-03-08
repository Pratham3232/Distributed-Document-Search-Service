# Production Readiness Analysis

## 1. Scalability — Handling 100x Growth

### Current State → Production Target
| Metric | Prototype | Production (100x) |
|--------|-----------|-------------------|
| Documents | ~100 | 10M+ across tenants |
| Concurrent searches | ~10 | 1,000+ /sec |
| Tenants | 3 | 500+ |
| Data volume | <1GB | 500GB+ |

### Horizontal Scaling Strategy

**Application Layer**:
- Stateless NestJS nodes behind a load balancer (round-robin or least-connections)
- Kubernetes HPA scales pods based on CPU/memory/custom metrics (request latency p95)
- Target: 10-50 pods depending on load

**Elasticsearch**:
- Scale from single-node to a 5+ node cluster: 3 dedicated masters, 2+ data nodes
- Shard sizing: Target 10-50GB per shard; for 500GB total → 10-50 primary shards
- Use ILM (Index Lifecycle Management) for time-based rollover if documents are temporal
- Hot-warm-cold architecture: SSD for hot indices, HDD for older data
- Cross-cluster replication for geo-distributed search

**PostgreSQL**:
- Read replicas for query distribution (1 primary + 2-3 read replicas)
- Connection pooling with PgBouncer (pool_mode=transaction)
- Table partitioning by `tenantId` for large tenants (100K+ docs)
- Consider Citus or schema-per-tenant for extreme scale

**Redis**:
- Redis Cluster (6+ nodes) for horizontal sharding
- Separate clusters for cache vs. queue to prevent memory contention
- Redis Sentinel for HA in non-cluster mode

**Message Queue**:
- Migrate from Bull (Redis) to RabbitMQ or Apache Kafka for durability
- Kafka for event sourcing / audit log of all document operations
- Partition by tenantId for ordered processing per tenant

## 2. Resilience

### Circuit Breakers
```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  App Service  │────▶│ Circuit Breaker  │────▶│ Elasticsearch│
│               │     │ (opossum/cockatiel)│   │              │
│  Fallback:    │◀────│ States:          │     │              │
│  • Cached     │     │  CLOSED → OPEN   │     │              │
│    results    │     │  → HALF_OPEN     │     │              │
│  • PG FTS     │     │ Threshold: 5 err │     │              │
│    fallback   │     │ Timeout: 30s     │     │              │
└──────────────┘     └─────────────────┘     └──────────────┘
```

### Retry Strategy
- **Elasticsearch writes**: 3 retries, exponential backoff (1s, 2s, 4s)
- **Database connections**: Connection pool auto-reconnect with TypeORM
- **Redis**: ioredis built-in retry with `retryStrategy`
- **Queue jobs**: Bull retries with configurable attempts and backoff

### Failover Mechanisms
- **ES down**: Degrade to PostgreSQL full-text search (`ts_vector` / `tsvector`) as fallback
- **Redis down**: Bypass cache (direct ES queries); rate limiting falls back to in-memory
- **PG read replica down**: Route to primary (temporary write amplification)
- **Queue down**: Synchronous indexing as fallback (higher latency, lower throughput)

## 3. Security

### Authentication & Authorization
- **API Gateway**: JWT/OAuth2 token validation at edge (Kong, AWS API Gateway)
- **Tenant isolation**: Enforced at every layer — guard, query scope, index separation
- **RBAC**: Role-based access per tenant (admin, editor, viewer) stored in JWT claims
- **API keys**: Per-tenant API keys for service-to-service communication

### Encryption
- **In transit**: TLS 1.3 for all connections (app↔client, app↔ES, app↔PG, app↔Redis)
- **At rest**: AES-256 encryption for PG (via `pgcrypto` or disk-level), ES (encrypted-at-rest nodes)
- **Secrets**: HashiCorp Vault or AWS Secrets Manager; never in env files in production

### API Security
- Input validation (class-validator DTOs with whitelist)
- Rate limiting per tenant (configurable thresholds)
- Request size limits (1MB default for document content)
- SQL injection prevention (parameterized queries via TypeORM)
- XSS prevention (content sanitization before indexing)
- CORS whitelisting per tenant
- Helmet.js security headers

## 4. Observability

### Metrics (Prometheus + Grafana)
```
Application Metrics:
├── http_request_duration_seconds{method, path, status, tenant}
├── http_requests_total{method, path, status, tenant}
├── search_latency_seconds{tenant}
├── search_cache_hit_ratio{tenant}
├── document_index_queue_size
├── document_index_duration_seconds
└── document_index_failures_total

Infrastructure Metrics:
├── ES: cluster health, index sizes, query latency, GC pauses
├── PG: connections, query duration, replication lag, dead tuples
└── Redis: memory usage, hit ratio, connected clients, evictions
```

### Logging (ELK Stack / CloudWatch)
- Structured JSON logs with correlation IDs
- Log levels: ERROR (alerts), WARN (investigate), INFO (audit), DEBUG (development)
- Per-request fields: `tenantId`, `requestId`, `method`, `path`, `latencyMs`, `statusCode`
- Sensitive data redaction (PII, auth tokens)

### Distributed Tracing (Jaeger / OpenTelemetry)
- Trace spans: HTTP → Guard → Service → Cache → ES/PG → Response
- Propagate trace context across async queue jobs
- Sample rate: 100% in dev, 1-10% in production (adaptive sampling)

### Alerting
| Alert | Condition | Severity |
|-------|-----------|----------|
| Search p95 > 500ms | 5 min sustained | Critical |
| ES cluster yellow | Any node down | Warning |
| ES cluster red | Shard unassigned | Critical |
| Queue backlog > 10K | Growing for 10 min | Warning |
| Error rate > 1% | Per tenant | Critical |
| PG replication lag > 5s | Sustained | Warning |

## 5. Performance Optimization

### Database
- **PostgreSQL**: Partial indexes on `indexStatus = 'pending'`; GIN index for `tags` array
- **Connection pooling**: PgBouncer with 100 server connections, 1000 client connections
- **Prepared statements**: TypeORM query builder generates parameterized queries

### Elasticsearch
- **Index settings**: `refresh_interval: 30s` in production (vs. 1s in dev) for write throughput
- **Bulk indexing**: Batch documents in queue processor (100 docs/batch)
- **Filter cache**: Heavy use of `keyword` fields for filter queries (cached by ES)
- **Routing**: Route searches by `tenantId` to avoid scatter-gather across all shards

### Application
- **Cache warming**: Pre-populate cache for top queries per tenant during off-peak
- **Response compression**: gzip/brotli for API responses
- **Connection reuse**: HTTP keep-alive, ES connection pooling
- **Query optimization**: Use `filter` context (cacheable) vs. `must` (scored) where possible

## 6. Operations

### Deployment Strategy
```
Blue-Green Deployment:
┌──────────┐     ┌──────────┐
│  Blue    │     │  Green   │
│ (current)│     │  (new)   │
│  v1.0    │     │  v1.1    │
└────┬─────┘     └────┬─────┘
     │                │
     └───── LB ───────┘
           │
    Switch traffic atomically
    after health checks pass
```

- **CI/CD**: GitHub Actions → Build → Test → Docker build → Push to ECR → Deploy to EKS
- **Zero-downtime**: Rolling updates with readiness probes; blue-green for major releases
- **Database migrations**: TypeORM migrations with backward-compatible schema changes
- **ES index migrations**: Reindex API with zero-downtime alias switching

### Backup/Recovery
- **PostgreSQL**: Continuous WAL archiving to S3; point-in-time recovery (PITR)
- **Elasticsearch**: Snapshot to S3 (daily full, hourly incremental)
- **Redis**: AOF persistence + RDB snapshots; reconstruction from PG/ES if lost
- **RTO**: 15 minutes (failover) / 1 hour (full restore)
- **RPO**: Near-zero (PG WAL) / 1 hour (ES snapshots)

## 7. SLA Considerations — Achieving 99.95% Availability

### Architecture for High Availability
```
Multi-AZ Deployment:
┌─────────── AZ-1 ──────────┐  ┌─────────── AZ-2 ──────────┐
│ App (2 pods)               │  │ App (2 pods)               │
│ PG Primary                 │  │ PG Replica                 │
│ ES Data Node 1             │  │ ES Data Node 2             │
│ ES Master 1                │  │ ES Master 2                │
│ Redis Primary              │  │ Redis Replica              │
└────────────────────────────┘  └────────────────────────────┘
                    ┌─────────── AZ-3 ──────────┐
                    │ ES Master 3 (tiebreaker)   │
                    └────────────────────────────┘
```

### Availability Budget
- 99.95% = ~22 minutes downtime/month
- Planned maintenance: Rolling restarts during low-traffic windows
- Incident response: PagerDuty with 5-minute acknowledgment SLA
- Chaos engineering: Regular failure injection (terminate pods, network partitions)

### Cost Optimization for Cloud Deployment
| Component | Dev | Production | Monthly Est. |
|-----------|-----|------------|-------------|
| App (EKS) | 1 pod | 4-10 pods (spot) | $200-500 |
| ES | Single node | 5 nodes (r6g.xlarge) | $800-1200 |
| PG | db.t3.medium | db.r6g.xlarge + replica | $400-600 |
| Redis | cache.t3.micro | cache.r6g.large cluster | $200-400 |
| **Total** | **~$50/mo** | **~$1,600-2,700/mo** | |

Use reserved instances (1yr) for 30-40% savings. Spot instances for stateless app nodes.
