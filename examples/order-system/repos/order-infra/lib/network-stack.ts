import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 公開、アプリ、データの3種類のサブネットを、2つのアベイラビリティゾーンに作る。
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
  }
}
