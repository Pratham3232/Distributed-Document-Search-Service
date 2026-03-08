import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';
import { ElasticsearchService } from './elasticsearch.service';

describe('SearchService', () => {
  let service: SearchService;

  const mockElasticsearch = {
    search: jest.fn(),
  };

  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue(300),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ElasticsearchService, useValue: mockElasticsearch },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    const searchDto = { q: 'test query', page: 1, limit: 20 };
    const tenantId = 'test-tenant';
    const searchResult = {
      hits: [
        {
          id: '1',
          score: 1.5,
          document: { title: 'Test', content: 'Content' },
        },
      ],
      total: 1,
      took: 5,
      page: 1,
      limit: 20,
    };

    it('should return cached result on cache hit', async () => {
      mockCache.get.mockResolvedValue(searchResult);

      const result = await service.search(tenantId, searchDto);

      expect(result).toEqual(searchResult);
      expect(mockElasticsearch.search).not.toHaveBeenCalled();
    });

    it('should query elasticsearch on cache miss and cache result', async () => {
      mockCache.get.mockResolvedValue(null);
      mockElasticsearch.search.mockResolvedValue(searchResult);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.search(tenantId, searchDto);

      expect(result).toEqual(searchResult);
      expect(mockElasticsearch.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test query',
          tenantId: 'test-tenant',
        }),
      );
      expect(mockCache.set).toHaveBeenCalled();
    });
  });
});
