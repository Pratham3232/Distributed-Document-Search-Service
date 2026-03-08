import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Document } from './entities/document.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { SearchService } from '../search/search.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectQueue('document-indexing')
    private readonly indexingQueue: Queue,
    private readonly searchService: SearchService,
  ) {}

  async create(tenantId: string, dto: CreateDocumentDto): Promise<Document> {
    const document = this.documentRepository.create({
      ...dto,
      tenantId,
      tags: dto.tags || [],
      indexStatus: 'pending',
    });

    const saved = await this.documentRepository.save(document);

    await this.indexingQueue.add(
      'index',
      { documentId: saved.id, tenantId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Document ${saved.id} created for tenant ${tenantId}, queued for indexing`,
    );

    await this.searchService.invalidateTenantCache(tenantId);
    return saved;
  }

  async findById(tenantId: string, id: string): Promise<Document> {
    const document = await this.documentRepository.findOne({
      where: { id, tenantId },
    });

    if (!document) {
      throw new NotFoundException(`Document '${id}' not found`);
    }

    return document;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const document = await this.findById(tenantId, id);

    await this.indexingQueue.add(
      'delete',
      { documentId: document.id, tenantId },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    await this.documentRepository.remove(document);
    await this.searchService.invalidateTenantCache(tenantId);

    this.logger.log(
      `Document ${id} deleted for tenant ${tenantId}, queued for index removal`,
    );
  }

  async findByTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: Document[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.documentRepository.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }
}
