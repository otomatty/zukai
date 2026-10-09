import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { NetworkStack } from './network-stack';

export class DataStack extends Stack {
  readonly cluster: rds.DatabaseCluster;
  readonly notifyQueue: sqs.Queue;
  readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: StackProps & { network: NetworkStack }) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, 'Repository', { repositoryName: 'order-api' });

    // 注文DB。書き込み用と読み取り用を1台ずつ、別のアベイラビリティゾーンに置く。
    this.cluster = new rds.DatabaseCluster(this, 'OrderDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_4 }),
      vpc: props.network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      writer: rds.ClusterInstance.serverlessV2('Writer'),
      readers: [rds.ClusterInstance.serverlessV2('Reader', { scaleWithWriter: true })],
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      backup: { retention: Duration.days(7) },
    });

    // 5回受信しても処理できなかった通知は、調査用のキューへ移す。
    const deadLetters = new sqs.Queue(this, 'NotifyDeadLetters', { retentionPeriod: Duration.days(14) });

    this.notifyQueue = new sqs.Queue(this, 'NotifyQueue', {
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: 5 },
    });
  }
}
