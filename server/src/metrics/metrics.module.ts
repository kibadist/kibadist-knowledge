import { Module } from '@nestjs/common'

import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'

/**
 * Anti-Vanity Metrics (DET-200). A read-only aggregation over existing rows —
 * no schema, no writes — surfacing retention + synthesis as the measure of
 * understanding. (PrismaModule is @Global.)
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
