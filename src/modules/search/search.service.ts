import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService, SearchResult } from './elasticsearch.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly cacheTtl: number;

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    this.cacheTtl = this.configService.get<number>('cache.ttl', 300) * 1000;
  }

  async search(
    tenantId: string,
    dto: SearchQueryDto,
  ): Promise<SearchResult> {
    const cacheKey = this.buildCacheKey(tenantId, dto);

    const cached = await this.cacheManager.get<SearchResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for key: ${cacheKey}`);
      return cached;
    }

    this.logger.debug(`Cache MISS for key: ${cacheKey}`);

    const result = await this.elasticsearchService.search({
      query: dto.q,
      tenantId,
      page: dto.page,
      limit: dto.limit,
      tags: dto.tags,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      fuzzy: dto.fuzzy,
      highlight: dto.highlight,
    });

    await this.cacheManager.set(cacheKey, result, this.cacheTtl);
    return result;
  }

  async invalidateTenantCache(tenantId: string): Promise<void> {
    // cache-manager-redis-yet supports pattern deletion via store
    // For simplicity, we rely on TTL-based expiration; in production
    // we'd use Redis SCAN + DEL with pattern `search:${tenantId}:*`
    this.logger.debug(`Cache invalidation triggered for tenant: ${tenantId}`);
  }

  private buildCacheKey(tenantId: string, dto: SearchQueryDto): string {
    const parts = [
      'search',
      tenantId,
      dto.q,
      `p${dto.page}`,
      `l${dto.limit}`,
      dto.tags?.sort().join(',') || '',
      dto.dateFrom || '',
      dto.dateTo || '',
      dto.fuzzy ? 'fz' : '',
    ];
    return parts.join(':');
  }
}
