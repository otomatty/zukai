import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { findOrder } from '../infra/read-model';
import { renderMail } from './templates';

const ses = new SESv2Client({});

// キューから通知の依頼を受け取り、メールを送る。
// 失敗したメッセージだけを返すと、SQS がそのメッセージだけを再配信する。
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const { type, orderId } = JSON.parse(record.body);
      const order = await findOrder(orderId);
      const mail = renderMail(type, order);
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: 'no-reply@shop.example.com',
          Destination: { ToAddresses: [order.email] },
          Content: { Simple: mail },
        }),
      );
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
