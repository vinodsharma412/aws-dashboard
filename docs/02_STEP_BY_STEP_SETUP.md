# Step-by-Step AWS Setup Guide

> **One-time setup from scratch.** Follow this to go from a blank AWS account to a running three-stage deployment. If you already have AWS set up, jump to the phase you need.

---

## Overview

What you'll set up:

```
PHASE 1  AWS account + IAM user
PHASE 2  EC2 instance (the server)
PHASE 3  EC2 software (Python, Nginx, systemd services)
PHASE 4  DynamoDB tables (all 13 tables × 3 stages)
PHASE 5  Secrets in SSM Parameter Store
PHASE 6  SQS queues + SNS alerts
PHASE 7  S3 buckets (frontend + avatars)
PHASE 8  Lambda + EventBridge (background jobs)
PHASE 9  GitHub Actions (CI/CD pipeline)
PHASE 10 First admin user
```

---

## PHASE 1 — AWS Account and IAM

### 1.1 Create a free AWS account

1. Go to https://aws.amazon.com/free/
2. Sign up → choose **Personal** account type
3. Credit card required but not charged within free tier
4. Choose **Basic Support** (free)
5. Select region: **Asia Pacific (Mumbai) — ap-south-1**

### 1.2 Create an IAM admin user (never use root)

1. AWS Console → IAM → Users → **Create user**
2. Username: `nse-admin`
3. Check "Provide user access to the AWS Management Console"
4. Select "I want to create an IAM user"
5. Attach policy: `AdministratorAccess`
6. Click through → **Create user**
7. Create access keys: IAM → Users → nse-admin → **Security credentials** → Create access key
8. **Download the CSV** — you will not see the secret again

### 1.3 Install and configure AWS CLI

```bash
# Ubuntu/Debian
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install
aws --version

# Configure
aws configure
# AWS Access Key ID:     paste from CSV
# AWS Secret Access Key: paste from CSV
# Default region:        ap-south-1
# Default output:        json
```

---

## PHASE 2 — EC2 Instance

### 2.1 Launch EC2

1. AWS Console → EC2 → **Launch Instance**
2. **Name:** `nse-stock-server`
3. **AMI:** Ubuntu Server 22.04 LTS (Free tier)
4. **Instance type:** t2.micro (Free tier)
5. **Key pair:** Create new key pair
   - Name: `nse-keypair`
   - Type: RSA, Format: .pem
   - **Save** `nse-keypair.pem` to `~/.ssh/` on your machine
6. **Security Group:** Create new with these rules:
   - SSH (port 22) from **Anywhere 0.0.0.0/0** — required for GitHub Actions CI/CD
   - HTTP (port 80) from Anywhere
   - Custom TCP 9000-9002 from Anywhere (optional, for direct port testing)
7. **Storage:** 20 GB gp3 (free tier allows up to 30 GB)
8. Launch

### 2.2 Assign Elastic IP (prevents IP change on restart)

1. EC2 → **Elastic IPs** → Allocate Elastic IP address → Allocate
2. Select the new IP → Actions → **Associate Elastic IP**
3. Choose your instance → Associate
4. **Copy this IP** — it's used in every URL and GitHub secret

### 2.3 SSH in to verify

```bash
chmod 400 ~/.ssh/nse-keypair.pem
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
# Should see Ubuntu prompt. Type `exit` when done.
```

---

## PHASE 3 — EC2 Software Setup

### 3.1 Copy and run the setup script

```bash
# From your local machine (in the project root):
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/ec2_setup.sh \
    ubuntu@<YOUR-ELASTIC-IP>:~/

ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
bash ~/ec2_setup.sh
# Takes ~10 minutes. Installs Python, Nginx, Node.js, Playwright.
```

### 3.2 Create stage directories and .env files

