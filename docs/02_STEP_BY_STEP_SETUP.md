# Step-by-Step Setup Guide — Multi-Account Deployment

> Follow these steps in order. Each step tells you which account to be logged into, exactly what to click, and what to copy for the next step.

---

## Overview

```
PART A  AWS Organization (one-time, ~15 min)
PART B  Set up DEV account  (EC2 + infra, ~30 min)
PART C  Set up QC account   (same steps as DEV, ~20 min)
PART D  Set up PROD account (same steps as DEV, ~20 min)
PART E  GitHub secrets + first deployment (~10 min)
```

What you will have at the end:
- 3 completely independent AWS accounts (dev / qc / prod)
- A GitHub Actions pipeline that deploys to each account automatically
- No DynamoDB table prefixes — `users` means `users` in every account
- Dev code cannot access prod data even if it tries — wrong credentials

---

## Before you start — collect these items

You need:
- **3 email addresses** — one per AWS account. Gmail trick: if your email is `you@gmail.com`, use `you+nsedev@gmail.com`, `you+nseqc@gmail.com`, `you+nseprod@gmail.com` (all go to the same inbox)
- **Your existing AWS account** — this becomes the management (billing) account
- **Your GitHub repo** — `aws-dashboard`
- **Your local machine** — with AWS CLI installed and `~/.ssh/nse-key.pem` saved

---

## PART A — AWS Organization

### A.1 — Enable AWS Organizations

> Log in as: **your existing AWS account (management account)**

1. AWS Console → search **"Organizations"** → open it
2. Click **"Create organization"**
3. Confirm → click **"Create organization"** again
4. Your current account is now the **management account** — this is for billing only, you will not deploy any app resources here

### A.2 — Create the DEV member account

Still in AWS Organizations:

1. Click **"Add an AWS account"**
2. Select **"Create an AWS account"**
3. Fill in:
   - **AWS account name:** `nse-dev`
   - **Email address:** `you+nsedev@gmail.com` (or any unique email)
   - **IAM role name:** leave as `OrganizationAccountAccessRole`
4. Click **"Create AWS account"**
5. Wait ~2 minutes for it to appear in the list

### A.3 — Create the QC member account

Repeat A.2 with:
- **AWS account name:** `nse-qc`
- **Email address:** `you+nseqc@gmail.com`

### A.4 — Create the PROD member account

Repeat A.2 with:
- **AWS account name:** `nse-prod`
- **Email address:** `you+nseprod@gmail.com`

### A.5 — Note the account IDs

In AWS Organizations → "AWS accounts" list, you will see all four accounts. **Copy the Account ID (12-digit number) for each:**

| Account | Account ID | Note it here |
|---------|-----------|--------------|
| nse-dev  | ____________ | |
| nse-qc   | ____________ | |
| nse-prod | ____________ | |

You will need these for S3 bucket names.

---

## PART B — Set up DEV account

You will repeat Parts B, C, D with the same steps. Do DEV first to get familiar with the process.

### B.1 — Switch to the DEV account

> **How to switch accounts in AWS Console:**
> Top-right corner → click your account name → **"Switch role"**
> OR: Top-right → **"Switch role"** → fill in:
> - Account ID: _(from A.5, nse-dev)_
> - Role: `OrganizationAccountAccessRole`
> - Display name: `nse-dev`
> - Color: pick any (green for dev)
> Click **"Switch role"**

The top-right corner now shows `nse-dev`. You are now operating inside the DEV account.

### B.2 — Create an IAM admin user (never use root for daily work)

> Still in: **nse-dev account**

1. AWS Console → **IAM** → **Users** → **Create user**
2. Username: `nse-admin`
3. Check **"Provide user access to the AWS Management Console"**
4. Select **"I want to create an IAM user"**
5. Set a password → Next
6. Click **"Attach policies directly"** → search and attach `AdministratorAccess`
7. Click **"Create user"**
8. **Create access keys:**
   - IAM → Users → `nse-admin` → **Security credentials** tab
   - Click **"Create access key"** → Use case: "CLI"
   - **Download the CSV** or copy both values now — you won't see the secret again

