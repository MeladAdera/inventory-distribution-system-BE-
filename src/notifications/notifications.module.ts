import { Module } from '@nestjs/common';
import { EmailService, SmsService, PushService } from './services';

@Module({
  providers: [EmailService, SmsService, PushService],
  exports: [EmailService, SmsService, PushService],
})
export class NotificationsModule {}