```bash
# On EC2:

# Create directories
sudo mkdir -p /opt/nse-dev /opt/nse-qc /opt/nse
sudo chown -R ubuntu:ubuntu /opt/nse-dev /opt/nse-qc /opt/nse

# Create Python virtualenvs
python3 -m venv /opt/nse-dev/venv
python3 -m venv /opt/nse-qc/venv
python3 -m venv /opt/nse/venv

# Create .env files for each stage
# These only need STAGE — secrets come from SSM
cat > /opt/nse-dev/.env << 'EOF'
STAGE=dev
APP_ENV=development
DEBUG=true
EOF

cat > /opt/nse-qc/.env << 'EOF'
STAGE=qc
APP_ENV=staging
DEBUG=false
EOF

cat > /opt/nse/.env << 'EOF'
STAGE=prod
APP_ENV=production
DEBUG=false
EOF
```

### 3.3 Install Nginx config

```bash
# From your local machine:
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/nginx.conf \
    ubuntu@<YOUR-ELASTIC-IP>:~/nginx-nse.conf

# On EC2:
sudo cp ~/nginx-nse.conf /etc/nginx/sites-available/nse
sudo ln -sf /etc/nginx/sites-available/nse /etc/nginx/sites-enabled/nse
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 3.4 Install systemd services

```bash
# From your local machine, copy all service files:
for svc in nse-api nse-worker nse-api-dev nse-worker-dev nse-api-qc nse-worker-qc; do
    scp -i ~/.ssh/nse-keypair.pem \
        infrastructure/scripts/${svc}.service \
        ubuntu@<YOUR-ELASTIC-IP>:~/${svc}.service
done

# On EC2:
sudo cp ~/nse-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nse-api-dev nse-worker-dev
sudo systemctl enable nse-api-qc nse-worker-qc
sudo systemctl enable nse-api nse-worker
```

---

## PHASE 4 — DynamoDB Tables

Run from your **local machine** (or any machine with AWS CLI configured):

```bash
cd /path/to/aws

# Create tables for all three stages
STAGE=dev  python3 infrastructure/dynamodb/create_tables.py
STAGE=qc   python3 infrastructure/dynamodb/create_tables.py
STAGE=prod python3 infrastructure/dynamodb/create_tables.py
```

Verify in AWS Console → DynamoDB → Tables → you should see tables prefixed with `dev_`, `qc_`, and unprefixed tables for prod.

---

## PHASE 5 — Secrets in SSM Parameter Store

Run for each stage. The script is interactive — it will prompt for each value.

```bash
bash infrastructure/ssm/setup_ssm.sh dev
bash infrastructure/ssm/setup_ssm.sh qc
bash infrastructure/ssm/setup_ssm.sh prod
```

**Values you'll be prompted for** (same for each stage):

| Prompt | What to enter |
|--------|---------------|
| JWT secret | Run: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| Gmail user | Your Gmail address (for alert emails) |
| Gmail app password | Gmail → Security → App passwords → generate one |
| S3 assets bucket | `nse-assets-<your-aws-account-id>` |
| SNS alerts ARN | Leave blank for now — fill in after Phase 6 |

> After Phase 6, re-run `bash infrastructure/ssm/setup_ssm.sh prod` to add the SNS ARN and SQS URL.

---

## PHASE 6 — SQS and SNS

```bash
# Create SQS queues (main queue + dead letter queue) for each stage
bash infrastructure/sqs/setup_sqs.sh dev
bash infrastructure/sqs/setup_sqs.sh qc
bash infrastructure/sqs/setup_sqs.sh prod
# The SQS URLs are automatically saved to SSM

# Create SNS alert topics + email subscriptions
bash infrastructure/sns/setup_sns.sh dev   your@email.com
bash infrastructure/sns/setup_sns.sh qc    your@email.com
bash infrastructure/sns/setup_sns.sh prod  your@email.com
```

**Important:** Check your email after each SNS command and click **Confirm subscription**. Alerts won't arrive until the subscription is confirmed.

---

## PHASE 7 — S3 Buckets

```bash
bash infrastructure/scripts/s3_setup.sh
```

This creates:
- `nse-frontend-<account-id>` — React builds (one folder per stage: `/dev/`, `/qc/`, root for prod)
- `nse-assets-<account-id>` — user avatar images (private, accessed via signed URLs)

Note the bucket name — you'll need it for GitHub secrets.

---

## PHASE 8 — Lambda + EventBridge (background jobs)

```bash
# IAM roles first (one-time per account)
bash infrastructure/iam/setup_ec2_role.sh
bash infrastructure/iam/setup_lambda_role.sh

