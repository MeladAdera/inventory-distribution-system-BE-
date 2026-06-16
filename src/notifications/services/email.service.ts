import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  sendEmail(to: string, subject: string, _body: string): void {
    // TODO: Implement email sending logic
    console.log(`Email sent to ${to}: ${subject}`);
  }

  sendOrderConfirmation(to: string, orderNumber: string): void {
    const subject = `Order Confirmation - ${orderNumber}`;
    const body = `Your order ${orderNumber} has been confirmed.`;
    this.sendEmail(to, subject, body);
  }

  sendShipmentNotification(to: string, trackingNumber: string): void {
    const subject = `Your order is on the way`;
    const body = `Tracking number: ${trackingNumber}`;
    this.sendEmail(to, subject, body);
  }
}
