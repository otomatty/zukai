import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as patterns from 'aws-cdk-lib/aws-ecs-patterns';
import { Construct } from 'constructs';
import { DataStack } from './data-stack';
import { NetworkStack } from './network-stack';

interface ApiStackProps extends StackProps {
  network: NetworkStack;
  data: DataStack;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc: props.network.vpc });

    // 注文API。2つのアベイラビリティゾーンに1タスクずつ置く。
    const service = new patterns.ApplicationLoadBalancedFargateService(this, 'OrderApi', {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(props.data.repository),
        containerPort: 3000,
        environment: {
          DB_HOST: props.data.cluster.clusterEndpoint.hostname,
          NOTIFY_QUEUE_URL: props.data.notifyQueue.queueUrl,
        },
      },
      circuitBreaker: { rollback: true },
    });

    service.targetGroup.configureHealthCheck({ path: '/healthz', interval: Duration.seconds(10) });

    // CPU 使用率が60%を超えると、タスクを6つまで増やす。
    const scaling = service.service.autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 });
    scaling.scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });

    props.data.notifyQueue.grantSendMessages(service.taskDefinition.taskRole);
    props.data.cluster.connections.allowDefaultPortFrom(service.service);
  }
}
