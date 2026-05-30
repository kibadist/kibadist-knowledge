import { LinkRelation } from '@kibadist/prisma'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

// Defensive cap: no realistic promotion approves more than a handful of links.
const MAX_CONNECTIONS = 25

export class ConnectionInputDto {
  // An existing, earned concept the user approved a link to.
  @IsString()
  @MinLength(1)
  targetConceptId!: string

  // Optional relationship label (e.g. "supports", "contradicts").
  @IsOptional()
  @IsString()
  @MaxLength(60)
  relation?: string

  // Optional typed relationship the user accepted from a Connector proposal
  // (DET-191). Persisted on the CONFIRMED link so the graph carries the kind.
  @IsOptional()
  @IsEnum(LinkRelation)
  relationKind?: LinkRelation
}

export class CommitPromotionDto {
  // NOTE: the gate depth is NOT taken from the client — it is derived from the
  // server-recorded PromotionDraft.frictionLevel (set via the friction
  // endpoint). The friction level decides which gates are required and the
  // retrieval-pass threshold, so a client can't smuggle a lighter gate at commit.

  // The user explicitly declared this a new conceptual root (no links).
  @IsBoolean()
  isRoot!: boolean

  // NOTE: gate 4 (Validate) is NOT taken from the client — it is read from the
  // server-recorded PromotionDraft.connectionsReviewed flag (set via the
  // dedicated endpoint). AI suggestions are never auto-applied: only the
  // user-approved connections listed below are created.
  @IsArray()
  @ArrayMaxSize(MAX_CONNECTIONS)
  @ValidateNested({ each: true })
  @Type(() => ConnectionInputDto)
  connections!: ConnectionInputDto[]
}
