import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { TenantRequest } from '../interfaces/tenant-request.interface';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const tenantId = request.headers['x-tenant-id'] as string;

    if (!tenantId) {
      throw new BadRequestException(
        'X-Tenant-ID header is required for all requests',
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      throw new BadRequestException(
        'X-Tenant-ID must contain only alphanumeric characters, hyphens, and underscores',
      );
    }

    request.tenantId = tenantId;
    return true;
  }
}
