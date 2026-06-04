import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'

import { Public } from '../auth/public.decorator'
import { JoinWaitlistDto } from './dto/join-waitlist.dto'
import { WaitlistService } from './waitlist.service'

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  join(@Body() dto: JoinWaitlistDto): Promise<{ ok: true }> {
    return this.waitlistService.join(dto)
  }
}
