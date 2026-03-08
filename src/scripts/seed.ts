import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TenantsService } from '../modules/tenants/tenants.service';
import { DocumentsService } from '../modules/documents/documents.service';
import { Logger } from '@nestjs/common';

const SAMPLE_DOCUMENTS = [
  {
    title: 'Introduction to Distributed Systems',
    content:
      'Distributed systems are collections of independent computers that appear to users as a single coherent system. Key challenges include consistency, availability, and partition tolerance as described by the CAP theorem. Modern distributed systems use techniques like consensus algorithms (Raft, Paxos), distributed hash tables, and vector clocks to maintain coherence.',
    tags: ['distributed-systems', 'architecture', 'engineering'],
    metadata: { author: 'Jane Smith', department: 'Engineering' },
  },
  {
    title: 'Elasticsearch Best Practices for Production',
    content:
      'When running Elasticsearch in production, consider shard sizing (aim for 10-50GB per shard), use dedicated master nodes for cluster stability, implement index lifecycle management for time-series data, and configure appropriate JVM heap sizes. Monitor cluster health with tools like Kibana and set up alerting for red/yellow cluster states.',
    tags: ['elasticsearch', 'production', 'devops'],
    metadata: { author: 'John Doe', department: 'DevOps' },
  },
  {
    title: 'Multi-Tenant Architecture Patterns',
    content:
      'Multi-tenancy can be implemented using several patterns: shared database with tenant column, schema-per-tenant, or database-per-tenant. Each approach has trade-offs in isolation, cost, and complexity. The shared database approach is cost-effective but requires careful query scoping. Schema-per-tenant provides better isolation with moderate overhead.',
    tags: ['architecture', 'multi-tenancy', 'database'],
    metadata: { author: 'Alice Chen', department: 'Architecture' },
  },
  {
    title: 'Building RESTful APIs with NestJS',
    content:
      'NestJS provides a robust framework for building server-side applications. It uses decorators and dependency injection extensively. Key features include guards for authentication, interceptors for cross-cutting concerns, pipes for validation, and exception filters for error handling. The modular architecture promotes separation of concerns.',
    tags: ['nestjs', 'api', 'typescript', 'backend'],
    metadata: { author: 'Bob Wilson', department: 'Engineering' },
  },
  {
    title: 'Redis Caching Strategies',
    content:
      'Common caching patterns include cache-aside (lazy loading), write-through, write-behind, and refresh-ahead. Redis supports various data structures: strings for simple KV pairs, hashes for structured data, sorted sets for leaderboards, and streams for event sourcing. Use TTL-based expiration to prevent stale data and implement cache warming for predictable workloads.',
    tags: ['redis', 'caching', 'performance'],
    metadata: { author: 'Carol Davis', department: 'Engineering' },
  },
  {
    title: 'Kubernetes Deployment Strategies',
    content:
      'Kubernetes supports several deployment strategies: rolling update (default), blue-green, canary, and A/B testing. Rolling updates gradually replace pods while maintaining availability. Blue-green deployments maintain two identical environments and switch traffic atomically. Canary deployments route a small percentage of traffic to the new version for validation.',
    tags: ['kubernetes', 'deployment', 'devops'],
    metadata: { author: 'Dave Brown', department: 'DevOps' },
  },
  {
    title: 'PostgreSQL Performance Tuning Guide',
    content:
      'Key PostgreSQL performance optimizations include proper indexing (B-tree, GIN, GiST), query plan analysis with EXPLAIN ANALYZE, connection pooling with PgBouncer, table partitioning for large datasets, and regular VACUUM operations. Configuration tuning should focus on shared_buffers, work_mem, and effective_cache_size based on available system memory.',
    tags: ['postgresql', 'database', 'performance'],
    metadata: { author: 'Eve Johnson', department: 'Database' },
  },
  {
    title: 'Microservices Communication Patterns',
    content:
      'Microservices can communicate synchronously via REST or gRPC, or asynchronously via message queues (RabbitMQ, Kafka). The saga pattern handles distributed transactions. Circuit breakers prevent cascade failures. API gateways provide a single entry point and handle cross-cutting concerns like authentication, rate limiting, and request routing.',
    tags: ['microservices', 'architecture', 'messaging'],
    metadata: { author: 'Frank Miller', department: 'Architecture' },
  },
  {
    title: 'Docker Container Security Best Practices',
    content:
      'Secure Docker containers by using minimal base images (Alpine, distroless), running as non-root users, scanning images for vulnerabilities, implementing resource limits, using read-only filesystems where possible, and keeping secrets out of images. Use multi-stage builds to minimize attack surface and regularly update base images.',
    tags: ['docker', 'security', 'devops'],
    metadata: { author: 'Grace Lee', department: 'Security' },
  },
  {
    title: 'Event-Driven Architecture with Message Queues',
    content:
      'Event-driven architecture decouples services through asynchronous message passing. Apache Kafka provides durable, ordered event streams suitable for event sourcing. RabbitMQ excels at task distribution and routing. Key patterns include event sourcing, CQRS (Command Query Responsibility Segregation), and the outbox pattern for reliable event publishing.',
    tags: ['event-driven', 'architecture', 'messaging', 'kafka'],
    metadata: { author: 'Henry Wang', department: 'Engineering' },
  },
];

async function seed() {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const tenantsService = app.get(TenantsService);
    const documentsService = app.get(DocumentsService);

    const tenants = ['acme-corp', 'globex-inc', 'initech'];

    for (const slug of tenants) {
      await tenantsService.ensureTenantExists(slug);
      logger.log(`Ensured tenant: ${slug}`);

      for (const doc of SAMPLE_DOCUMENTS) {
        await documentsService.create(slug, doc);
      }
      logger.log(`Seeded ${SAMPLE_DOCUMENTS.length} documents for ${slug}`);
    }

    logger.log('Seed completed. Waiting 5s for indexing queue to process...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    logger.log('Done!');
  } catch (error) {
    logger.error('Seed failed', error);
  } finally {
    await app.close();
  }
}

seed();
