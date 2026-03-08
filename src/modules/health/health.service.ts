import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { ElasticsearchService } from '../search/elasticsearch.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HealthService {
  private readonly redis: Redis;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly elasticsearchService: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.configService.get('redis.host'),
      port: this.configService.get('redis.port'),
      lazyConnect: true,
    });
  }

  async check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'document-search-service',
      version: '1.0.0',
    };
  }

  async readiness() {
    const [postgres, elasticsearch, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkElasticsearch(),
      this.checkRedis(),
    ]);

    const allHealthy =
      postgres.status === 'up' &&
      elasticsearch.status === 'up' &&
      redis.status === 'up';

    return {
      status: allHealthy ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies: { postgres, elasticsearch, redis },
    };
  }

  private async checkPostgres(): Promise<{
    status: string;
    latencyMs?: number;
  }> {
    try {
      const start = Date.now();
      await this.dataSource.query('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - start };
    } catch {
      return { status: 'down' };
    }
  }

  private async checkElasticsearch(): Promise<{
    status: string;
    details?: Record<string, unknown>;
  }> {
    try {
      const healthy = await this.elasticsearchService.isHealthy();
      const details = await this.elasticsearchService.getClusterHealth();
      return { status: healthy ? 'up' : 'degraded', details };
    } catch {
      return { status: 'down' };
    }
  }

  private async checkRedis(): Promise<{
    status: string;
    latencyMs?: number;
  }> {
    try {
      const start = Date.now();
      await this.redis.ping();
      return { status: 'up', latencyMs: Date.now() - start };
    } catch {
      return { status: 'down' };
    }
  }
}
