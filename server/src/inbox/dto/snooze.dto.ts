import { IsISO8601 } from 'class-validator'

export class SnoozeDto {
  // When the item should resurface in the inbox (DET-241). The client computes
  // this in the user's local timezone (e.g. "tomorrow 9am") and sends an ISO
  // datetime; the server stores it verbatim and the read filter does the rest.
  @IsISO8601()
  until!: string
}
