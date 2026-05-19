#!/bin/bash
# Create an IAM role for EC2 with DynamoDB + S3 permissions.
# Run from your LOCAL machine (AWS CLI configured).
# After running, attach the role to your EC2 instance.

set -e

ROLE_NAME="NSEStockDashboardEC2Role"
POLICY_NAME="NSEStockDashboardEC2Policy"
REGION="ap-south-1"

echo "[1/4] Creating IAM role (EC2 trust policy)..."
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "  Role already exists, skipping."

echo "[2/4] Creating inline policy..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document file://infrastructure/iam/ec2_policy.json

echo "[3/4] Creating instance profile..."
aws iam create-instance-profile \
  --instance-profile-name "$ROLE_NAME" 2>/dev/null || echo "  Profile exists."

aws iam add-role-to-instance-profile \
  --instance-profile-name "$ROLE_NAME" \
  --role-name "$ROLE_NAME" 2>/dev/null || echo "  Role already in profile."

echo "[4/4] Done. Now attach the role to your EC2 instance:"
echo ""
echo "  AWS Console → EC2 → Select instance → Actions"
echo "  → Security → Modify IAM Role → Select: $ROLE_NAME"
echo ""
echo "  Or via CLI (replace INSTANCE_ID):"
echo "  aws ec2 associate-iam-instance-profile \\"
echo "    --instance-id i-XXXXXXXXXXXXXXXXX \\"
echo "    --iam-instance-profile Name=$ROLE_NAME"
echo ""
echo "  After attaching, no AWS credentials are needed in .env on EC2!"
