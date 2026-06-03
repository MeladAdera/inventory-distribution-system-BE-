import { Injectable } from '@nestjs/common';

@Injectable()
export class SmsService {
  async sendSms(phoneNumber: string, message: string): Promise<void> {
    // TODO: Implement SMS sending logic
    console.log(`SMS sent to ${phoneNumber}: ${message}`);
  }

  async sendOrderStatusSms(
    phoneNumber: string,
    orderNumber: string,
    status: string,
  ): Promise<void> {
    const message = `Your order ${orderNumber} status: ${status}`;
    await this.sendSms(phoneNumber, message);
  }
}
