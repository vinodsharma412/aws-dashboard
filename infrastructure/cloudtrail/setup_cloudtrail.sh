#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  AWS CloudTrail — API audit logging (one trail for the whole account)
#
#  What this creates:
#  ─────────────────
#  • S3 bucket:  nse-cloudtrail-{account-id}   (log storage)
#  • CloudTrail: nse-audit-trail               (management events)
#
#  What gets logged:
#  ─────────────────
#  • All AWS API calls (who called what, from where, when)
#  • IAM changes, security group changes, EC2 start/stop
#  • S3 bucket policy changes
#  • CloudTrail itself is tamper-evident (log file validation enabled)
#
#  Why CloudTrail?
#  ───────────────
#  • Compliance: auditors need a record of who accessed production data.
#  • Security: detect unexpected API calls (e.g., IAM changes, unusual access).
#  • Free tier: one trail with management events is always free.
#    Log storage in S3: 5 GB free for 12 months.
#
#  Usage:
#    bash infrastructure/cloudtrail/setup_cloudtrail.sh
#
#  Run once — the trail covers all stages (it's account-level, not stage-level).
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e

REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="nse-cloudtrail-${ACCOUNT_ID}"
TRAIL_NAME="nse-audit-trail"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CloudTrail Setup"
echo "  Account: ${ACCOUNT_ID}"
echo "  Bucket:  ${BUCKET_NAME}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Create S3 bucket for log storage ─────────────────────────────────
echo ""
echo "[1/3] Creating S3 bucket for CloudTrail logs"

aws s3api create-bucket \
  --bucket "${BUCKET_NAME}" \
  --region "${REGION}" \
  --create-bucket-configuration LocationConstraint="${REGION}" \
  2>/dev/null || echo "  Bucket already exists."

# Block public access on audit log bucket — these logs must be private
aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Bucket policy required by CloudTrail to write logs
aws s3api put-bucket-policy \
  --bucket "${BUCKET_NAME}" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Sid\": \"AWSCloudTrailAclCheck\",
        \"Effect\": \"Allow\",
        \"Principal\": {\"Service\": \"cloudtrail.amazonaws.com\"},
        \"Action\": \"s3:GetBucketAcl\",
        \"Resource\": \"arn:aws:s3:::${BUCKET_NAME}\"
      },
      {
        \"Sid\": \"AWSCloudTrailWrite\",
        \"Effect\": \"Allow\",
        \"Principal\": {\"Service\": \"cloudtrail.amazonaws.com\"},
        \"Action\": \"s3:PutObject\",
        \"Resource\": \"arn:aws:s3:::${BUCKET_NAME}/AWSLogs/${ACCOUNT_ID}/*\",
        \"Condition\": {
          \"StringEquals\": {\"s3:x-amz-acl\": \"bucket-owner-full-control\"}
        }
      }
    ]
  }"

# Enable versioning to protect log files from accidental deletion
aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled

echo "  ✓  Bucket: s3://${BUCKET_NAME}"

# ── Step 2: Create the trail ─────────────────────────────────────────────────
echo ""
echo "[2/3] Creating CloudTrail trail: ${TRAIL_NAME}"

TRAIL_ARN=$(aws cloudtrail create-trail \
  --name "${TRAIL_NAME}" \
  --s3-bucket-name "${BUCKET_NAME}" \
  --include-global-service-events \
  --is-multi-region-trail \
  --enable-log-file-validation \
  --tags-list Key=Project,Value=nse-dashboard \
  --region "${REGION}" \
  --query "TrailARN" --output text 2>/dev/null || \
  aws cloudtrail describe-trails \
    --trail-name-list "${TRAIL_NAME}" \
    --region "${REGION}" \
    --query "trailList[0].TrailARN" --output text)

# Start logging (trail is created in stopped state by default)
aws cloudtrail start-logging \
  --name "${TRAIL_NAME}" \
  --region "${REGION}" 2>/dev/null || true

echo "  ✓  Trail ARN: ${TRAIL_ARN}"
echo "  ✓  Logging started"

# ── Step 3: Configure lifecycle policy (cost control) ────────────────────────
echo ""
echo "[3/3] Setting S3 lifecycle rule (move logs to Glacier after 90 days)"

aws s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET_NAME}" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "archive-old-logs",
      "Status": "Enabled",
      "Filter": {"Prefix": "AWSLogs/"},
      "Transitions": [{
        "Days": 90,
        "StorageClass": "GLACIER"
      }],
      "Expiration": {"Days": 365}
    }]
  }'

echo "  ✓  Lifecycle: logs → Glacier at 90 days → delete at 365 days"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " CloudTrail setup complete"
echo ""
echo " Trail: ${TRAIL_NAME}"
echo " Logs:  s3://${BUCKET_NAME}"
echo ""
echo " What is logged:"
echo "   • All AWS management API calls (who, what, when, from where)"
echo "   • IAM changes, EC2 start/stop, S3 policy changes"
echo "   • Global services (IAM, STS, CloudFront)"
echo ""
echo " View logs:"
echo "   AWS Console → CloudTrail → Event History"
echo "   Or query with Athena: set up in AWS Console → CloudTrail → Event data stores"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
