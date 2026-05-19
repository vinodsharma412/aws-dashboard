#!/bin/bash
# Deploy (or update) the nse-screener-refresh Lambda for one stage.
#
# Usage:
#   bash infrastructure/lambda/screener_refresh/deploy.sh <stage> <ec2-api-url>
#   bash infrastructure/lambda/screener_refresh/deploy.sh dev   http://13.233.x.x
#   bash infrastructure/lambda/screener_refresh/deploy.sh prod  http://65.2.x.x
#
# EC2_API_URL is the base URL of the FastAPI server for that stage:
#   prod → http://<EC2_IP>          (port 80 via Nginx, stage = prod)
#   dev  → http://<EC2_IP>:9001     (direct uvicorn port)
#   qc   → http://<EC2_IP>:9002
#
# The service account password is read from SSM Parameter Store:
#   /nse/{stage}/svc-password
# Run infrastructure/ssm/setup_ssm.sh <stage> first to populate it.

set -euo pipefail

STAGE="${1:?Usage: deploy.sh <stage> <ec2-api-url>}"
EC2_API_URL="${2:?Usage: deploy.sh <stage> <ec2-api-url>}"
REGION="ap-south-1"
FN_NAME="nse-screener-refresh-${STAGE}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/NSELambdaRole"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================================"
echo " Deploying Lambda: $FN_NAME"
echo " Stage: $STAGE  EC2: $EC2_API_URL"
echo "========================================================"

# ── Read service account password from SSM ────────────────────────────────────
echo "[1/4] Fetching service account password from SSM..."
SVC_PASSWORD=$(aws ssm get-parameter \
  --name "/nse/${STAGE}/svc-password" \
  --with-decryption \
  --query "Parameter.Value" --output text 2>/dev/null || echo "")

if [ -z "$SVC_PASSWORD" ]; then
  echo "  ⚠  SSM parameter /nse/${STAGE}/svc-password not found."
  echo "     Run: bash infrastructure/ssm/setup_ssm.sh ${STAGE}"
  echo "     Then re-run this script."
  exit 1
fi
echo "  ✓ Password retrieved from SSM"

# ── Package ───────────────────────────────────────────────────────────────────
echo "[2/4] Packaging handler.py..."
cd "$SCRIPT_DIR"
zip -q handler.zip handler.py
echo "  ✓ handler.zip created"

# ── Create or update function ─────────────────────────────────────────────────
echo "[3/4] Creating / updating Lambda function..."

ENV_VARS="Variables={STAGE=${STAGE},AWS_REGION=${REGION},EC2_API_URL=${EC2_API_URL},SVC_USERNAME=nse-service,SVC_PASSWORD=${SVC_PASSWORD}}"

if aws lambda get-function --function-name "$FN_NAME" --region "$REGION" &>/dev/null; then
  aws lambda update-function-code \
    --function-name "$FN_NAME" \
    --zip-file fileb://handler.zip \
    --region "$REGION" > /dev/null

  aws lambda wait function-updated \
    --function-name "$FN_NAME" \
    --region "$REGION"

  aws lambda update-function-configuration \
    --function-name "$FN_NAME" \
    --environment "$ENV_VARS" \
    --timeout 300 \
    --region "$REGION" > /dev/null

  echo "  ✓ Function updated: $FN_NAME"
else
  aws lambda create-function \
    --function-name "$FN_NAME" \
    --runtime python3.12 \
    --handler handler.lambda_handler \
    --zip-file fileb://handler.zip \
    --role "$ROLE_ARN" \
    --timeout 300 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --region "$REGION" > /dev/null

  echo "  ✓ Function created: $FN_NAME"
fi

# ── Verify ────────────────────────────────────────────────────────────────────
echo "[4/4] Verifying..."
STATE=$(aws lambda get-function \
  --function-name "$FN_NAME" \
  --region "$REGION" \
  --query "Configuration.State" --output text)
echo "  ✓ State: $STATE"

rm -f handler.zip

echo ""
echo "========================================================"
echo " Done. $FN_NAME is live."
echo ""
echo " To attach the EventBridge schedule:"
echo "   bash infrastructure/eventbridge/setup_eventbridge.sh $STAGE"
echo ""
echo " To test manually:"
echo "   aws lambda invoke --function-name $FN_NAME \\"
echo "     --payload '{}' --cli-binary-format raw-in-base64-out \\"
echo "     /tmp/out.json && cat /tmp/out.json"
echo "========================================================"
