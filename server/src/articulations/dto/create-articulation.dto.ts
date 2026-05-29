import { IsString, MaxLength, MinLength } from 'class-validator'

export class CreateArticulationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string
}
