#!/bin/bash
# Build the React app and deploy to S3.
#
# Usage:
#   bash infrastructure/scripts/frontend_deploy.sh
#   make deploy-frontend
#
# Prerequisites:
#   frontend/.env must exist with:
#     REACT_APP_API_URL=https://<api-gateway-id>.execute-api.ap-south-1.amazonaws.com/prod/api/v1
#     REACT_APP_SSE_URL=http://<ec2-public-ip>
#
# How it works:
#   1. Reads S3_FRONTEND_BUCKET from frontend/.env
#   2. npm ci + npm run build  (production build)
#   3. aws s3 sync build/ → S3 bucket (--delete removes stale files)
#   4. Invalidates CloudFront cache if CLOUDFRONT_DISTRIBUTION_ID is set

set -e

FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/frontend"
ENV_FILE="$FRONTEND_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "Copy frontend/.env.example to frontend/.env and fill in the values."
  exit 1
fi

# Load env vars from frontend/.env
set -o allexport
source "$ENV_FILE"
set +o allexport

S3_BUCKET="${S3_FRONTEND_BUCKET:?Set S3_FRONTEND_BUCKET in frontend/.env}"

echo "══════════════════════════════════════════"
echo "  Building React frontend..."
echo "  API URL : $REACT_APP_API_URL"
echo "  SSE URL : $REACT_APP_SSE_URL"
echo "══════════════════════════════════════════"

# ── 1. Install dependencies ────────────────────────────────────────────────────
echo "[1/3] Installing Node dependencies..."
cd "$FRONTEND_DIR"
npm ci --silent
echo "      ✓ Dependencies ready"

# ── 2. Production build ────────────────────────────────────────────────────────
echo "[2/3] Building production bundle..."
npm run build
echo "      ✓ Build complete ($(du -sh build | cut -f1) total)"

# ── 3. Upload to S3 ───────────────────────────────────────────────────────────
echo "[3/3] Uploading to s3://$S3_BUCKET ..."

# HTML files: short cache so React Router updates propagate quickly
aws s3 sync build/ "s3://$S3_BUCKET" \
  --delete \
  --exclude "static/*" \
  --cache-control "no-cache, no-store, must-revalidate"

# Static assets (JS/CSS/images): long cache — filenames are content-hashed
aws s3 sync build/static/ "s3://$S3_BUCKET/static" \
  --delete \
  --cache-control "public, max-age=31536000, immutable"

echo "      ✓ Uploaded to S3"

# ── Optional: invalidate CloudFront cache ──────────────────────────────────────
if [ -n "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
  echo "      Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "/*" \
    --query "Invalidation.Id" --output text
  echo "      ✓ CloudFront invalidated"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  ✓ Frontend deployed!"
echo ""
echo "  S3 URL:  http://$S3_BUCKET.s3-website.ap-south-1.amazonaws.com"
echo ""
echo "  To find your S3 website URL:"
echo "    AWS Console → S3 → $S3_BUCKET → Properties → Static website hosting"
echo "══════════════════════════════════════════"
