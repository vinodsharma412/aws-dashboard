#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  AWS SSM Parameter Store — secrets setup for one deployment stage
#
#  Why SSM Parameter Store (not Secrets Manager)?
#  ─────────────────────────────────────────────
#  SSM SecureString parameters use the AWS-managed KMS key at ZERO COST.
#  Secrets Manager charges $0.40/secret/month — that adds up fast when
#  exploring AWS architecture.  Both services serve the same purpose for
#  this use case: encrypted, auditable credential storage.
#
#  What is stored here:
#    /nse/{stage}/jwt-secret         JWT signing key for the FastAPI app
#    /nse/{stage}/gmail-user         Gmail address for SMTP alerts
#    /nse/{stage}/gmail-password     Gmail app-specific password
#    /nse/{stage}/sqs-jobs-url       SQS queue URL for scraping jobs
#    /nse/{stage}/sns-alerts-arn     SNS topic ARN for failure alerts
#    /nse/{stage}/s3-assets-bucket   S3 bucket name for user avatars
#    /nse/{stage}/service-account-password  nse-service account password
#
#  The FastAPI app reads these at startup via app/config.py → _ssm_get().
#  On EC2 the instance profile (NSEStockDashboardEC2Role) has SSM read access.
#  Lambda functions read them via the NSELambdaRole.
#
#  Usage:
#    bash infrastructure/ssm/setup_ssm.sh <stage>
#
#  Example:
#    bash infrastructure/ssm/setup_ssm.sh dev
#    bash infrastructure/ssm/setup_ssm.sh qc
#    bash infrastructure/ssm/setup_ssm.sh prod
#
#  Run from your LOCAL machine with AWS CLI configured.
#  The script prompts for each secret value — nothing is hard-coded here.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

STAGE="${1:?Usage: $0 <stage>  (dev | qc | prod)}"
REGION="ap-south-1"
PREFIX="/nse/${STAGE}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NSE SSM Parameter Setup — stage: ${STAGE}"
echo "  Region: ${REGION}"
echo "  Parameter prefix: ${PREFIX}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Helper: put a SecureString (encrypted) parameter.
# Overwrites if it already exists (--overwrite).
_put_secure() {
  local key="$1"
  local value="$2"
  local desc="$3"
  aws ssm put-parameter \
    --name "${PREFIX}/${key}" \
    --value "${value}" \
    --type "SecureString" \
    --description "${desc}" \
    --overwrite \
    --region "${REGION}" \
    --output text --query "Version" > /dev/null
  echo "  ✓  ${PREFIX}/${key}"
}

# Helper: put a plain String parameter (non-sensitive config).
_put_string() {
  local key="$1"
  local value="$2"
  local desc="$3"
  aws ssm put-parameter \
    --name "${PREFIX}/${key}" \
    --value "${value}" \
    --type "String" \
    --description "${desc}" \
    --overwrite \
    --region "${REGION}" \
    --output text --query "Version" > /dev/null
  echo "  ✓  ${PREFIX}/${key}"
}

# ── 1. JWT secret key ─────────────────────────────────────────────────────────
echo "[1/7] JWT signing secret"
echo "      Used by FastAPI to sign and verify JWT tokens."
echo "      Must be the same across all EC2 instances in this stage."
read -rsp "      Enter JWT_SECRET (or press Enter to auto-generate): " jwt_val
echo ""
if [ -z "$jwt_val" ]; then
  jwt_val=$(python3 -c "import secrets; print(secrets.token_hex(32))")
  echo "      Auto-generated: ${jwt_val}"
fi
_put_secure "jwt-secret" "${jwt_val}" "JWT signing key for stage ${STAGE}"

# ── 2. Gmail user ─────────────────────────────────────────────────────────────
echo "[2/7] Gmail sender address (used for SMTP alerts)"
read -rp "      Enter GMAIL_USER (or press Enter to skip): " gmail_user
if [ -n "$gmail_user" ]; then
  _put_string "gmail-user" "${gmail_user}" "Gmail sender for ${STAGE} alerts"
else
  echo "      Skipped."
fi

# ── 3. Gmail app password ─────────────────────────────────────────────────────
echo "[3/7] Gmail app-specific password"
echo "      Create one at https://myaccount.google.com/apppasswords"
read -rsp "      Enter GMAIL_APP_PASSWORD (or press Enter to skip): " gmail_pass
echo ""
if [ -n "$gmail_pass" ]; then
  _put_secure "gmail-password" "${gmail_pass}" "Gmail app password for ${STAGE}"
else
  echo "      Skipped."
fi

# ── 4. SQS queue URL ─────────────────────────────────────────────────────────
echo "[4/7] SQS scraping jobs queue URL"
echo "      Run infrastructure/sqs/setup_sqs.sh first to get this URL."
read -rp "      Enter SQS_SCRAPING_JOBS_URL (or press Enter to skip): " sqs_url
if [ -n "$sqs_url" ]; then
  _put_string "sqs-jobs-url" "${sqs_url}" "SQS scraping jobs queue URL for ${STAGE}"
else
  echo "      Skipped."
fi

# ── 5. SNS alerts ARN ────────────────────────────────────────────────────────
echo "[5/7] SNS alerts topic ARN"
echo "      Run infrastructure/sns/setup_sns.sh first to get this ARN."
read -rp "      Enter SNS_ALERTS_ARN (or press Enter to skip): " sns_arn
if [ -n "$sns_arn" ]; then
  _put_string "sns-alerts-arn" "${sns_arn}" "SNS alerts topic ARN for ${STAGE}"
else
  echo "      Skipped."
fi

# ── 6. S3 assets bucket ──────────────────────────────────────────────────────
echo "[6/7] S3 assets bucket name (user avatars)"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
default_bucket="nse-assets-${ACCOUNT_ID}-${STAGE}"
read -rp "      Enter S3_ASSETS_BUCKET [${default_bucket}]: " s3_bucket
s3_bucket="${s3_bucket:-${default_bucket}}"
_put_string "s3-assets-bucket" "${s3_bucket}" "S3 assets bucket for ${STAGE}"

# ── 7. Service account password ──────────────────────────────────────────────
echo "[7/7] NSE service account password"
echo "      Used by Lambda screener_refresh to authenticate with EC2 API."
read -rsp "      Enter service-account-password (required, no default): " svc_pass
echo ""
if [ -z "$svc_pass" ]; then
  echo "  ERROR: service-account-password cannot be empty." >&2
  exit 1
fi
_put_secure "service-account-password" "${svc_pass}" "nse-service account password for ${STAGE}"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " SSM setup complete for stage: ${STAGE}"
echo ""
echo " Parameters stored under: ${PREFIX}/"
echo " View in AWS Console:"
echo "   AWS Systems Manager → Parameter Store"
echo "   Filter by: /nse/${STAGE}/"
echo ""
echo " On EC2: set STAGE=${STAGE} in /etc/systemd/system/nse-api.service"
echo " The FastAPI app will read these at startup via app/config.py"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
