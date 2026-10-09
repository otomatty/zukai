import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { DataStack } from './data-stack';

export class NotifyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { data: DataStack }) {
    super(scope, id, props);

    const notify = new NodejsFunction(this, 'Notify', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: '../order-api/src/worker/notify.ts',
      timeout: Duration.seconds(10),
    });

    // 10件ずつ受け取る。失敗したメッセージだけを再配信させる。
    notify.addEventSource(
      new SqsEventSource(props.data.notifyQueue, { batchSize: 10, reportBatchItemFailures: true }),
    );
  }
}
