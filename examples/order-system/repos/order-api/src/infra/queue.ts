import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});
const queueUrl = process.env.NOTIFY_QUEUE_URL!;

export interface Notification {
  type: 'order-confirmed' | 'order-shipped' | 'order-cancelled';
  orderId: string;
}

// 通知の依頼をキューに入れる。メールの送信は worker/notify.ts が行う。
export async function enqueueNotification(message: Notification): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}
