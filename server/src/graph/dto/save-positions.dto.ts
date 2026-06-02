import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator'

// One hand-placed node position the user dragged on the graph canvas (DET-230).
// Coordinates are persisted SEPARATELY from the domain so re-laying-out the graph
// never destroys the user's manual placement.
//
// NOTE: `locked` node-pinning is DEFERRED (DET-226). The column still exists on
// GraphNodePosition and is returned on read, but there is no auto-arrange that it
// would protect against yet, and no UI sends it — so it is intentionally NOT
// accepted on this write DTO. Re-add it here (and the create/update branch in
// GraphService.savePositions) when a re-layout feature actually needs to pin nodes.
export class PositionInput {
  @IsString()
  @IsNotEmpty()
  conceptId!: string

  @IsNumber()
  x!: number

  @IsNumber()
  y!: number
}

export class SavePositionsDto {
  @IsArray()
  // Defensive cap so a single request can't upsert an unbounded number of rows.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PositionInput)
  positions!: PositionInput[]
}
