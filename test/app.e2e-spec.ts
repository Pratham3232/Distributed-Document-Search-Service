import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Document Search Service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health', () => {
    it('/api/v1/health (GET)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.service).toBe('document-search-service');
        });
    });
  });

  describe('Documents', () => {
    it('should reject requests without X-Tenant-ID', () => {
      return request(app.getHttpServer())
        .post('/api/v1/documents')
        .send({ title: 'Test', content: 'Content' })
        .expect(400);
    });

    it('should create a document with valid tenant', () => {
      return request(app.getHttpServer())
        .post('/api/v1/documents')
        .set('X-Tenant-ID', 'e2e-test')
        .send({
          title: 'E2E Test Document',
          content: 'This is a test document for e2e testing',
          tags: ['test', 'e2e'],
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.id).toBeDefined();
          expect(res.body.title).toBe('E2E Test Document');
          expect(res.body.tenantId).toBe('e2e-test');
          expect(res.body.indexStatus).toBe('pending');
        });
    });
  });

  describe('Search', () => {
    it('should reject search without X-Tenant-ID', () => {
      return request(app.getHttpServer())
        .get('/api/v1/search?q=test')
        .expect(400);
    });

    it('should reject search without query parameter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/search')
        .set('X-Tenant-ID', 'e2e-test')
        .expect(400);
    });
  });
});
