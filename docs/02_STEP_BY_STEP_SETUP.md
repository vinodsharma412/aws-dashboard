# Step-by-Step AWS Setup Guide

## PHASE 1 — AWS Account & IAM

### Step 1.1 — Create Free AWS Account
1. Go to https://aws.amazon.com/free/
2. Click "Create a Free Account"
3. Enter email, password, account name
4. Choose "Personal" account type
5. Enter credit card (required but NOT charged for free tier)
6. Choose "Basic Support" (free)
7. Verify phone number
8. Select region: **Asia Pacific (Mumbai) ap-south-1**

### Step 1.2 — Create IAM Admin User (never use root account)
1. Login to AWS Console → search "IAM" → open IAM
2. Click "Users" → "Create user"
3. Username: `nse-admin`
4. Check "Provide user access to the AWS Management Console"
5. Select "I want to create an IAM user"
6. Set password → Next
7. Click "Attach policies directly"
8. Search and attach: `AdministratorAccess`
9. Click "Create user"
10. **Download the CSV** (access key + secret) — you won't see it again
11. Logout from root, login with `nse-admin`

### Step 1.3 — Install AWS CLI on your machine
```bash
# Ubuntu/Debian
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify
aws --version
```

### Step 1.4 — Configure AWS CLI
```bash
aws configure
# AWS Access Key ID:     [paste from CSV]
# AWS Secret Access Key: [paste from CSV]
# Default region name:   ap-south-1
# Default output format: json
```

---

## PHASE 2 — DynamoDB Tables

### Step 2.1 — Run the table creation script
```bash
cd /home/vinod/Documents/Vinod/aws
python3 infrastructure/dynamodb/create_tables.py
```

This creates all 6 tables. See `infrastructure/dynamodb/create_tables.py`.

### Step 2.2 — Verify in AWS Console
1. Open AWS Console → DynamoDB → Tables
2. You should see: `nse_users`, `nse_stock_transactions`, `nse_stock_watchlist`,
   `nse_scraping_jobs`, `nse_scraping_tasks`, `nse_product_data`

---

## PHASE 3 — S3 Buckets

### Step 3.1 — Run the S3 setup script
```bash
bash infrastructure/scripts/s3_setup.sh
```

This creates:
- `nse-frontend-<your-account-id>` — static website hosting
- `nse-assets-<your-account-id>` — avatar image storage

### Step 3.2 — Note your S3 website URL
After script runs, note the URL:
```
http://nse-frontend-<account-id>.s3-website.ap-south-1.amazonaws.com
```

---

## PHASE 4 — EC2 Instance

### Step 4.1 — Launch EC2 t2.micro
1. AWS Console → EC2 → "Launch Instance"
2. **Name:** `nse-stock-server`
3. **AMI:** Ubuntu Server 22.04 LTS (Free tier eligible)
4. **Instance type:** t2.micro (Free tier eligible)
5. **Key pair:** Click "Create new key pair"
   - Name: `nse-keypair`
   - Type: RSA
   - Format: .pem
   - **Download and save** `nse-keypair.pem` to `~/.ssh/`
6. **Security Group:** Create new
   - Allow SSH (port 22) from My IP
   - Allow HTTP (port 80) from Anywhere
   - Allow HTTPS (port 443) from Anywhere
   - Allow Custom TCP port 9000 from Anywhere (FastAPI during dev)
7. **Storage:** 8 GB gp2 (free tier: 30 GB max)
8. Click "Launch Instance"
9. Wait 2 minutes for it to start

### Step 4.2 — Assign Elastic IP (so IP doesn't change on restart)
1. EC2 → Elastic IPs → "Allocate Elastic IP address" → Allocate
2. Select the new IP → Actions → "Associate Elastic IP"
3. Choose your instance → Associate
4. Note this IP — this is your server's permanent IP

### Step 4.3 — SSH into EC2
```bash
chmod 400 ~/.ssh/nse-keypair.pem
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
```

### Step 4.4 — Run EC2 setup script
```bash
# Copy the setup script to EC2
scp -i ~/.ssh/nse-keypair.pem \
    /home/vinod/Documents/Vinod/aws/infrastructure/scripts/ec2_setup.sh \
    ubuntu@<YOUR-ELASTIC-IP>:~/

# SSH in and run it
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
bash ~/ec2_setup.sh
```

This installs: Python 3.11, pip, virtualenv, Node.js 20, Nginx, Playwright, git.