> **Save these — you'll need them for GitHub secrets:**
> - `DEV_AWS_ACCESS_KEY_ID` = _____________________
> - `DEV_AWS_SECRET_ACCESS_KEY` = _____________________

### B.3 — Configure AWS CLI for the DEV account (local machine)

Open a terminal on your local machine:

```bash
aws configure --profile nse-dev
# AWS Access Key ID:     paste DEV_AWS_ACCESS_KEY_ID
# AWS Secret Access Key: paste DEV_AWS_SECRET_ACCESS_KEY
# Default region:        ap-south-1
# Default output:        json

# Verify it works
aws sts get-caller-identity --profile nse-dev
# Should show the nse-dev account ID
```

### B.4 — Launch EC2 in DEV account

> Back in AWS Console, still in **nse-dev account**

1. Switch region to **ap-south-1 (Mumbai)** (top-right dropdown)
2. EC2 → **"Launch instance"**
3. Fill in:
   - **Name:** `nse-dev-server`
   - **AMI:** Ubuntu Server 22.04 LTS _(Free tier eligible)_
   - **Instance type:** t2.micro _(Free tier eligible)_
   - **Key pair:** Click **"Create new key pair"**
     - Name: `nse-keypair`
     - Type: RSA, Format: `.pem`
     - **Download** `nse-keypair.pem` → save to `~/.ssh/`
     - _(Use the same name in every account so one key file works for all three EC2s)_
   - **Security Group:** Create new
     - Allow SSH (port 22) from **Anywhere 0.0.0.0/0** ← required for GitHub Actions
     - Allow HTTP (port 80) from **Anywhere**
   - **Storage:** 20 GB gp3
4. Click **"Launch instance"**

### B.5 — Assign Elastic IP to DEV EC2

1. EC2 → **Elastic IPs** → **"Allocate Elastic IP address"** → Allocate
2. Select the new IP → **Actions** → **"Associate Elastic IP address"**
3. Instance: select `nse-dev-server` → Associate

> **Save this — you'll need it for GitHub secrets:**
> - `DEV_EC2_HOST` = _____________________

### B.6 — SSH into DEV EC2

```bash
chmod 400 ~/.ssh/nse-keypair.pem
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<DEV_EC2_HOST>
# You should see the Ubuntu welcome message
```

### B.7 — Run the EC2 setup script

From your **local machine** (in the project root):

```bash
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/ec2_setup.sh \
    ubuntu@<DEV_EC2_HOST>:~/
```

Then on EC2:

```bash
bash ~/ec2_setup.sh
# Takes ~10 minutes — installs Python, pip, Nginx, Node.js, Playwright
```

### B.8 — Create directory structure on DEV EC2

Still on the EC2 SSH session:

```bash
# Create app directory
sudo mkdir -p /opt/nse
sudo chown ubuntu:ubuntu /opt/nse

# Create Python virtualenv
python3 -m venv /opt/nse/venv

# Create .env file — this is what tells the app it's the DEV stage
cat > /opt/nse/.env << 'EOF'
STAGE=dev
APP_ENV=development
DEBUG=true
EOF
```

### B.9 — Install Nginx config

From your **local machine**:

```bash
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/nginx.conf \
    ubuntu@<DEV_EC2_HOST>:~/
```

On EC2:

```bash
sudo cp ~/nginx.conf /etc/nginx/sites-available/nse
sudo ln -sf /etc/nginx/sites-available/nse /etc/nginx/sites-enabled/nse
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### B.10 — Install systemd services

From your **local machine**:

```bash
scp -i ~/.ssh/nse-keypair.pem \
    infrastructure/scripts/nse-api.service \
    infrastructure/scripts/nse-worker.service \
    ubuntu@<DEV_EC2_HOST>:~/
