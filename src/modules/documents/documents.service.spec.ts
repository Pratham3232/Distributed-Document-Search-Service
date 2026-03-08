import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';
import { SearchService } from '../search/search.service';

describe('DocumentsService', () => {
  let service: DocumentsService;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  const mockSearchService = {
    invalidateTenantCache: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getRepositoryToken(Document), useValue: mockRepository },
        { provide: getQueueToken('document-indexing'), useValue: mockQueue },
        { provide: SearchService, useValue: mockSearchService },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a document and queue it for indexing', async () => {
      const dto = {
        title: 'Test Document',
        content: 'Test content',
        tags: ['test'],
      };
      const tenantId = 'test-tenant';
      const savedDoc = {
        id: 'uuid-123',
        ...dto,
        tenantId,
        indexStatus: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepository.create.mockReturnValue(savedDoc);
      mockRepository.save.mockResolvedValue(savedDoc);
      mockQueue.add.mockResolvedValue({});
      mockSearchService.invalidateTenantCache.mockResolvedValue(undefined);

      const result = await service.create(tenantId, dto);

      expect(result).toEqual(savedDoc);
      expect(mockRepository.create).toHaveBeenCalledWith({
        ...dto,
        tenantId,
        indexStatus: 'pending',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'index',
        { documentId: savedDoc.id, tenantId },
        expect.objectContaining({ attempts: 3 }),
      );
      expect(mockSearchService.invalidateTenantCache).toHaveBeenCalledWith(
        tenantId,
      );
    });
  });

  describe('findById', () => {
    it('should return a document by id and tenantId', async () => {
      const doc = {
        id: 'uuid-123',
        tenantId: 'test-tenant',
        title: 'Test',
        content: 'Content',
      };
      mockRepository.findOne.mockResolvedValue(doc);

      const result = await service.findById('test-tenant', 'uuid-123');
      expect(result).toEqual(doc);
    });

    it('should throw NotFoundException when document not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findById('test-tenant', 'nonexistent'),
      ).rejects.toThrow('not found');
    });
  });

  describe('delete', () => {
    it('should delete a document and queue index removal', async () => {
      const doc = {
        id: 'uuid-123',
        tenantId: 'test-tenant',
        title: 'Test',
      };
      mockRepository.findOne.mockResolvedValue(doc);
      mockRepository.remove.mockResolvedValue(doc);
      mockQueue.add.mockResolvedValue({});
      mockSearchService.invalidateTenantCache.mockResolvedValue(undefined);

      await service.delete('test-tenant', 'uuid-123');

      expect(mockRepository.remove).toHaveBeenCalledWith(doc);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'delete',
        { documentId: 'uuid-123', tenantId: 'test-tenant' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  describe('findByTenant', () => {
    it('should return paginated documents for a tenant', async () => {
      const docs = [
        { id: '1', title: 'Doc 1' },
        { id: '2', title: 'Doc 2' },
      ];
      mockRepository.findAndCount.mockResolvedValue([docs, 2]);

      const result = await service.findByTenant('test-tenant', 1, 20);

      expect(result).toEqual({ data: docs, total: 2, page: 1, limit: 20 });
      expect(mockRepository.findAndCount).toHaveBeenCalledWith({
        where: { tenantId: 'test-tenant' },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
    });
  });
});
