import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

import { MAX_SOURCE_TEXT_CHARS } from '../transformer.constants'

export class CreateTextSourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_SOURCE_TEXT_CHARS)
  text!: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string
}
