import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/access-policy.decorator';

export class HealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

// Liveness only: it doesn't touch the database, so uptime pings and Render
// health checks don't keep Neon awake.
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: HealthDto })
  check(): HealthDto {
    return { status: 'ok' };
  }
}