---

## PHASE 5 — Deploy Backend to EC2

### Step 5.1 — Copy backend code to EC2
```bash
# From your local machine:
scp -i ~/.ssh/nse-keypair.pem -r \
    /home/vinod/Documents/Vinod/aws/backend/ \
    ubuntu@<YOUR-ELASTIC-IP>:~/nse-backend/
```

### Step 5.2 — Create .env on EC2
```bash
ssh -i ~/.ssh/nse-keypair.pem ubuntu@<YOUR-ELASTIC-IP>
cd ~/nse-backend
nano .env
```

Paste (replace values):
```env
APP_NAME=NSE Stock Dashboard
APP_ENV=production
DEBUG=false

SECRET_KEY=your-very-long-random-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# AWS
AWS_REGION=ap-south-1
S3_ASSETS_BUCKET=nse-assets-<your-account-id>

# Optional
GMAIL_USER=
GMAIL_APP_PASSWORD=
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Step 5.3 — Install dependencies and run
```bash
cd ~/nse-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
playwright install-deps chromium

# Test run
uvicorn app.main:app --host 0.0.0.0 --port 9000
```

Test from browser: `http://<YOUR-ELASTIC-IP>:9000/docs`

### Step 5.4 — Configure Nginx reverse proxy
```bash
sudo nano /etc/nginx/sites-available/nse
```

Paste the nginx config from `infrastructure/scripts/nginx.conf`, then:
```bash
sudo ln -s /etc/nginx/sites-available/nse /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5.5 — Set up systemd services
```bash
sudo cp ~/infrastructure/scripts/nse-api.service /etc/systemd/system/
sudo cp ~/infrastructure/scripts/nse-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable nse-api nse-worker
sudo systemctl start nse-api nse-worker
sudo systemctl status nse-api
```

---

## PHASE 6 — Deploy Frontend to S3

### Step 6.1 — Update API URL
Edit `frontend/src/utils/constants.js`:
```javascript
export const API_URL = 'http://<YOUR-ELASTIC-IP>/api/v1';
```

### Step 6.2 — Build React app
```bash
cd /home/vinod/Documents/Vinod/aws/frontend
npm install
npm run build
```

### Step 6.3 — Upload to S3
```bash
aws s3 sync build/ s3://nse-frontend-<account-id>/ --delete
```

### Step 6.4 — Access the app
Open: `http://nse-frontend-<account-id>.s3-website.ap-south-1.amazonaws.com`

---

## PHASE 7 — VS Code Remote Development

### Step 7.1 — Install Remote-SSH extension
1. VS Code → Extensions → search "Remote - SSH"
2. Install "Remote - SSH" by Microsoft

### Step 7.2 — Add SSH host
Press `Ctrl+Shift+P` → "Remote-SSH: Open SSH Configuration File"
Add:
```
Host nse-aws
    HostName <YOUR-ELASTIC-IP>
    User ubuntu
    IdentityFile ~/.ssh/nse-keypair.pem
```

### Step 7.3 — Connect
Press `Ctrl+Shift+P` → "Remote-SSH: Connect to Host" → `nse-aws`

VS Code opens connected to EC2. You can edit files directly on the server.

---

## PHASE 8 — Create First Admin User

```bash
# SSH into EC2, then:
cd ~/nse-backend
source venv/bin/activate
python3 -c "
from app.db.dynamo import dynamo_users
from app.core.security import hash_password
import uuid
dynamo_users.put_item(Item={
    'user_id': str(uuid.uuid4()),
    'username': 'admin',
    'email': 'admin@example.com',
    'full_name': 'Admin User',
    'role': 'admin',
    'hashed_password': hash_password('changeme123'),
    'is_active': True,
    'avatar_url': None,
})
print('Admin user created')
"
```

Login at the frontend URL with `admin` / `changeme123`.

---

## Useful Commands

```bash
# Check API logs
sudo journalctl -u nse-api -f

# Check worker logs
sudo journalctl -u nse-worker -f

# Restart API after code change
sudo systemctl restart nse-api

# Re-deploy frontend
cd /home/vinod/Documents/Vinod/aws/frontend
npm run build
aws s3 sync build/ s3://nse-frontend-<account-id>/ --delete

# SSH shortcut (after VS Code SSH config)
ssh nse-aws

# Check EC2 costs (always free tier check)
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-02-01 \
  --granularity MONTHLY \
  --metrics "BlendedCost"
```
