# Step-by-Step Setup Guide — Two AWS Accounts

> One staging account, one prod account. Each has its own EC2, DynamoDB, S3, SQS, and SNS.
> Follow these steps **twice** — once for staging, once for prod.

---

## Overview

```
PART A — Do once (AWS Organization)
  STEP 1   Create two AWS accounts (staging + prod)       (~15 min)

PART B — Do for STAGING account, then repeat for PROD account
  STEP 2   IAM user + AWS CLI                             (~10 min)
  STEP 3   EC2 instance + Elastic IP                      (~10 min)
  STEP 4   EC2 software setup                             (~15 min)
  STEP 5   DynamoDB tables                                ( ~5 min)
  STEP 6   SSM secrets                                    ( ~5 min)
  STEP 7   SQS queues + SNS alerts                        ( ~5 min)
  STEP 8   S3 buckets                                     ( ~5 min)

PART C — Do once (GitHub)
  STEP 9   GitHub secrets + environments + first deploy   (~10 min)
  STEP 10  Create admin users                             ( ~5 min)
  STEP 11  Smoke tests                                    ( ~5 min)
```

Total: ~2 hours (1 hour per account + 30 min GitHub setup).

---

## PART A — AWS Organization (one-time)

### STEP 1 — Create Two AWS Accounts

You need two accounts: one for staging, one for prod.

**Option A — AWS Organizations (recommended, one billing)**

1. Sign in to your existing AWS account (this becomes the management account)
2. AWS Console → search **Organizations** → **Create organization**
3. **Add an AWS account** → **Create an AWS account**
   - Account name: `nse-staging`
   - Email: use a `+` alias, e.g. `yourname+nse-staging@gmail.com`
4. Repeat → **Create an AWS account**
   - Account name: `nse-prod`
   - Email: `yourname+nse-prod@gmail.com`
5. Both accounts are ready in ~2 minutes each

**Option B — Two separate AWS accounts**

