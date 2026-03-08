import { Module } from '@nestjs/common';
import { ElasticsearchService } from './elasticsearch.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  controllers: [SearchController],
  providers: [ElasticsearchService, SearchService],
  exports: [ElasticsearchService, SearchService],
})
export class SearchModule {}
