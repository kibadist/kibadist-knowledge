import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

// One hand-placed node position the user dragged on the graph canvas (DET-230).
// Coordinates are persisted SEPARATELY from the domain so re-laying-out the graph
// never destroys the user's manual placement.
export class PositionInput {
  @IsString()
  @IsNotEmpty()
  conceptId!: string

  @IsNumber()
  x!: number

  @IsNumber()
  y!: number

  // A locked node is pinned: auto-arrange/fit must not move it.
  @IsOptional()
  @IsBoolean()
  locked?: boolean
}

export class SavePositionsDto {
  @IsArray()
  // Defensive cap so a single request can't upsert an unbounded number of rows.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PositionInput)
  positions!: PositionInput[]
}
