import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ArticleGeneratorService } from './article-generator.service'
import { ArticlePipelineService } from './article-pipeline.service'
import { BlockClassifierService } from './block-classifier.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { PipelineService } from './pipeline.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import { StructureModelService } from './structure-model.service'
import { TransformerController } from './transformer.controller'
import { TransformerService } from './transformer.service'

/**
 * The Source-Preserving Article Transformer (DET-247…259), M1 backend.
 *
 * Imports AiModule (the batched block-classification completion) and
 * WorkspacesModule (active-workspace resolution / ownership). PrismaModule is
 * @Global, so PrismaService is injected without importing it. The pipeline runs
 * in-process (no job queue) and its OnApplicationBootstrap sweep recovers rows
 * orphaned by a restart.
 */
@Module({
  imports: [AiModule, WorkspacesModule],
  controllers: [TransformerController],
  providers: [
    TransformerService,
    PipelineService,
    BlockClassifierService,
    StructureModelService,
    ReshapingPlanService,
    ArticleGeneratorService,
    FidelityCheckerService,
    IllustrationPlannerService,
    LearningLayerService,
    ArticlePipelineService,
  ],
  exports: [TransformerService, PipelineService],
})
export class TransformerModule {}
