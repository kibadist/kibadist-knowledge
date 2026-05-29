import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  body?: string
}
