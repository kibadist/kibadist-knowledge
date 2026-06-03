import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator'

export class ForgeDto {
  // The inbox items to merge into one (DET-241). Two or more; capped so a stray
  // request can't fold the whole inbox into a single concept.
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  ids!: string[]
}
