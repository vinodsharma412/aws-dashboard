#!/bin/bash
# S3 bucket setup for NSE Stock Dashboard
# Run from your local machine (AWS CLI configured).
# Usage: bash infrastructure/scripts/s3_setup.sh

set -e

REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

FRONTEND_BUCKET="nse-frontend-${ACCOUNT_ID}"
ASSETS_BUCKET="nse-assets-${ACCOUNT_ID}"

echo "Account ID : $ACCOUNT_ID"
echo "Region     : $REGION"
echo "Frontend   : $FRONTEND_BUCKET"
echo "Assets     : $ASSETS_BUCKET"
echo ""

# ── Frontend bucket (static website) ─────────────────────────────────────────

echo "[1/4] Creating frontend bucket..."
aws s3api create-bucket \
  --bucket "$FRONTEND_BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null || true

echo "[2/4] Enabling static website hosting..."
aws s3api put-bucket-website \
  --bucket "$FRONTEND_BUCKET" \
  --website-configuration '{
    "IndexDocument": {"Suffix": "index.html"},
    "ErrorDocument": {"Key": "index.html"}
  }'

echo "      Disabling block-public-access for frontend bucket..."
aws s3api put-public-access-block \
  --bucket "$FRONTEND_BUCKET" \
  --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

echo "      Setting public-read bucket policy..."
aws s3api put-bucket-policy \
  --bucket "$FRONTEND_BUCKET" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"PublicReadGetObject\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${FRONTEND_BUCKET}/*\"
    }]
  }"

# ── Assets bucket (avatars — EC2 access only) ─────────────────────────────────

echo "[3/4] Creating assets bucket..."
aws s3api create-bucket \
  --bucket "$ASSETS_BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null || true

echo "[4/4] Enabling CORS on assets bucket (EC2 API serves the URLs)..."
aws s3api put-bucket-cors \
  --bucket "$ASSETS_BUCKET" \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": []
    }]
  }'

echo ""
echo "========================================================"
echo "Done! Your URLs:"
echo ""
echo "  Frontend (React app):"
echo "  http://${FRONTEND_BUCKET}.s3-website.${REGION}.amazonaws.com"
echo ""
echo "  Assets bucket name (put in .env):"
echo "  S3_ASSETS_BUCKET=${ASSETS_BUCKET}"
echo ""
echo "Next step: build React and upload:"
echo "  cd frontend && npm run build"
echo "  aws s3 sync build/ s3://${FRONTEND_BUCKET}/ --delete"
echo "========================================================"

# Save bucket names to a file for reference
cat > .env.buckets << EOF
FRONTEND_BUCKET=${FRONTEND_BUCKET}
ASSETS_BUCKET=${ASSETS_BUCKET}
FRONTEND_URL=http://${FRONTEND_BUCKET}.s3-website.${REGION}.amazonaws.com
EOF
echo ""
echo "Bucket names saved to .env.buckets"