```

On EC2:

```bash
sudo cp ~/nse-api.service /etc/systemd/system/
sudo cp ~/nse-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nse-api nse-worker
# Do NOT start yet — there's no backend code here yet
```

### B.11 — Create IAM role for EC2 (allows DynamoDB/S3/SSM access without keys)

From your **local machine** (using the nse-dev profile):

```bash
AWS_PROFILE=nse-dev bash infrastructure/iam/setup_ec2_role.sh
```

Then attach the role to the EC2:

1. AWS Console (nse-dev) → EC2 → select `nse-dev-server`
2. **Actions** → **Security** → **"Modify IAM role"**
3. Select `NSEStockDashboardEC2Role` → **Update IAM role**

### B.12 — Create DynamoDB tables

From your **local machine**:

```bash
AWS_PROFILE=nse-dev STAGE=dev python3 infrastructure/dynamodb/create_tables.py
```

Verify: AWS Console (nse-dev) → DynamoDB → Tables → you should see `users`, `stock_transactions`, `stock_watchlist`, `scraping_jobs`, `scraping_tasks`, `product_data`, and more.

### B.13 — Create S3 buckets

```bash
AWS_PROFILE=nse-dev bash infrastructure/scripts/s3_setup.sh
```

This creates:
- `nse-frontend-<dev-account-id>` — React builds
- `nse-assets-<dev-account-id>` — user avatars

> **Save the frontend bucket name:**
> - `DEV_S3_FRONTEND_BUCKET` = `nse-frontend-<dev-account-id>` = _____________________

### B.14 — Store secrets in SSM Parameter Store

```bash
AWS_PROFILE=nse-dev bash infrastructure/ssm/setup_ssm.sh dev
```

You will be prompted for each value:

| Prompt | What to enter |
|--------|---------------|
| JWT secret | Run: `python3 -c "import secrets; print(secrets.token_hex(32))"` and paste |
| Gmail user | Your Gmail address |
| Gmail app password | Gmail → Security → App passwords → generate one |
| S3 assets bucket | `nse-assets-<dev-account-id>` |
| SNS alerts ARN | Press Enter (skip — fill in after step B.16) |

### B.15 — Create SQS queues

```bash
AWS_PROFILE=nse-dev bash infrastructure/sqs/setup_sqs.sh dev
# The SQS URL is saved to SSM automatically
```

### B.16 — Create SNS alert topic

```bash
AWS_PROFILE=nse-dev bash infrastructure/sns/setup_sns.sh dev your@email.com
```

**Important:** Check your email inbox and click **"Confirm subscription"**. You will not receive alerts until you confirm.

Then re-run SSM setup to save the SNS ARN:

```bash
AWS_PROFILE=nse-dev bash infrastructure/ssm/setup_ssm.sh dev
# When prompted for SNS ARN: paste the ARN printed by the sns script above
# For other prompts: press Enter to keep existing values
```

### B.17 — Create the first admin user

The pipeline will deploy the code, but you need an admin user to log in. Run this **after the first pipeline run** (the code needs to be on EC2 first):

```bash
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<DEV_EC2_HOST>
cd /opt/nse/backend
/opt/nse/venv/bin/python3 - << 'EOF'
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
print("Admin created — login: admin / changeme123")
EOF
```

> **DEV account setup is complete.**

---

## PART C — Set up QC account

> Switch to **nse-qc** account in AWS Console (same method as B.1)

Repeat every step from Part B with these substitutions:

| Part B value | Part C value |
|-------------|-------------|
| `nse-dev-server` (EC2 name) | `nse-qc-server` |
| `STAGE=dev` in .env | `STAGE=qc` |
| `APP_ENV=development` | `APP_ENV=staging` |
| `DEBUG=true` | `DEBUG=false` |
| `--profile nse-dev` | `--profile nse-qc` |
| `nse-dev` (profile name in `aws configure`) | `nse-qc` |

> **Save for GitHub secrets:**
> - `QC_EC2_HOST` = _____________________
> - `QC_AWS_ACCESS_KEY_ID` = _____________________
> - `QC_AWS_SECRET_ACCESS_KEY` = _____________________
> - `QC_S3_FRONTEND_BUCKET` = `nse-frontend-<qc-account-id>` = _____________________

> **QC account setup is complete.**

---

## PART D — Set up PROD account

> Switch to **nse-prod** account in AWS Console

Repeat every step from Part B with these substitutions:

| Part B value | Part D value |
|-------------|-------------|
| `nse-dev-server` (EC2 name) | `nse-prod-server` |
| `STAGE=dev` in .env | `STAGE=prod` |
| `APP_ENV=development` | `APP_ENV=production` |
| `DEBUG=true` | `DEBUG=false` |
| `--profile nse-dev` | `--profile nse-prod` |
| `nse-dev` (profile name in `aws configure`) | `nse-prod` |

> **Save for GitHub secrets:**
> - `EC2_HOST` = _____________________  _(this is the prod EC2 IP)_
> - `AWS_ACCESS_KEY_ID` = _____________________
> - `AWS_SECRET_ACCESS_KEY` = _____________________
> - `S3_FRONTEND_BUCKET` = `nse-frontend-<prod-account-id>` = _____________________

> **PROD account setup is complete.**

---

## PART E — GitHub Secrets and First Deployment

### E.1 — Add all secrets to GitHub

Open your GitHub repo → **Settings** → **Secrets and variables** → **Actions**

Click **"New repository secret"** for each row:

**Shared:**
| Secret name | Value |
|-------------|-------|
| `EC2_SSH_KEY` | Full contents of `~/.ssh/nse-keypair.pem` (open the file, copy everything including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`) |

