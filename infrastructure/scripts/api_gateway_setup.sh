#!/bin/bash
# Create API Gateway HTTP API — proxies all REST calls to EC2 FastAPI.
# Run from LOCAL machine (AWS CLI configured).
# Usage: bash infrastructure/scripts/api_gateway_setup.sh <EC2-ELASTIC-IP>

set -e

EC2_IP="${1:?Usage: $0 <EC2-ELASTIC-IP>}"
REGION="ap-south-1"
API_NAME="nse-stock-api"
STAGE_NAME="prod"

echo "Creating API Gateway HTTP API → http://${EC2_IP}/api/"
echo ""

# ── Step 1: Create the HTTP API ───────────────────────────────────────────────
API_ID=$(aws apigatewayv2 create-api \
  --name "$API_NAME" \
  --protocol-type HTTP \
  --description "NSE Stock Dashboard REST API — proxies to EC2 FastAPI" \
  --cors-configuration \
    AllowOrigins='["*"]',AllowMethods='["GET","POST","PUT","DELETE","OPTIONS"]',AllowHeaders='["Authorization","Content-Type"]',MaxAge=300 \
  --region "$REGION" \
  --query "ApiId" --output text)

echo "[1/5] API created: $API_ID"

# ── Step 2: Create HTTP integration pointing to EC2 ──────────────────────────
INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type HTTP_PROXY \
  --integration-method ANY \
  --integration-uri "http://${EC2_IP}/{proxy}" \
  --payload-format-version "1.0" \
  --region "$REGION" \
  --query "IntegrationId" --output text)

echo "[2/5] Integration created: $INTEGRATION_ID"

# ── Step 3: Create a catch-all route ANY /{proxy+} ───────────────────────────
aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "ANY /{proxy+}" \
  --target "integrations/$INTEGRATION_ID" \
  --region "$REGION" > /dev/null

echo "[3/5] Route created: ANY /{proxy+}"

# Also create root route for health check
aws apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key "GET /health" \
  --target "integrations/$INTEGRATION_ID" \
  --region "$REGION" > /dev/null

# ── Step 4: Create and deploy the $default stage ──────────────────────────────
aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name "$STAGE_NAME" \
  --auto-deploy \
  --access-log-settings \
    DestinationArn="arn:aws:logs:${REGION}:$(aws sts get-caller-identity --query Account --output text):log-group:/aws/apigateway/${API_NAME}" \
  --default-route-settings \
    ThrottlingBurstLimit=50,ThrottlingRateLimit=20 \
  --region "$REGION" > /dev/null 2>&1 || \
aws apigatewayv2 create-stage \
  --api-id "$API_ID" \
  --stage-name "$STAGE_NAME" \
  --auto-deploy \
  --default-route-settings \
    ThrottlingBurstLimit=50,ThrottlingRateLimit=20 \
  --region "$REGION" > /dev/null

echo "[4/5] Stage '$STAGE_NAME' deployed with auto-deploy"

# ── Step 5: Get the invoke URL ────────────────────────────────────────────────
INVOKE_URL=$(aws apigatewayv2 get-api \
  --api-id "$API_ID" \
  --region "$REGION" \
  --query "ApiEndpoint" --output text)

FULL_URL="${INVOKE_URL}/${STAGE_NAME}"

echo "[5/5] Done!"
echo ""
echo "========================================================"
echo " API Gateway URL (use this in React frontend):"
echo ""
echo "  ${FULL_URL}"
echo ""
echo " Example:"
echo "  curl ${FULL_URL}/api/v1/docs"
echo ""
echo " In frontend/src/utils/constants.js:"
echo "  export const API_URL = '${FULL_URL}/api/v1';"
echo ""
echo " Throttling: 20 req/sec sustained, 50 burst"
echo " CORS: * (all origins)"
echo "========================================================"

# Save to file for reference
cat > .env.apigateway << EOF
API_GATEWAY_ID=${API_ID}
API_GATEWAY_URL=${FULL_URL}
API_URL=${FULL_URL}/api/v1
EOF

echo ""
echo "Saved to .env.apigateway"
echo ""
echo "NOTE: SSE endpoints must use EC2 direct URL (API GW 29s timeout):"
echo "  SSE_BASE_URL=http://${EC2_IP}"
