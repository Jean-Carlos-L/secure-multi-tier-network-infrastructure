import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class SecureNetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly webSecurityGroup: ec2.SecurityGroup;
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'AppVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'PrivateWithEgress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogsGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new ec2.FlowLog(this, 'VpcFlowLog', {
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    this.webSecurityGroup = new ec2.SecurityGroup(this, 'WebSG', {
      vpc: this.vpc,
      securityGroupName: 'web-sg',
      description: 'Permite acceso publico HTTP/HTTPS desde Internet',
      allowAllOutbound: true,
    });

    this.webSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Permitir HTTP desde cualquier lugar'
    );
    this.webSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Permitir HTTPS desde cualquier lugar'
    );

    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSG', {
      vpc: this.vpc,
      securityGroupName: 'db-sg',
      description: 'Permite trafico unicamente desde el Security Group Web',
      allowAllOutbound: true,
    });

    // Ejemplo para PostgreSQL (Puerto 5432) o MySQL (3306)
    this.dbSecurityGroup.addIngressRule(
      this.webSecurityGroup,
      ec2.Port.tcp(5432),
      'Permitir acceso a PostgreSQL unicamente desde Web SG'
    );

    const ssmRole = new iam.Role(this, 'InstanceSSMRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const ami = ec2.MachineImage.latestAmazonLinux2023();

    const publicInstance = new ec2.Instance(this, 'PublicTestInstance', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: this.webSecurityGroup,
      role: ssmRole,
    });

    const privateInstance = new ec2.Instance(this, 'PrivateTestInstance', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: this.dbSecurityGroup,
      role: ssmRole,
    });

    new cdk.CfnOutput(this, 'PublicInstanceId', {
      value: publicInstance.instanceId,
      description: 'ID de la instancia pública de prueba',
    });

    new cdk.CfnOutput(this, 'PrivateInstanceId', {
      value: privateInstance.instanceId,
      description: 'ID de la instancia privada de prueba',
    });

    new cdk.CfnOutput(this, 'PrivateInstanceIp', {
      value: privateInstance.instancePrivateIp,
      description: 'IP privada de la instancia en la subred privada',
    });
  }
}
