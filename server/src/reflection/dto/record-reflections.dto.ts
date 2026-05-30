import { ReflectionKind } from '@kibadist/prisma'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

// Defensive cap: a session's reflection covers a handful of concepts, never more.
const MAX_REFLECTIONS = 25

/** One reflection: which concept moved, how, and an optional short note. */
export class ReflectionItemDto {
  @IsString()
  @MinLength(1)
  conceptId!: string

  @IsEnum(ReflectionKind)
  kind!: ReflectionKind

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string
}

/** The post-session reflection payload (DET-196): the session it closes + the
 *  answered prompts. An empty `items` array is valid — reflection is skippable. */
export class RecordReflectionsDto {
  @IsString()
  @MinLength(1)
  sessionId!: string

  @IsArray()
  @ArrayMaxSize(MAX_REFLECTIONS)
  @ValidateNested({ each: true })
  @Type(() => ReflectionItemDto)
  items!: ReflectionItemDto[]
}
