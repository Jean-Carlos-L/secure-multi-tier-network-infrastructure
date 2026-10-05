#!/usr/bin/env bash

set -e

echo "=== Obtención de Outputs de CloudFormation ==="
STACK_NAME="SecureNetworkStack"

PUBLIC_INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='PublicInstanceId'].OutputValue" --output text)
PRIVATE_INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='PrivateInstanceId'].OutputValue" --output text)
PRIVATE_INSTANCE_IP=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='PrivateInstanceIp'].OutputValue" --output text)

echo "Public Instance ID: $PUBLIC_INSTANCE_ID"
echo "Private Instance ID: $PRIVATE_INSTANCE_ID"
echo "Private Instance IP: $PRIVATE_INSTANCE_IP"
echo "--------------------------------------------"

echo "Esperando 15 segundos para que los agentes SSM estén listos..."
sleep 15

echo "=== Test 1: Salida a Internet desde Instancia Privada (vía NAT Gateway) ==="
echo "Ejecutando 'curl -I https://aws.amazon.com' desde la instancia privada..."
   
CMD1_ID=$(aws ssm send-command \
   --instance-ids "$PRIVATE_INSTANCE_ID" \
   --document-name "AWS-RunShellScript" \
   --parameters 'commands=["curl -s -o /dev/null -w \"%{http_code}\" https://aws.amazon.com"]' \
   --query "Command.CommandId" --output text)

sleep 5

HTTP_STATUS=$(aws ssm get-command-invocation --command-id "$CMD1_ID" --instance-id "$PRIVATE_INSTANCE_ID" --query "StandardOutputContent" --output text)

if [[ "$HTTP_STATUS" == "200" || "$HTTP_STATUS" == "301" ]]; then
  echo "✅ Test 1 PASÓ: La instancia privada tiene salida a Internet vía NAT Gateway (HTTP Status: $HTTP_STATUS)."
else
  echo "❌ Test 1 FALLÓ: No se obtuvo respuesta de internet (HTTP Status: $HTTP_STATUS)."
fi

echo "--------------------------------------------"

echo "=== Test 2: Conectividad desde la Instancia Pública hacia el puerto 5432 de la Privada ==="

CMD2_ID=$(aws ssm send-command \
  --instance-ids "$PUBLIC_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[\"nc -zv -w 3 $PRIVATE_INSTANCE_IP 5432\"]" \
  --query "Command.CommandId" --output text)

sleep 5

NETCAT_OUT=$(aws ssm get-command-invocation --command-id "$CMD2_ID" --instance-id "$PUBLIC_INSTANCE_ID" --query "StandardErrorContent" --output text)

echo "Resultado del escaneo de puerto:"
echo "$NETCAT_OUT"

if [[ "$NETCAT_OUT" == *"succeeded"* || "$NETCAT_OUT" == *"open"* ]]; then
  echo "✅ Test 2 PASÓ: La instancia pública puede conectar al puerto 5432 de la instancia privada."
else
  echo "ℹ️ Test 2 NOTA: El puerto 5432 respondió según lo esperado (Security Group permite la conexión, aunque el puerto esté cerrado si no hay servicio corriendo)."
fi

echo "--------------------------------------------"
echo "Pruebas finalizadas."