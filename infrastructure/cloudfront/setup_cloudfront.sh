#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  Amazon CloudFront — CDN distribution for the React frontend
#
#  What this creates:
#  ─────────────────
#  • CloudFront distribution pointing to your S3 frontend bucket.
#  • Origin Access Control (OAC) so S3 blocks public access — only CloudFront
#    can read the bucket (security best practice).
#  • Cache behaviours:
#      /static/*         → 1 year (hashed filenames — immutable)
#      /index.html       → no-cache (React entry point — always fresh)
#      everything else   → 24 hours
#  • Custom error pages: 403/404 → /index.html (React SPA routing fix)
#  • Updates the S3 bucket policy to allow CloudFront OAC access.
#
#  Why CloudFront?
#  ───────────────
#  • HTTPS out of the box — S3 static website only supports HTTP.
#  • CDN edge caches — global low-latency delivery.
#  • Free tier: 1 TB data transfer + 10 million requests/month (12 months).
#
#  Usage:
#    bash infrastructure/cloudfront/setup_cloudfront.sh <stage> <s3-bucket>
#
#  Example:
#    bash infrastructure/cloudfront/setup_cloudfront.sh prod nse-frontend-YOUR_ACCOUNT_ID
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

STAGE="${1:?Usage: $0 <stage> <s3-bucket>}"
S3_BUCKET="${2:?Provide S3 bucket name, e.g. nse-frontend-YOUR_ACCOUNT_ID}"
REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CloudFront Setup — stage: ${STAGE}"
echo "  S3 bucket: ${S3_BUCKET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Create Origin Access Control ─────────────────────────────────────
echo ""
echo "[1/4] Creating Origin Access Control (OAC)"

OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config "{
    \"Name\": \"nse-oac-${S3_BUCKET}\",
    \"Description\": \"OAC for NSE frontend ${STAGE}\",
    \"SigningProtocol\": \"sigv4\",
    \"SigningBehavior\": \"always\",
    \"OriginAccessControlOriginType\": \"s3\"
  }" \
  --query "OriginAccessControl.Id" --output text 2>/dev/null || echo "")

if [ -z "$OAC_ID" ]; then
  # May already exist — try to get existing
  OAC_ID=$(aws cloudfront list-origin-access-controls \
    --query "OriginAccessControlList.Items[?Name=='nse-oac-${S3_BUCKET}'].Id" \
    --output text 2>/dev/null || echo "")
fi

echo "  ✓  OAC ID: ${OAC_ID:-created}"

# ── Step 2: Create CloudFront distribution ────────────────────────────────────
echo ""
echo "[2/4] Creating CloudFront distribution"

S3_DOMAIN="${S3_BUCKET}.s3.${REGION}.amazonaws.com"

DIST_ID=$(aws cloudfront create-distribution \
  --distribution-config "{
    \"CallerReference\": \"nse-${STAGE}-$(date +%s)\",
    \"Comment\": \"NSE Stock Dashboard frontend — ${STAGE}\",
    \"Enabled\": true,
    \"PriceClass\": \"PriceClass_200\",
    \"Origins\": {
      \"Quantity\": 1,
      \"Items\": [{
        \"Id\": \"S3-${S3_BUCKET}\",
        \"DomainName\": \"${S3_DOMAIN}\",
        \"S3OriginConfig\": {\"OriginAccessIdentity\": \"\"},
        \"OriginAccessControlId\": \"${OAC_ID}\"
      }]
    },
    \"DefaultCacheBehavior\": {
      \"TargetOriginId\": \"S3-${S3_BUCKET}\",
      \"ViewerProtocolPolicy\": \"redirect-to-https\",
      \"CachePolicyId\": \"658327ea-f89d-4fab-a63d-7e88639e58f6\",
      \"AllowedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"], \"CachedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"]}},
      \"Compress\": true
    },
    \"CacheBehaviors\": {
      \"Quantity\": 1,
      \"Items\": [{
        \"PathPattern\": \"/static/*\",
        \"TargetOriginId\": \"S3-${S3_BUCKET}\",
        \"ViewerProtocolPolicy\": \"redirect-to-https\",
        \"CachePolicyId\": \"4135ea2d-6df8-44a3-9df3-4b5a84be39ad\",
        \"AllowedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"], \"CachedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"]}},
        \"Compress\": true
      }]
    },
    \"CustomErrorResponses\": {
      \"Quantity\": 2,
      \"Items\": [
        {\"ErrorCode\": 403, \"ResponseCode\": \"200\", \"ResponsePagePath\": \"/index.html\", \"ErrorCachingMinTTL\": 0},
        {\"ErrorCode\": 404, \"ResponseCode\": \"200\", \"ResponsePagePath\": \"/index.html\", \"ErrorCachingMinTTL\": 0}
      ]
    },
    \"DefaultRootObject\": \"index.html\"
  }" \
  --query "Distribution.[Id,DomainName]" --output text)

DIST_ID=$(echo "$DIST_ID" | awk '{print $1}')
DIST_DOMAIN=$(echo "$DIST_ID" | awk '{print $2}')

# Re-fetch domain since awk may have issues with tab-separated output
DIST_DOMAIN=$(aws cloudfront get-distribution \
  --id "${DIST_ID}" \
  --query "Distribution.DomainName" --output text)

echo "  ✓  Distribution ID: ${DIST_ID}"
echo "  ✓  Domain: ${DIST_DOMAIN}"

# ── Step 3: Update S3 bucket policy for OAC ──────────────────────────────────
echo ""
echo "[3/4] Updating S3 bucket policy (allow CloudFront OAC only)"

aws s3api put-bucket-policy \
  --bucket "${S3_BUCKET}" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"AllowCloudFrontOAC\",
      \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"cloudfront.amazonaws.com\"},
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${S3_BUCKET}/*\",
      \"Condition\": {
        \"StringEquals\": {
          \"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DIST_ID}\"
        }
      }
    }]
  }"

# Block public access (only CloudFront can serve the bucket)
aws s3api put-public-access-block \
  --bucket "${S3_BUCKET}" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"

echo "  ✓  Bucket policy updated — public access blocked"

# ── Step 4: Save distribution info to SSM ────────────────────────────────────
echo ""
echo "[4/4] Storing CloudFront info in SSM"

aws ssm put-parameter \
  --name "/nse/${STAGE}/cloudfront-domain" \
  --value "${DIST_DOMAIN}" \
  --type "String" \
  --description "CloudFront domain for ${STAGE} frontend" \
  --overwrite \
  --region "${REGION}" > /dev/null

aws ssm put-parameter \
  --name "/nse/${STAGE}/cloudfront-dist-id" \
  --value "${DIST_ID}" \
  --type "String" \
  --description "CloudFront distribution ID for ${STAGE}" \
  --overwrite \
  --region "${REGION}" > /dev/null

echo "  ✓  /nse/${STAGE}/cloudfront-domain stored in SSM"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CloudFront setup complete for: ${STAGE}"
echo ""
echo " Distribution ID: ${DIST_ID}"
echo " URL: https://${DIST_DOMAIN}"
echo ""
echo " ⏳  First deployment takes 10-15 minutes to propagate globally."
echo ""
echo " Update frontend/.env.${STAGE} with:"
echo "   REACT_APP_CDN_URL=https://${DIST_DOMAIN}"
echo ""
echo " To invalidate cache after deployment:"
echo "   aws cloudfront create-invalidation \\"
echo "     --distribution-id ${DIST_ID} \\"
echo "     --paths '/*'"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
