import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ElasticsearchService } from '../search/elasticsearch.service';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    private readonly elasticsearchService: ElasticsearchService,
  ) {}

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantRepository.findOne({
      where: { slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(`Tenant with slug '${dto.slug}' already exists`);
    }

    const tenant = this.tenantRepository.create(dto);
    const saved = await this.tenantRepository.save(tenant);

    await this.elasticsearchService.createTenantIndex(dto.slug);
    this.logger.log(`Created tenant '${dto.slug}' with ES index`);

    return saved;
  }

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({ where: { slug } });
    if (!tenant) {
      throw new NotFoundException(`Tenant '${slug}' not found`);
    }
    return tenant;
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find();
  }

  async ensureTenantExists(slug: string): Promise<Tenant> {
    let tenant = await this.tenantRepository.findOne({ where: { slug } });
    if (!tenant) {
      tenant = this.tenantRepository.create({
        slug,
        name: slug,
        rateLimitPerMinute: 100,
      });
      tenant = await this.tenantRepository.save(tenant);
      await this.elasticsearchService.createTenantIndex(slug);
      this.logger.log(`Auto-provisioned tenant '${slug}'`);
    }
    return tenant;
  }
}
