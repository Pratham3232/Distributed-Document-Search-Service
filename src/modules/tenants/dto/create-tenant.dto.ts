import { IsString, IsOptional, IsInt, Min, Max, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  slug: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(10000)
  rateLimitPerMinute?: number;
}
