import { IsNotEmpty, IsString } from 'class-validator'

// Seed a Living Concept persona for an ALREADY-EARNED concept (DET-230). The
// concept must be non-INBOX — the persona is a scaffold over earned knowledge,
// never a backdoor to mint it.
export class CreateLivingConceptDto {
  @IsString()
  @IsNotEmpty()
  conceptId!: string
}
