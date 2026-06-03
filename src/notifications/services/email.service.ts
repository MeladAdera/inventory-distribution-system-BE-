import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  async sendEmail(to: string, subject: string, _body: string): Promise<void> {
    // TODO: Implement email sending logic
    console.log(`Email sent to ${to}: ${subject}`);
  }

  async sendOrderConfirmation(
    to: string,
    orderNumber: string,
  ): Promise<void> {
    const subject = `Order Confirmation - ${orderNumber}`;
    const body = `Your order ${orderNumber} has been confirmed.`;
    await this.sendEmail(to, subject, body);
  }

  async sendShipmentNotification(
    to: string,
    trackingNumber: string,
  ): Promise<void> {
    const subject = `Your order is on the way`;
    const body = `Tracking number: ${trackingNumber}`;
    await this.sendEmail(to, subject, body);
  }
}
