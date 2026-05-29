import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

import { MAX_PASTE_CHARS } from '../inbox.constants'

export class CaptureTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PASTE_CHARS)
  text!: string

  // Optional explicit title; otherwise derived from the first line of `text`.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string
}
