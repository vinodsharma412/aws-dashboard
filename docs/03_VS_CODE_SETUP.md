# VS Code Setup for AWS Project

## Opening This Project

```bash
code /home/vinod/Documents/Vinod/aws
```

## Recommended VS Code Extensions

Install these from the Extensions panel (`Ctrl+Shift+X`):

| Extension | Publisher | Purpose |
|---|---|---|
| Remote - SSH | Microsoft | Edit files directly on EC2 |
| AWS Toolkit | Amazon Web Services | Browse DynamoDB, S3 from VS Code |
| Python | Microsoft | IntelliSense for backend |
| Pylance | Microsoft | Type checking |
| ESLint | Microsoft | React frontend linting |
| REST Client | Huachao Mao | Test API endpoints (`.http` files) |
| DotENV | mikestead | Syntax highlight `.env` files |

## Remote-SSH: Edit Code on EC2 Directly

### Step 1 — Configure SSH
Edit `~/.ssh/config` (or press `Ctrl+Shift+P` → "Remote-SSH: Open SSH Config"):
```
Host nse-aws
    HostName <YOUR-ELASTIC-IP>
    User ubuntu
    IdentityFile ~/.ssh/nse-keypair.pem
    ServerAliveInterval 30
```

### Step 2 — Connect
- `Ctrl+Shift+P` → "Remote-SSH: Connect to Host" → `nse-aws`
- VS Code opens a new window connected to EC2
- Open folder: `/home/ubuntu/nse-backend`
- You can now edit files, run the terminal, install extensions **on EC2**

### Step 3 — Remote Terminal
- `Ctrl+` ` (backtick) opens terminal **on EC2**
- Run: `sudo journalctl -u nse-api -f` to watch live logs
- Run: `sudo systemctl restart nse-api` after code changes

## AWS Toolkit: Browse DynamoDB & S3

### Connect the Toolkit
1. Click the AWS icon in the left sidebar (after installing AWS Toolkit)
2. Click "Connect to AWS"
3. Select profile: `default` (uses your `~/.aws/credentials`)
4. Select region: `ap-south-1`

### What you can do:
- **DynamoDB** — Browse tables, view/edit items, run queries
- **S3** — Browse buckets, download/upload files, view avatar images
- **EC2** — See instance status, connect to terminal
- **CloudWatch** — View logs from the API service

## Workspace Settings

Create `.vscode/settings.json` in the project root:
```json
{
    "python.defaultInterpreterPath": "${workspaceFolder}/backend/venv/bin/python",
    "python.linting.enabled": true,
    "editor.formatOnSave": true,
    "files.exclude": {
        "**/__pycache__": true,
        "**/*.pyc": true,
        "**/node_modules": true,
        "**/build": true,
        "**/.env": true
    },
    "search.exclude": {
        "**/node_modules": true,
        "**/build": true,
        "**/__pycache__": true
    },
    "remote.SSH.defaultExtensions": [
        "ms-python.python",
        "ms-python.pylance"
    ]
}
```

## Launch Configurations (F5 Debugging)

Create `.vscode/launch.json`:
```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "FastAPI (local)",
            "type": "python",
            "request": "launch",
            "module": "uvicorn",
            "args": ["app.main:app", "--host", "0.0.0.0", "--port", "9000", "--reload"],
            "cwd": "${workspaceFolder}/backend",
            "env": {
                "PYTHONPATH": "${workspaceFolder}/backend"
            },
            "envFile": "${workspaceFolder}/backend/.env",
            "justMyCode": true
        }
    ]
}
```

## Project Folder Structure in VS Code Explorer

```
aws/
├── .vscode/
│   ├── settings.json
│   └── launch.json
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/
│   │   ├── core/           ← security, roles, logging (same as original)
│   │   ├── crud/           ← user_dynamo.py (replaces SQLAlchemy CRUD)
│   │   ├── db/
│   │   │   └── dynamo.py   ← DynamoDB table objects (replaces session.py)
│   │   ├── models/         ← Pydantic models only (no ORM)
│   │   ├── schemas/        ← same as original
│   │   ├── services/
│   │   │   ├── auth_service.py    ← same as original
│   │   │   ├── stock_service.py   ← same as original (yfinance)
│   │   │   ├── sentiment_service.py ← same as original
│   │   │   ├── scraper.py         ← same as original (Playwright)
│   │   │   └── s3_storage.py      ← NEW (replaces local disk)
│   │   ├── config.py       ← AWS version (no DB_HOST, has AWS_REGION)
│   │   └── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/               ← copy from original reactjsfastapi/frontend
├── infrastructure/
│   ├── dynamodb/
│   │   └── create_tables.py
│   ├── iam/
│   │   ├── ec2_policy.json
│   │   └── setup_ec2_role.sh
│   └── scripts/
│       ├── ec2_setup.sh
│       ├── s3_setup.sh
│       ├── nginx.conf
│       ├── nse-api.service
│       └── nse-worker.service
└── docs/
    ├── 01_ARCHITECTURE.md
    ├── 02_STEP_BY_STEP_SETUP.md
    └── 03_VS_CODE_SETUP.md (this file)
```

## Daily Workflow

```bash
# Make a code change locally
# Test locally (needs AWS credentials):
cd /home/vinod/Documents/Vinod/aws/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 9000

# Deploy to EC2:
scp -i ~/.ssh/nse-keypair.pem -r \
    backend/app/services/stock_service.py \
    ubuntu@<IP>:~/nse-backend/app/services/

ssh nse-aws "sudo systemctl restart nse-api"

# Or use Remote-SSH in VS Code — edit directly on EC2, no scp needed
```
