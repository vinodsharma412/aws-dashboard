#!/bin/bash
# Deploy (or update) the nse-universe-refresh Lambda for one stage.
#
# Usage:
#   bash infrastructure/lambda/universe_refresh/deploy.sh <stage>
#   bash infrastructure/lambda/universe_refresh/deploy.sh dev
#   bash infrastructure/lambda/universe_refresh/deploy.sh prod
#
# Prerequisites:
#   - AWS CLI configured with an IAM user/role that has lambda:* permissions
#   - NSELambdaRole already created (run infrastructure/iam/setup_ec2_role.sh first)
#
# What it does:
#   1. Bundles handler.py into handler.zip
#   2. Creates the Lambda if it doesn't exist, or updates the code if it does
#   3. Updates the environment variables (STAGE, AWS_REGION)

set -euo pipefail

STAGE="${1:?Usage: deploy.sh <stage>  (dev|qc|prod)}"
REGION="ap-south-1"
FN_NAME="nse-universe-refresh-${STAGE}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/NSELambdaRole"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================================"
echo " Deploying Lambda: $FN_NAME"
echo " Stage: $STAGE  Region: $REGION"
echo "========================================================"

# ── 1. Package ────────────────────────────────────────────────────────────────
echo "[1/3] Packaging handler.py..."
cd "$SCRIPT_DIR"
zip -q handler.zip handler.py
echo "  ✓ handler.zip created"

# ── 2. Create or update function ──────────────────────────────────────────────
echo "[2/3] Creating / updating Lambda function..."

ENV_VARS="Variables={STAGE=${STAGE},AWS_REGION=${REGION}}"

if aws lambda get-function --function-name "$FN_NAME" --region "$REGION" &>/dev/null; then
  # Function exists — update code then config
  aws lambda update-function-code \
    --function-name "$FN_NAME" \
    --zip-file fileb://handler.zip \
    --region "$REGION" > /dev/null

  # Wait for the update to finish before changing config
  aws lambda wait function-updated \
    --function-name "$FN_NAME" \
    --region "$REGION"

  aws lambda update-function-configuration \
    --function-name "$FN_NAME" \
    --environment "$ENV_VARS" \
    --region "$REGION" > /dev/null

  echo "  ✓ Function updated: $FN_NAME"
else
  # First deploy
  aws lambda create-function \
    --function-name "$FN_NAME" \
    --runtime python3.12 \
    --handler handler.lambda_handler \
    --zip-file fileb://handler.zip \
    --role "$ROLE_ARN" \
    --timeout 60 \
    --memory-size 256 \
    --environment "$ENV_VARS" \
    --region "$REGION" > /dev/null

  echo "  ✓ Function created: $FN_NAME"
fi

# ── 3. Verify ────────────────────────────────────────────────────────────────
echo "[3/3] Verifying deployment..."
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
