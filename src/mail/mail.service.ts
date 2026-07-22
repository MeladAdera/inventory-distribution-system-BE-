import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@inventory-system.local';

    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: this.config.get<number>('SMTP_PORT'),
          auth: {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASSWORD'),
          },
        })
      : null;
  }

  async sendPasswordResetCode(email: string, code: string, expirationMinutes: number): Promise<void> {
    const subject = 'Your password reset code';
    const text = `Your password reset code is ${code}. It expires in ${expirationMinutes} minutes. If you did not request this, you can ignore this email.`;

    if (!this.transporter) {
      this.logger.warn(
        `SMTP is not configured — password reset code for ${email}: ${code} (expires in ${expirationMinutes}m)`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject,
      text,
    });
  }
}