# Lambda functions
bash infrastructure/lambda/deploy_lambdas.sh prod

# EventBridge cron triggers
bash infrastructure/eventbridge/setup_eventbridge.sh prod
```

This sets up:
- **nse-screener-refresh** — runs every 30 min during market hours → pre-computes screener
- **nse-universe-refresh** — runs daily at 3 AM IST → downloads NSE symbol list
- **nse-dlq-alert** — triggered by SQS DLQ → sends failure email via SNS

---

## PHASE 9 — GitHub Actions (CI/CD pipeline)

### 9.1 Add GitHub Secrets

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your Elastic IP |
| `EC2_SSH_KEY` | Full contents of `~/.ssh/nse-keypair.pem` (including BEGIN/END lines) |
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `S3_FRONTEND_BUCKET` | `nse-frontend-<your-account-id>` |
| `DEV_API_URL` | `http://<ELASTIC-IP>/dev/api/v1` |
| `DEV_SSE_URL` | `http://<ELASTIC-IP>` |
| `QC_API_URL` | `http://<ELASTIC-IP>/qc/api/v1` |
| `QC_SSE_URL` | `http://<ELASTIC-IP>` |

### 9.2 Create GitHub Environments

GitHub repo → **Settings → Environments → New environment**:

1. Create `dev` — no protection rules
2. Create `qc` — no protection rules
3. Create `prod` — Required reviewers → add your GitHub username → Save

### 9.3 Deploy the first time

```bash
git push origin develop
# Watch GitHub → Actions → "Deploy Pipeline" run
```

The pipeline will:
1. Lint Python + build React frontend
2. rsync backend code to `/opt/nse-dev/backend/` on EC2
3. `pip install`, restart `nse-api-dev`, health check
4. Deploy frontend to S3 `/dev/` folder
5. Repeat for QC
6. Wait for your approval → deploy to PROD

---

## PHASE 10 — Create First Admin User

After the first successful deployment, create the admin user for whichever stage you want to access:

```bash
# SSH into EC2
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<ELASTIC-IP>

# For DEV
cd /opt/nse-dev/backend
/opt/nse-dev/venv/bin/python3 - <<'EOF'
from app.db.dynamo import dynamo_users
from app.core.security import hash_password
import uuid, datetime, os
os.environ.setdefault("STAGE", "dev")

dynamo_users.put_item(Item={
    "user_id": str(uuid.uuid4()),
    "username": "admin",
    "email": "admin@example.com",
    "full_name": "Admin User",
    "role": "admin",
    "hashed_password": hash_password("changeme123"),
    "is_active": True,
    "created_at": datetime.datetime.utcnow().isoformat(),
})
print("Admin user created for DEV — login: admin / changeme123")
EOF
```

Then open the frontend URL and log in with `admin` / `changeme123`. **Change the password in Settings immediately.**

---

## Useful Commands After Setup

```bash
# Check all services on EC2
sudo systemctl status nse-api-dev nse-api-qc nse-api

# Tail logs for any stage
sudo journalctl -u nse-api-dev -f
sudo journalctl -u nse-api-qc -f
sudo journalctl -u nse-api -f

# Verify all health endpoints
curl http://localhost:9001/api/v1/health/   # DEV
curl http://localhost:9002/api/v1/health/   # QC
curl http://localhost:9000/api/v1/health/   # PROD

# Verify through Nginx
curl http://<ELASTIC-IP>/dev/api/v1/health/
curl http://<ELASTIC-IP>/qc/api/v1/health/
curl http://<ELASTIC-IP>/api/v1/health/

# View all SSM parameters for a stage
aws ssm get-parameters-by-path --path /nse/prod/ --with-decryption --region ap-south-1

# Disk usage (watch this — EC2 disk can fill up with pip cache)
df -h
```

---

## CloudFront (optional, PROD only)

Adds HTTPS and edge caching for the React frontend.

```bash
bash infrastructure/cloudfront/setup_cloudfront.sh
```

The CloudFront distribution ID is saved to SSM at `/nse/prod/cloudfront-dist-id`. The CI/CD pipeline reads it automatically to invalidate the CDN cache after each PROD deploy.
