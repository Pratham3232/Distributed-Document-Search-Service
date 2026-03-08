import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document } from './entities/document.entity';
import { ElasticsearchService } from '../search/elasticsearch.service';

interface IndexDocumentPayload {
  documentId: string;
  tenantId: string;
}

@Processor('document-indexing')
export class DocumentsProcessor {
  private readonly logger = new Logger(DocumentsProcessor.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    private readonly elasticsearchService: ElasticsearchService,
  ) {}

  @Process('index')
  async handleIndex(job: Job<IndexDocumentPayload>) {
    const { documentId, tenantId } = job.data;
    this.logger.debug(`Indexing document ${documentId} for tenant ${tenantId}`);

    const document = await this.documentRepository.findOne({
      where: { id: documentId, tenantId },
    });

    if (!document) {
      this.logger.warn(`Document ${documentId} not found, skipping`);
      return;
    }

    try {
      await this.elasticsearchService.indexDocument({
        id: document.id,
        tenantId: document.tenantId,
        title: document.title,
        content: document.content,
        tags: document.tags || [],
        metadata: document.metadata || {},
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      });

      await this.documentRepository.update(documentId, {
        indexStatus: 'indexed',
      });

      this.logger.debug(`Successfully indexed document ${documentId}`);
    } catch (error) {
      this.logger.error(`Failed to index document ${documentId}`, error);
      await this.documentRepository.update(documentId, {
        indexStatus: 'failed',
      });
      throw error;
    }
  }

  @Process('delete')
  async handleDelete(job: Job<IndexDocumentPayload>) {
    const { documentId, tenantId } = job.data;
    this.logger.debug(
      `Removing document ${documentId} from index for tenant ${tenantId}`,
    );

    await this.elasticsearchService.deleteDocument(tenantId, documentId);
  }
}
