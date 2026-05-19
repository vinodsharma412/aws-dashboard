#!/bin/bash
# Create IAM role for Lambda functions (universe-refresh + screener-refresh).
# Run from your LOCAL machine (AWS CLI configured).
# Usage: bash infrastructure/iam/setup_lambda_role.sh

set -e

ROLE_NAME="NSELambdaRole"
POLICY_NAME="NSELambdaPolicy"
REGION="ap-south-1"

echo "[1/4] Creating IAM role (Lambda trust policy)..."
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "  Role already exists, skipping."

echo "[2/4] Attaching AWS managed policy for Lambda basic execution (CloudWatch logs)..."
aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

echo "[3/4] Creating inline policy for DynamoDB access..."
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "DynamoDBAccess",
        "Effect": "Allow",
        "Action": [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ],
        "Resource": [
          "arn:aws:dynamodb:ap-south-1:*:table/*",
          "arn:aws:dynamodb:ap-south-1:*:table/*/index/*"
        ]
      }
    ]
  }'

echo "[4/4] Done."
echo ""

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "  Lambda Role ARN (use this when deploying Lambda functions):"
echo "  arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo ""
echo "  Save this ARN — needed in Phase 9 (Lambda deploy commands)."
