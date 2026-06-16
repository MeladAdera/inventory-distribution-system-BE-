import { Injectable } from '@nestjs/common';

@Injectable()
export class SmsService {
  sendSms(phoneNumber: string, message: string): void {
    // TODO: Implement SMS sending logic
    console.log(`SMS sent to ${phoneNumber}: ${message}`);
  }

  sendOrderStatusSms(phoneNumber: string, orderNumber: string, status: string): void {
    const message = `Your order ${orderNumber} status: ${status}`;
    this.sendSms(phoneNumber, message);
  }
}