**DEV account:**
| Secret name | Value |
|-------------|-------|
| `DEV_EC2_HOST` | DEV EC2 Elastic IP (from B.5) |
| `DEV_AWS_ACCESS_KEY_ID` | From B.2 |
| `DEV_AWS_SECRET_ACCESS_KEY` | From B.2 |
| `DEV_S3_FRONTEND_BUCKET` | From B.13 |
| `DEV_API_URL` | `http://<DEV_EC2_HOST>/api/v1` |
| `DEV_SSE_URL` | `http://<DEV_EC2_HOST>` |

**QC account:**
| Secret name | Value |
|-------------|-------|
| `QC_EC2_HOST` | QC EC2 Elastic IP (from Part C) |
| `QC_AWS_ACCESS_KEY_ID` | From Part C |
| `QC_AWS_SECRET_ACCESS_KEY` | From Part C |
| `QC_S3_FRONTEND_BUCKET` | From Part C |
| `QC_API_URL` | `http://<QC_EC2_HOST>/api/v1` |
| `QC_SSE_URL` | `http://<QC_EC2_HOST>` |

**PROD account:**
| Secret name | Value |
|-------------|-------|
| `EC2_HOST` | PROD EC2 Elastic IP (from Part D) |
| `AWS_ACCESS_KEY_ID` | From Part D |
| `AWS_SECRET_ACCESS_KEY` | From Part D |
| `S3_FRONTEND_BUCKET` | From Part D |
| `PROD_API_URL` | `http://<EC2_HOST>/api/v1` |
| `PROD_SSE_URL` | `http://<EC2_HOST>` |

### E.2 — Verify GitHub Environments exist

GitHub repo → **Settings** → **Environments**

You need three environments: `dev`, `qc`, `prod`

If they don't exist:
1. Click **"New environment"** → name: `dev` → no protection → **Configure environment**
2. Repeat for `qc`
3. Click **"New environment"** → name: `prod` → tick **"Required reviewers"** → add your GitHub username → **Save protection rules**

### E.3 — Trigger the first deployment

```bash
# On your local machine (in the project root):
git push origin develop
```

Go to GitHub → **Actions** tab → click **"Deploy Pipeline"** → watch it run.

**What you should see:**
1. Lint & Test — builds 3 frontends (takes ~3 min)
2. Deploy DEV — SSH to DEV EC2, rsync, restart, health check (takes ~3 min)
3. Deploy QC — same on QC EC2 (takes ~3 min)
4. ⏳ Waiting for approval — GitHub sends you an email
5. You click **"Review deployments"** in GitHub → approve `prod`
6. Deploy PROD — runs automatically

