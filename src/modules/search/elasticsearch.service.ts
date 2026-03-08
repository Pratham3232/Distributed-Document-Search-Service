import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';

export interface IndexedDocument {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SearchOptions {
  query: string;
  tenantId: string;
  page?: number;
  limit?: number;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  fuzzy?: boolean;
  highlight?: boolean;
}

export interface SearchResult {
  hits: Array<{
    id: string;
    score: number;
    document: IndexedDocument;
    highlight?: Record<string, string[]>;
  }>;
  total: number;
  took: number;
  page: number;
  limit: number;
  facets?: {
    tags: Array<{ key: string; count: number }>;
  };
}

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private client: Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new Client({
      node: this.configService.get<string>('elasticsearch.node'),
    });
  }

  async onModuleInit() {
    try {
      const info = await this.client.info();
      this.logger.log(`Connected to Elasticsearch ${info.version.number}`);
    } catch (error) {
      this.logger.warn(
        'Elasticsearch not available at startup — will retry on demand',
      );
    }
  }

  private getIndexName(tenantId: string): string {
    return `documents_${tenantId.toLowerCase()}`;
  }

  private getIndexMapping() {
    return {
      properties: {
        id: { type: 'keyword' as const },
        tenantId: { type: 'keyword' as const },
        title: {
          type: 'text' as const,
          analyzer: 'standard',
          fields: {
            keyword: { type: 'keyword' as const },
            suggest: {
              type: 'text' as const,
              analyzer: 'simple',
            },
          },
        },
        content: {
          type: 'text' as const,
          analyzer: 'standard',
        },
        tags: { type: 'keyword' as const },
        metadata: { type: 'object' as const, enabled: false },
        createdAt: { type: 'date' as const },
        updatedAt: { type: 'date' as const },
      },
    };
  }

  async createTenantIndex(tenantId: string): Promise<void> {
    const indexName = this.getIndexName(tenantId);
    const exists = await this.client.indices.exists({ index: indexName });

    if (!exists) {
      await this.client.indices.create({
        index: indexName,
        body: {
          settings: {
            number_of_shards: 2,
            number_of_replicas: 1,
            refresh_interval: '1s',
            analysis: {
              analyzer: {
                standard: {
                  type: 'standard',
                  stopwords: '_english_',
                },
              },
            },
          },
          mappings: this.getIndexMapping(),
        },
      });
      this.logger.log(`Created index '${indexName}'`);
    }
  }

  async indexDocument(doc: IndexedDocument): Promise<void> {
    const indexName = this.getIndexName(doc.tenantId);
    await this.createTenantIndex(doc.tenantId);

    await this.client.index({
      index: indexName,
      id: doc.id,
      body: doc,
      refresh: 'wait_for',
    });
  }

  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const indexName = this.getIndexName(tenantId);
    try {
      await this.client.delete({
        index: indexName,
        id: documentId,
        refresh: 'wait_for',
      });
    } catch (error: unknown) {
      const esError = error as { meta?: { statusCode?: number } };
      if (esError.meta?.statusCode === 404) {
        return;
      }
      throw error;
    }
  }

  async search(options: SearchOptions): Promise<SearchResult> {
    const {
      query,
      tenantId,
      page = 1,
      limit = 20,
      tags,
      dateFrom,
      dateTo,
      fuzzy = true,
      highlight = true,
    } = options;

    const indexName = this.getIndexName(tenantId);
    const from = (page - 1) * limit;

    const must: Record<string, unknown>[] = [];
    const filter: Record<string, unknown>[] = [];

    if (query) {
      const searchQuery: Record<string, unknown> = fuzzy
        ? {
            multi_match: {
              query,
              fields: ['title^3', 'title.suggest^2', 'content', 'tags^1.5'],
              type: 'best_fields',
              fuzziness: 'AUTO',
              prefix_length: 2,
            },
          }
        : {
            multi_match: {
              query,
              fields: ['title^3', 'content', 'tags^1.5'],
              type: 'best_fields',
            },
          };
      must.push(searchQuery);
    }

    if (tags && tags.length > 0) {
      filter.push({ terms: { tags } });
    }

    if (dateFrom || dateTo) {
      const range: Record<string, string> = {};
      if (dateFrom) range.gte = dateFrom;
      if (dateTo) range.lte = dateTo;
      filter.push({ range: { createdAt: range } });
    }

    const body: Record<string, unknown> = {
      query: {
        bool: {
          must: must.length > 0 ? must : [{ match_all: {} }],
          filter,
        },
      },
      from,
      size: limit,
      aggs: {
        tags: {
          terms: { field: 'tags', size: 20 },
        },
      },
    };

    if (highlight) {
      body.highlight = {
        fields: {
          title: { number_of_fragments: 1, fragment_size: 200 },
          content: { number_of_fragments: 3, fragment_size: 150 },
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      };
    }

    try {
      const result = await this.client.search({
        index: indexName,
        body,
      });

      const total =
        typeof result.hits.total === 'number'
          ? result.hits.total
          : result.hits.total?.value || 0;

      const hits = result.hits.hits.map((hit) => ({
        id: hit._id as string,
        score: hit._score || 0,
        document: hit._source as IndexedDocument,
        highlight: (hit.highlight as Record<string, string[]>) || undefined,
      }));

      const tagsAgg = result.aggregations?.tags as {
        buckets: Array<{ key: string; doc_count: number }>;
      };

      return {
        hits,
        total,
        took: result.took,
        page,
        limit,
        facets: tagsAgg
          ? {
              tags: tagsAgg.buckets.map((b) => ({
                key: b.key,
                count: b.doc_count,
              })),
            }
          : undefined,
      };
    } catch (error: unknown) {
      const esError = error as { meta?: { statusCode?: number } };
      if (esError.meta?.statusCode === 404) {
        return { hits: [], total: 0, took: 0, page, limit };
      }
      throw error;
    }
  }

  async getDocument(
    tenantId: string,
    documentId: string,
  ): Promise<IndexedDocument | null> {
    const indexName = this.getIndexName(tenantId);
    try {
      const result = await this.client.get({
        index: indexName,
        id: documentId,
      });
      return result._source as IndexedDocument;
    } catch (error: unknown) {
      const esError = error as { meta?: { statusCode?: number } };
      if (esError.meta?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const health = await this.client.cluster.health();
      return health.status !== 'red';
    } catch {
      return false;
    }
  }

  async getClusterHealth(): Promise<Record<string, unknown>> {
    try {
      const health = await this.client.cluster.health();
      return JSON.parse(JSON.stringify(health));
    } catch {
      return { status: 'unavailable' };
    }
  }
}
