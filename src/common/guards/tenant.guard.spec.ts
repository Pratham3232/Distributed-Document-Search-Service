import { TenantGuard } from './tenant.guard';
import { ExecutionContext, BadRequestException } from '@nestjs/common';

describe('TenantGuard', () => {
  let guard: TenantGuard;

  beforeEach(() => {
    guard = new TenantGuard();
  });

  const createMockContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as unknown as ExecutionContext;

  it('should allow request with valid X-Tenant-ID', () => {
    const context = createMockContext({ 'x-tenant-id': 'acme-corp' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject request without X-Tenant-ID', () => {
    const context = createMockContext({});
    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it('should reject request with invalid X-Tenant-ID characters', () => {
    const context = createMockContext({ 'x-tenant-id': 'acme corp!' });
    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it('should set tenantId on request object', () => {
    const request = { headers: { 'x-tenant-id': 'test-tenant' } } as Record<string, unknown>;
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    guard.canActivate(context);
    expect(request.tenantId).toBe('test-tenant');
  });
});