1. [aws.amazon.com/free](https://aws.amazon.com/free) → create account with `yourname+nse-staging@gmail.com`
2. Repeat with `yourname+nse-prod@gmail.com`

> Both accounts are free — t2.micro EC2 + DynamoDB stay within free tier.

---

## PART B — Repeat STEP 2–8 for each account

> Do staging first, then repeat for prod.
> Only difference: use `STAGE=staging` for staging, `STAGE=prod` for prod.

---

### STEP 2 — IAM User + AWS CLI

#### 2.1 Sign in to the account

- Organizations: AWS Console → top-right account menu → **Switch role** → select `nse-staging`
- Separate account: sign in with that account's root email

#### 2.2 Create an IAM admin user

Never use root for daily work.

1. AWS Console → **IAM** → **Users** → **Create user**
2. Username: `nse-admin`
3. Check **"Provide user access to the AWS Management Console"**
4. Select **"I want to create an IAM user"** → set a password
5. Attach policy: **AdministratorAccess**
6. **Create user**

Create access keys:
1. IAM → Users → `nse-admin` → **Security credentials** → **Create access key**
2. Use case: **Command Line Interface (CLI)**
3. **Download CSV** — you cannot view the secret again

#### 2.3 Configure AWS CLI profile

```bash
# Staging account:
aws configure --profile nse-staging
# AWS Access Key ID:     paste from CSV
# AWS Secret Access Key: paste from CSV
# Default region:        ap-south-1
# Default output:        json

# Verify
aws sts get-caller-identity --profile nse-staging
# → should print the staging account ID

# Prod account (after repeating these steps for prod):
aws configure --profile nse-prod
aws sts get-caller-identity --profile nse-prod
```

> Activate a profile for a terminal session to avoid typing `--profile` every time:
> ```bash
> export AWS_PROFILE=nse-staging
> export AWS_PROFILE=nse-prod    # to switch
> ```

---

### STEP 3 — EC2 Instance

#### 3.1 Launch EC2

AWS Console → **EC2** → **Launch instance**

| Setting | Value |
|---------|-------|
| Name | `nse-server` |
| AMI | Ubuntu Server 22.04 LTS (Free tier eligible) |
| Instance type | `t2.micro` (Free tier eligible) |
| Key pair | Create new → Name: `nse-keypair`, RSA, .pem → **Download** |
| Security group | New group: SSH port 22 from `0.0.0.0/0`, HTTP port 80 from `0.0.0.0/0` |
| Storage | 20 GB gp3 |

Click **Launch instance**.

Save the key file:
```bash
mv ~/Downloads/nse-keypair.pem ~/.ssh/nse-keypair-staging.pem   # for staging
mv ~/Downloads/nse-keypair.pem ~/.ssh/nse-keypair-prod.pem      # for prod
chmod 400 ~/.ssh/nse-keypair-staging.pem
chmod 400 ~/.ssh/nse-keypair-prod.pem
```

#### 3.2 Assign Elastic IP (prevents IP change on restart)

1. EC2 → **Elastic IPs** → **Allocate Elastic IP** → Allocate
2. Select new IP → **Actions** → **Associate** → choose `nse-server` → Associate
3. **Copy this IP** — needed for GitHub secrets

#### 3.3 Verify SSH

```bash
ssh -i ~/.ssh/nse-keypair-staging.pem ubuntu@<ELASTIC-IP>
# Should show Ubuntu prompt. Type exit when done.
```

---

### STEP 4 — EC2 Software Setup

#### 4.1 Copy setup files to EC2

From your local machine (project root):

```bash
# Replace <IP> and key filename for each account
scp -i ~/.ssh/nse-keypair-staging.pem \
    infrastructure/scripts/ec2_setup.sh \
    infrastructure/scripts/nginx.conf \
    infrastructure/scripts/nse-api.service \
    infrastructure/scripts/nse-worker.service \
    ubuntu@<IP>:~/
```

#### 4.2 Run the setup script on EC2

```bash
ssh -i ~/.ssh/nse-keypair-staging.pem ubuntu@<IP>
bash ~/ec2_setup.sh
# Takes ~10 minutes
# Installs: Python 3.12, pip, Nginx, Playwright, AWS CLI v2
# Creates: /opt/nse/ with venv, systemd services enabled
```

#### 4.3 Create the stage .env file on EC2

```bash
# On the staging EC2:
cat > /opt/nse/.env << 'EOF'
STAGE=staging
APP_ENV=staging
DEBUG=false
EOF

# On the prod EC2:
cat > /opt/nse/.env << 'EOF'
STAGE=prod
APP_ENV=production
DEBUG=false
EOF
```

#### 4.4 Attach IAM role to EC2

The EC2 needs permission to read DynamoDB, S3, and SSM without hardcoded keys.

```bash
# From local machine (activate correct profile first):
export AWS_PROFILE=nse-staging
bash infrastructure/iam/setup_ec2_role.sh
```

Then in AWS Console:
1. EC2 → select `nse-server` → **Actions** → **Security** → **Modify IAM role**
2. Select `NSEStockDashboardEC2Role` → **Update IAM role**

---

### STEP 5 — DynamoDB Tables

```bash
# Staging account (creates 13 tables with clean names: users, scraping_jobs, ...):
AWS_PROFILE=nse-staging STAGE=staging python3 infrastructure/dynamodb/create_tables.py

# Prod account (same table names, different account):
AWS_PROFILE=nse-prod STAGE=prod python3 infrastructure/dynamodb/create_tables.py
```

Verify in AWS Console → **DynamoDB** → **Tables** — you should see 13 tables:

```
users                 scraping_jobs         menus
stock_transactions    scraping_tasks        menu_access
stock_watchlist       product_data          email_messages
screener_cache        product_master        email_sync_state
                      word_suggestions
```

No prefixes — accounts are isolated so both have identical clean names.

---

### STEP 6 — SSM Secrets

```bash
# Staging account:
export AWS_PROFILE=nse-staging
bash infrastructure/ssm/setup_ssm.sh staging

# Prod account:
export AWS_PROFILE=nse-prod
bash infrastructure/ssm/setup_ssm.sh prod
```

**What to enter at each prompt:**

| Prompt | Value |
|--------|-------|
| JWT secret | Press **Enter** to auto-generate |
| Gmail user | Your Gmail address (for alert emails) |
| Gmail app password | Gmail → Security → App passwords → generate one |
| SQS queue URL | Press **Enter** for now — fill in after STEP 7 |
| SNS alerts ARN | Press **Enter** for now — fill in after STEP 7 |
| S3 assets bucket | Press **Enter** for now — fill in after STEP 8 |
| Service account password | Any password (used by Lambda) |

---

### STEP 7 — SQS Queues + SNS Alerts

```bash
# Staging account:
export AWS_PROFILE=nse-staging
bash infrastructure/sqs/setup_sqs.sh staging
bash infrastructure/sns/setup_sns.sh staging your@email.com

# Prod account:
export AWS_PROFILE=nse-prod
bash infrastructure/sqs/setup_sqs.sh prod
bash infrastructure/sns/setup_sns.sh prod your@email.com
```

**What gets created:**

| Account | SQS main queue | SQS dead-letter queue | SNS topic |
|---------|---------------|----------------------|-----------|
| Staging | `nse-scraping-jobs-staging` | `nse-scraping-jobs-staging-dlq` | `nse-alerts-staging` |
| Prod | `nse-scraping-jobs` | `nse-scraping-jobs-dlq` | `nse-alerts` |

> Check email and click **Confirm subscription** for both SNS topics. Alerts won't arrive until confirmed.

Now update SSM with SQS URL and SNS ARN (the scripts printed them):

```bash
# Re-run SSM setup — enter SQS URL and SNS ARN when prompted,
# press Enter to keep all other values unchanged

export AWS_PROFILE=nse-staging
bash infrastructure/ssm/setup_ssm.sh staging

export AWS_PROFILE=nse-prod
bash infrastructure/ssm/setup_ssm.sh prod
```

---

### STEP 8 — S3 Buckets

```bash
# Staging account:
export AWS_PROFILE=nse-staging
bash infrastructure/scripts/s3_setup.sh
# Creates: nse-frontend-<staging-account-id>
#          nse-assets-<staging-account-id>

# Prod account:
export AWS_PROFILE=nse-prod
bash infrastructure/scripts/s3_setup.sh
# Creates: nse-frontend-<prod-account-id>
#          nse-assets-<prod-account-id>
```

Note both `nse-assets-*` bucket names, then update SSM:

```bash
export AWS_PROFILE=nse-staging
bash infrastructure/ssm/setup_ssm.sh staging
# At "S3 assets bucket": enter  nse-assets-<staging-account-id>
# Press Enter for all others

export AWS_PROFILE=nse-prod
bash infrastructure/ssm/setup_ssm.sh prod
# At "S3 assets bucket": enter  nse-assets-<prod-account-id>
```

---

## PART C — GitHub (one-time)

### STEP 9 — GitHub Secrets + Pipeline

#### 9.1 Add secrets

GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add all 14 secrets:

**Staging (7 secrets):**

| Secret | Value |
|--------|-------|
| `STAGING_EC2_HOST` | Staging EC2 Elastic IP |
| `STAGING_EC2_SSH_KEY` | Full contents of `~/.ssh/nse-keypair-staging.pem` |
| `STAGING_AWS_ACCESS_KEY_ID` | Staging IAM access key (from CSV) |
| `STAGING_AWS_SECRET_ACCESS_KEY` | Staging IAM secret key (from CSV) |
| `STAGING_S3_FRONTEND_BUCKET` | `nse-frontend-<staging-account-id>` |
| `STAGING_API_URL` | `http://<STAGING_EC2_HOST>/api/v1` |
| `STAGING_SSE_URL` | `http://<STAGING_EC2_HOST>` |

**Prod (7 secrets):**

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Prod EC2 Elastic IP |
| `EC2_SSH_KEY` | Full contents of `~/.ssh/nse-keypair-prod.pem` |
| `AWS_ACCESS_KEY_ID` | Prod IAM access key (from CSV) |
| `AWS_SECRET_ACCESS_KEY` | Prod IAM secret key (from CSV) |
| `S3_FRONTEND_BUCKET` | `nse-frontend-<prod-account-id>` |
| `PROD_API_URL` | `http://<EC2_HOST>/api/v1` |
| `PROD_SSE_URL` | `http://<EC2_HOST>` |

> **How to copy the SSH key correctly:**
> ```bash
> cat ~/.ssh/nse-keypair-staging.pem
> # Select ALL output including:
> #   -----BEGIN RSA PRIVATE KEY-----
> #   ... lines ...
> #   -----END RSA PRIVATE KEY-----
> # Paste the entire thing into the GitHub secret value
> ```

#### 9.2 Create GitHub Environments

GitHub repo → **Settings** → **Environments**

1. **New environment** → name: `staging` → no protection rules → Save
2. **New environment** → name: `prod` → **Required reviewers** → add your GitHub username → **Save protection rules**

#### 9.3 Trigger first deployment

The project uses two separate workflow files:

- **ci.yml** — triggers on `develop` push or PR to `main`. Runs lint (ruff), bandit security scan, pip-audit dependency audit, npm audit, and frontend build check. **No deployment.**
- **deploy.yml** — triggers on `main` push only. Runs the full quality gate, then deploys staging → smoke tests → deploys prod (with manual approval).

To trigger the first full deployment, merge develop into main:

```bash
git checkout main
git merge develop
git push origin main
```

GitHub → **Actions** → watch **Deploy Pipeline** run.

**Expected flow:**

```
Step 1  Quality Gate     ~5 min   ruff + bandit + pip-audit + npm audit + frontend build check
Step 2  Deploy STAGING   ~3 min   rsync to staging EC2, restart services, health check, S3 upload
Step 3  Smoke Tests      ~2 min   10 API tests via test_staging.sh (all must pass)
Step 4  Waiting          ---      GitHub emails you: "Deployment review required"
Step 5  You approve:     GitHub → Actions → latest run → "Review deployments" → tick prod → Approve
Step 6  Deploy PROD      ~3 min   rsync to prod EC2, restart services, health check, S3 upload
```

**If any step fails** — all later steps are skipped. Check the failing step's logs in GitHub Actions.

For daily development work, push to `develop`. This triggers **ci.yml** only (lint + build checks, no deployment). Merge to `main` when ready to deploy.

---

### STEP 10 — Create Admin Users

After first successful deployment, SSH into each EC2 and create the admin user.

```bash
# ── STAGING admin ──────────────────────────────────────────────
ssh -i ~/.ssh/nse-keypair-staging.pem ubuntu@<STAGING-IP>

cd /opt/nse/backend
/opt/nse/venv/bin/python3 -c "
from app.crud.user_dynamo import create
user = create(username='admin', email='admin@example.com', full_name='Admin', role='admin', password='YOUR_PASSWORD')
print('Created:', user['user_id'])
"
exit

# ── PROD admin ─────────────────────────────────────────────────
ssh -i ~/.ssh/nse-keypair-prod.pem ubuntu@<PROD-IP>

cd /opt/nse/backend
/opt/nse/venv/bin/python3 -c "
from app.crud.user_dynamo import create
user = create(username='admin', email='admin@example.com', full_name='Admin', role='admin', password='YOUR_PASSWORD')
print('Created:', user['user_id'])
"
exit
```

**Change the default password immediately** after first login (Settings page).

---

### STEP 11 — Run Smoke Tests

After both accounts are deployed and admin users are created, run the automated smoke tests to verify everything is working end-to-end.

```bash
# Test staging (10 API checks)
make test-staging EC2_HOST=52.86.192.196

# Test prod (same checks against prod)
make test-prod EC2_HOST=3.6.181.22
```

This runs `infrastructure/scripts/test_staging.sh` and verifies:

| # | Check | What it verifies |
|---|-------|-----------------|
| 1 | Health endpoint | Service is up and reachable |
| 2 | Login → JWT token | Auth flow works end-to-end |
| 3 | Stock analysis (RELIANCE.NS) | yfinance + calculation pipeline |
| 4 | Global markets | Nifty/Sensex data endpoint |
| 5 | Screener endpoint | List returns correctly |
| 6 | Get own user profile | JWT auth on protected endpoint |
| 7 | Menu list | Menu data accessible |
| 8 | Create scraping job | SQS enqueue works |
| 9 | List scraping jobs | DynamoDB query works |
| 10 | Invalid token → 401 | Auth rejection working |

All 10 must pass before the system is considered healthy.

---

## Verify Everything Works

```bash
# Health checks
curl http://52.86.192.196/api/v1/health/   # → {"status":"ok","stage":"staging"}
curl http://3.6.181.22/api/v1/health/      # → {"status":"ok","stage":"prod"}

# Frontend URLs
# Staging: http://nse-frontend-472353356905.s3-website.ap-south-1.amazonaws.com
# Prod:    http://nse-frontend-019711414477.s3-website.ap-south-1.amazonaws.com

# Automated smoke tests
make test-staging EC2_HOST=52.86.192.196
make test-prod    EC2_HOST=3.6.181.22
```

---

## What Each Account Contains (Summary)

```
nse-staging account                    nse-prod account
───────────────────────────────────    ──────────────────────────────────
EC2  t2.micro  Ubuntu 22.04            EC2  t2.micro  Ubuntu 22.04
  /opt/nse/.env  →  STAGE=staging        /opt/nse/.env  →  STAGE=prod
  FastAPI port 9000                      FastAPI port 9000
  Nginx  /api/ → :9000                   Nginx  /api/ → :9000

DynamoDB  (13 tables, no prefix)       DynamoDB  (13 tables, no prefix)
  users, stock_transactions, ...         users, stock_transactions, ...

SQS                                    SQS
  nse-scraping-jobs-staging              nse-scraping-jobs
  nse-scraping-jobs-staging-dlq          nse-scraping-jobs-dlq

SNS                                    SNS
  nse-alerts-staging                     nse-alerts

SSM Parameter Store                    SSM Parameter Store
  /nse/staging/jwt-secret                /nse/prod/jwt-secret
  /nse/staging/sqs-jobs-url              /nse/prod/sqs-jobs-url
  /nse/staging/...                       /nse/prod/...

S3                                     S3
  nse-frontend-<staging-id>/             nse-frontend-<prod-id>/
  nse-assets-<staging-id>/               nse-assets-<prod-id>/
```

---

## Ongoing Operations

```bash
# Tail logs
make logs EC2_HOST=<STAGING-IP>          # staging API logs
make logs EC2_HOST=<PROD-IP>             # prod API logs
make logs-worker EC2_HOST=<STAGING-IP>   # staging worker logs

# Restart services
make restart EC2_HOST=<STAGING-IP>
make restart EC2_HOST=<PROD-IP>

# Manual deploy (without CI/CD)
make deploy EC2_HOST=<STAGING-IP>
make deploy EC2_HOST=<PROD-IP>

# Health check
make health EC2_HOST=<STAGING-IP>
make health EC2_HOST=<PROD-IP>
```
