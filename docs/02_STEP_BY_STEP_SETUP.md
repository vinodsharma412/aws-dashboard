# Step-by-Step Setup Guide

> One AWS account, one EC2, two stages (staging + prod). Follow these steps once to go from zero to a running pipeline.

---

## Overview

```
STEP 1   AWS account + IAM user          (~10 min)
STEP 2   EC2 instance                    (~10 min)
STEP 3   EC2 software setup              (~15 min)
STEP 4   DynamoDB tables                 (5 min)
STEP 5   SSM secrets                     (5 min)
STEP 6   SQS queues + SNS alerts         (5 min)
STEP 7   S3 buckets                      (5 min)
STEP 8   GitHub secrets + pipeline       (5 min)
STEP 9   First admin user                (2 min)
```

Total: ~1 hour.

---

## STEP 1 — AWS Account and IAM

### 1.1 Create free AWS account (skip if you have one)

1. [aws.amazon.com/free](https://aws.amazon.com/free) → Create account
2. Choose **Personal** account, enter credit card (not charged in free tier)
3. Region: **Asia Pacific (Mumbai) — ap-south-1**

### 1.2 Create an IAM admin user

Never use the root account for daily work.

1. AWS Console → **IAM** → **Users** → **Create user**
2. Username: `nse-admin`
3. Check **"Provide user access to the AWS Management Console"**
4. Select **"I want to create an IAM user"** → set a password
5. Attach policy: `AdministratorAccess`
6. **Create user** → then create access keys:
   - IAM → Users → `nse-admin` → **Security credentials** → **Create access key**
   - Use case: "CLI" → **Download CSV** (you cannot view the secret again)

### 1.3 Configure AWS CLI

```bash
aws configure
# AWS Access Key ID:     paste from CSV
# AWS Secret Access Key: paste from CSV
# Default region:        ap-south-1
# Default output:        json

# Verify
aws sts get-caller-identity   # should print your account ID
```

---

## STEP 2 — EC2 Instance

### 2.1 Launch EC2

AWS Console → **EC2** → **Launch instance**

| Setting | Value |
|---------|-------|
| Name | `nse-server` |
| AMI | Ubuntu Server 22.04 LTS (Free tier eligible) |
| Instance type | t2.micro (Free tier eligible) |
| Key pair | Create new → Name: `nse-keypair`, RSA, .pem → **Download** to `~/.ssh/` |
| Security group | New group: SSH port 22 from **Anywhere 0.0.0.0/0**, HTTP port 80 from Anywhere |
| Storage | 20 GB gp3 |

Click **Launch instance**.

### 2.2 Assign Elastic IP (prevents IP change on restart)

1. EC2 → **Elastic IPs** → **Allocate Elastic IP** → Allocate
2. Select new IP → **Actions** → **Associate** → choose `nse-server` → Associate
3. **Copy this IP** — used in every GitHub secret

### 2.3 Verify SSH

```bash
chmod 400 ~/.ssh/nse-keypair.pem
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
# Should show Ubuntu prompt. Type exit when done.
```

---

## STEP 3 — EC2 Software Setup

### 3.1 Copy and run the setup script

```bash
# From project root on your local machine:
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/ec2_setup.sh \
    ubuntu@<YOUR-ELASTIC-IP>:~/

ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
bash ~/ec2_setup.sh
# Takes ~10 minutes: Python, pip, Nginx, Node.js, Playwright, git
```

### 3.2 Create stage directories

On the EC2:

```bash
# Staging
sudo mkdir -p /opt/nse-staging
sudo chown ubuntu:ubuntu /opt/nse-staging
python3 -m venv /opt/nse-staging/venv
cat > /opt/nse-staging/.env << 'EOF'
STAGE=staging
APP_ENV=staging
DEBUG=false
EOF

# Prod
sudo mkdir -p /opt/nse
sudo chown ubuntu:ubuntu /opt/nse
python3 -m venv /opt/nse/venv
cat > /opt/nse/.env << 'EOF'
STAGE=prod
APP_ENV=production
DEBUG=false
EOF
```

### 3.3 Install Nginx

```bash
# From local machine:
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/nginx.conf \
    ubuntu@<YOUR-ELASTIC-IP>:~/

# On EC2:
sudo cp ~/nginx.conf /etc/nginx/sites-available/nse
sudo ln -sf /etc/nginx/sites-available/nse /etc/nginx/sites-enabled/nse
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 3.4 Install systemd services

```bash
# From local machine:
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/nse-api.service \
    infrastructure/scripts/nse-worker.service \
    infrastructure/scripts/nse-api-staging.service \
    infrastructure/scripts/nse-worker-staging.service \
    ubuntu@<YOUR-ELASTIC-IP>:~/

# On EC2:
sudo cp ~/nse-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nse-api nse-worker
sudo systemctl enable nse-api-staging nse-worker-staging
# Do NOT start yet — no backend code deployed yet
```

### 3.5 Attach IAM role to EC2

The EC2 needs permission to read DynamoDB, S3, and SSM without hardcoded keys.

```bash
# From local machine:
bash infrastructure/iam/setup_ec2_role.sh
```

Then in AWS Console:
1. EC2 → select `nse-server` → **Actions** → **Security** → **Modify IAM role**
2. Select `NSEStockDashboardEC2Role` → **Update IAM role**

---

## STEP 4 — DynamoDB Tables

```bash
# Create tables for both stages
STAGE=staging python3 infrastructure/dynamodb/create_tables.py
STAGE=prod    python3 infrastructure/dynamodb/create_tables.py
```

Verify: AWS Console → DynamoDB → Tables
- Staging tables have `stg_` prefix: `stg_users`, `stg_stock_transactions`, …
- Prod tables have no prefix: `users`, `stock_transactions`, …

---

## STEP 5 — SSM Secrets

Run for each stage. The script prompts for each value.

```bash
bash infrastructure/ssm/setup_ssm.sh staging
bash infrastructure/ssm/setup_ssm.sh prod
```

**What to enter at each prompt:**

| Prompt | Value |
|--------|-------|
| JWT secret | `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| Gmail user | Your Gmail address (for alert emails) |
| Gmail app password | Gmail → Security → App passwords → generate one |
| S3 assets bucket | `nse-assets-<your-account-id>` (from STEP 7) |
| SNS alerts ARN | Press Enter for now — fill in after STEP 6 |

> After STEP 6, re-run `bash infrastructure/ssm/setup_ssm.sh staging` (and prod) to add the SNS ARN.

---

## STEP 6 — SQS Queues + SNS Alerts

```bash
# SQS: creates main queue + dead-letter queue for each stage
bash infrastructure/sqs/setup_sqs.sh staging
bash infrastructure/sqs/setup_sqs.sh prod
# → SQS URLs are automatically saved to SSM

# SNS: creates alert topic + email subscription
bash infrastructure/sns/setup_sns.sh staging your@email.com
bash infrastructure/sns/setup_sns.sh prod    your@email.com
```

**Important:** Check your email and click **Confirm subscription** for both topics. Alerts won't arrive until confirmed.

Then update SSM with the SNS ARNs:

```bash
bash infrastructure/ssm/setup_ssm.sh staging
# When prompted for SNS ARN: paste the ARN from the sns script output
# For all other prompts: press Enter to keep existing values

bash infrastructure/ssm/setup_ssm.sh prod
```

---

## STEP 7 — S3 Buckets

```bash
bash infrastructure/scripts/s3_setup.sh
```

Creates:
- `nse-frontend-<account-id>` — React builds (staging at `/staging/` subfolder, prod at root)
- `nse-assets-<account-id>` — user avatars (private)

Note the bucket names, then go back to STEP 5 and re-run SSM setup to save the assets bucket name.

---

## STEP 8 — GitHub Secrets and Pipeline

### 8.1 Add secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your Elastic IP |
| `EC2_SSH_KEY` | Full contents of `~/.ssh/nse-keypair.pem` (including `-----BEGIN` and `-----END` lines) |
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `S3_FRONTEND_BUCKET` | `nse-frontend-<your-account-id>` |
| `STAGING_API_URL` | `http://<EC2_HOST>/staging/api/v1` |
| `STAGING_SSE_URL` | `http://<EC2_HOST>` |
| `PROD_API_URL` | `http://<EC2_HOST>/api/v1` |
| `PROD_SSE_URL` | `http://<EC2_HOST>` |

### 8.2 Create GitHub Environments

GitHub repo → **Settings** → **Environments**

1. **New environment** → name: `staging` → no protection → Configure environment
2. **New environment** → name: `prod` → **Required reviewers** → add your GitHub username → **Save protection rules**

### 8.3 Trigger first deployment

```bash
git push origin develop
```

GitHub → **Actions** → watch **Deploy Pipeline** run.

**Expected flow:**
1. Lint & Test — ~3 min (ruff + 2 frontend builds)
2. Deploy STAGING — ~3 min (rsync, pip, restart, health check, S3 upload)
3. Waiting for approval — GitHub emails you
4. GitHub → Actions → **Review deployments** → tick `prod` → **Approve and deploy**
5. Deploy PROD — ~3 min

---

## STEP 9 — Create Admin Users

After the first successful deployment, SSH in and create the admin user for each stage.

```bash
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>

# For STAGING
cd /opt/nse-staging/backend
/opt/nse-staging/venv/bin/python3 - << 'EOF'
import os; os.environ["STAGE"] = "staging"
from app.db.dynamo import dynamo_users
from app.core.security import hash_password
import uuid, datetime
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
print("Staging admin created")
EOF

# For PROD (same script with different path and STAGE)
cd /opt/nse/backend
/opt/nse/venv/bin/python3 - << 'EOF'
import os; os.environ["STAGE"] = "prod"
from app.db.dynamo import dynamo_users
from app.core.security import hash_password
import uuid, datetime
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
print("Prod admin created")
EOF
```

**Change the default password immediately** after first login (Settings page).

---

## Verify Everything Works

```bash
# Health checks
curl http://<EC2_HOST>/staging/api/v1/health/   # → {"status":"ok"}
curl http://<EC2_HOST>/api/v1/health/            # → {"status":"ok"}

# Frontend URLs
# Staging: http://nse-frontend-<account-id>.s3-website.ap-south-1.amazonaws.com/staging/
# Prod:    http://nse-frontend-<account-id>.s3-website.ap-south-1.amazonaws.com/

# Automated smoke tests
make test-staging EC2_HOST=<YOUR-ELASTIC-IP>
```

---

## Ongoing Operations

```bash
# Tail logs
make logs                    # staging API logs
make logs STAGE=prod         # prod API logs
make logs-worker             # staging worker logs
make logs-worker STAGE=prod  # prod worker logs

# Restart a stage
make restart                 # restart staging
make restart STAGE=prod      # restart prod

# Manual deploy (without CI/CD)
make deploy STAGE=staging EC2_HOST=<IP>
make deploy STAGE=prod    EC2_HOST=<IP>

# Check both stages at once
make health EC2_HOST=<IP>
```