### E.4 — Create admin user on each stage

After the first successful pipeline run, SSH into each EC2 and create the admin user (see step B.17). Do this for DEV, QC, and PROD.

### E.5 — Verify everything is working

```bash
# From your local machine, test each stage:
curl http://<DEV_EC2_HOST>/api/v1/health/   # should return {"status":"ok"}
curl http://<QC_EC2_HOST>/api/v1/health/    # should return {"status":"ok"}
curl http://<EC2_HOST>/api/v1/health/       # should return {"status":"ok"}
```

Open the frontend URLs in your browser:
- DEV: `http://nse-frontend-<dev-account-id>.s3-website.ap-south-1.amazonaws.com`
- QC: `http://nse-frontend-<qc-account-id>.s3-website.ap-south-1.amazonaws.com`
- PROD: `http://nse-frontend-<prod-account-id>.s3-website.ap-south-1.amazonaws.com`

Log in with `admin` / `changeme123` → **change the password immediately in Settings**.

---

## Checklist — do this once per account

Use this to track your progress:

### DEV account
- [ ] IAM admin user created, access keys saved
- [ ] AWS CLI profile `nse-dev` configured
- [ ] EC2 launched, Elastic IP assigned, SSH works
- [ ] `ec2_setup.sh` completed
- [ ] `/opt/nse/.env` with `STAGE=dev` created
- [ ] Nginx config installed and active
- [ ] systemd services installed (enabled, not yet started)
- [ ] EC2 IAM role attached
- [ ] DynamoDB tables created
- [ ] S3 buckets created
- [ ] SSM secrets stored (JWT, Gmail, S3 bucket)
- [ ] SQS queue created
- [ ] SNS topic created, subscription email confirmed

### QC account
- [ ] (same checklist as DEV)

### PROD account
- [ ] (same checklist as DEV)

### GitHub
- [ ] All 19 secrets added (EC2_SSH_KEY + 6 per account)
- [ ] Environments `dev`, `qc`, `prod` created
- [ ] `prod` environment has required reviewer set
- [ ] First pipeline run completed successfully
- [ ] Admin user created on each stage

---

## Quick reference — useful commands after setup

```bash
# Switch AWS CLI profile per-account
export AWS_PROFILE=nse-dev   # or nse-qc / nse-prod

# Check DynamoDB tables in an account
aws dynamodb list-tables --region ap-south-1

# Check SSM parameters in an account
aws ssm get-parameters-by-path --path /nse/ --with-decryption --region ap-south-1

# SSH into each stage
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<DEV_EC2_HOST>
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<QC_EC2_HOST>
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<EC2_HOST>

# Check service status on any EC2
sudo systemctl status nse-api nse-worker

# Tail logs
sudo journalctl -u nse-api -f

# Re-run infra setup for one account (e.g. after a change)
AWS_PROFILE=nse-dev STAGE=dev python3 infrastructure/dynamodb/create_tables.py
AWS_PROFILE=nse-dev bash infrastructure/ssm/setup_ssm.sh dev
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Access Denied` when running aws commands | Wrong profile — check `AWS_PROFILE=nse-dev` is set |
| SSH times out | Security group is missing SSH rule from 0.0.0.0/0 |
| Health check fails in pipeline | Service not started — SSH in and check `sudo journalctl -u nse-api -n 50` |
| `ResourceNotFoundException` (DynamoDB) | Tables not created — run `AWS_PROFILE=nse-xxx STAGE=xxx python3 infrastructure/dynamodb/create_tables.py` |
| EC2 role not found | `setup_ec2_role.sh` not run for this account — run it with the correct profile |
| Pipeline uses wrong account | GitHub secret has wrong key — double-check that `DEV_AWS_ACCESS_KEY_ID` belongs to the nse-dev account (not nse-prod) |
