import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptStateModule } from '../concept-state/concept-state.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ArticleEnrichmentService } from './article-enrichment.service'
import { ArticleGeneratorService } from './article-generator.service'
import { ArticlePipelineService } from './article-pipeline.service'
import { BlockClassifierService } from './block-classifier.service'
import { BlockRoleClassifierService } from './block-role-classifier.service'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { EditorialLayoutService } from './editorial-layout.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { LearningPromptsService } from './learning-prompts.service'
import { PipelineService } from './pipeline.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import { RewriteService } from './rewrite.service'
import { SourceDiagnosisService } from './source-diagnosis.service'
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
  imports: [AiModule, WorkspacesModule, ConceptStateModule],
  controllers: [TransformerController],
  providers: [
    TransformerService,
    PipelineService,
    BlockClassifierService,
    BlockRoleClassifierService,
    SourceDiagnosisService,
    StructureModelService,
    ConceptualSegmentationService,
    ReshapingPlanService,
    RewriteService,
    ArticleGeneratorService,
    FidelityCheckerService,
    IllustrationPlannerService,
    ArticleEnrichmentService,
    EditorialLayoutService,
    LearningLayerService,
    LearningPromptsService,
    ArticlePipelineService,
  ],
  exports: [TransformerService, PipelineService],
})
export class TransformerModule {}
