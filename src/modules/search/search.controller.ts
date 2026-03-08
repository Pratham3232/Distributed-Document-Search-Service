import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantId } from '../../common/decorators/tenant.decorator';

@Controller('search')
@UseGuards(TenantGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@TenantId() tenantId: string, @Query() dto: SearchQueryDto) {
    return this.searchService.search(tenantId, dto);
  }
}
