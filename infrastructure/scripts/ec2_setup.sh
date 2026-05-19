#!/bin/bash
# EC2 Ubuntu 22.04 — first-boot setup for NSE Stock Dashboard.
# Run ONCE inside the EC2 instance after SSH login.
#
# Usage:
#   bash ec2_setup.sh
#
# What it does:
#   1. Installs system packages (Python 3.12, Nginx, Playwright deps)
#   2. Installs AWS CLI v2
#   3. Creates /opt/nse (prod), /opt/nse-dev, /opt/nse-qc directories
#   4. Creates a Python virtualenv in each directory
#   5. Installs Playwright Chromium
#   6. Configures Nginx reverse proxy (all stages on the same EC2)
#
# Ports:
#   prod  → 9000  (Nginx proxies / → :9000)
#   dev   → 9001  (Nginx proxies /dev/ → :9001)
#   qc    → 9002  (Nginx proxies /qc/  → :9002)

set -e

echo "========================================="
echo " NSE Stock Dashboard — EC2 Setup"
echo "========================================="

# ── 1. System updates ──────────────────────────────────────────────────────────
echo "[1/8] Updating system packages..."
sudo apt-get update -y -qq
sudo apt-get upgrade -y -qq
sudo apt-get install -y -qq \
  build-essential curl git unzip \
  python3 python3-venv python3-pip \
  nginx \
  fonts-liberation libatk-bridge2.0-0 libatk1.0-0 \
  libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 \
  libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 \
  libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
  libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
  libxrandr2 libxshmfence1 xdg-utils
echo "  ✓ System packages installed"

# ── 2. AWS CLI ─────────────────────────────────────────────────────────────────
echo "[2/8] Installing AWS CLI v2..."
if ! command -v aws &>/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp/
  sudo /tmp/aws/install
  rm -rf /tmp/awscliv2.zip /tmp/aws/
fi
aws --version
echo "  ✓ AWS CLI ready"

# ── 3. Directory structure ─────────────────────────────────────────────────────
echo "[3/8] Creating app directories..."

for stage_dir in /opt/nse /opt/nse-dev /opt/nse-qc; do
  sudo mkdir -p "$stage_dir"
  sudo chown ubuntu:ubuntu "$stage_dir"
done

# Each stage directory has:  backend/  venv/  logs/
for stage_dir in /opt/nse /opt/nse-dev /opt/nse-qc; do
  mkdir -p "$stage_dir/backend" "$stage_dir/logs"
done

echo "  ✓ Directories: /opt/nse  /opt/nse-dev  /opt/nse-qc"

# ── 4. Python virtual environments ────────────────────────────────────────────
echo "[4/8] Creating Python virtual environments..."

for stage_dir in /opt/nse /opt/nse-dev /opt/nse-qc; do
  if [ ! -d "$stage_dir/venv" ]; then
    python3 -m venv "$stage_dir/venv"
    "$stage_dir/venv/bin/pip" install --upgrade pip wheel -q
    echo "  ✓ venv created: $stage_dir/venv"
  else
    echo "  ✓ venv exists:  $stage_dir/venv (skipped)"
  fi
done

# ── 5. Playwright ──────────────────────────────────────────────────────────────
echo "[5/8] Installing Playwright + Chromium (worker only, prod venv)..."
# Only the prod worker needs Playwright — dev/qc workers share the same binary.
/opt/nse/venv/bin/pip install playwright -q
/opt/nse/venv/bin/playwright install chromium
/opt/nse/venv/bin/playwright install-deps chromium

# Install playwright in dev/qc venvs as well (same binary, no extra download)
/opt/nse-dev/venv/bin/pip install playwright -q
/opt/nse-qc/venv/bin/pip install playwright -q
echo "  ✓ Playwright installed"

# ── 6. Nginx configuration ─────────────────────────────────────────────────────
echo "[6/8] Configuring Nginx..."
sudo cp "$(dirname "$0")/nginx.conf" /etc/nginx/sites-available/nse
sudo ln -sf /etc/nginx/sites-available/nse /etc/nginx/sites-enabled/nse
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx
echo "  ✓ Nginx configured"

# ── 7. Systemd services ────────────────────────────────────────────────────────
echo "[7/8] Installing systemd service files..."
SCRIPT_DIR="$(dirname "$0")"

for svc in nse-api nse-worker nse-api-dev nse-worker-dev nse-api-qc nse-worker-qc; do
  src="$SCRIPT_DIR/${svc}.service"
  if [ -f "$src" ]; then
    sudo cp "$src" "/etc/systemd/system/${svc}.service"
    echo "  ✓ Installed: ${svc}.service"
  else
    echo "  ⚠  Missing service file: ${svc}.service (copy manually)"
  fi
done

sudo systemctl daemon-reload

# Enable prod services (dev/qc are optional — enable when needed)
sudo systemctl enable nse-api nse-worker
echo "  ✓ Prod services enabled (dev/qc: enable manually when needed)"

# ── 8. Log directories ─────────────────────────────────────────────────────────
echo "[8/8] Creating log directories..."
sudo mkdir -p /var/log/nse
sudo chown ubuntu:ubuntu /var/log/nse
echo "  ✓ Log directory: /var/log/nse"

echo ""
echo "========================================="
echo " EC2 setup complete!"
echo ""
echo " Next steps:"
echo " 1. Deploy backend code:"
echo "    make deploy             (prod)"
echo "    make deploy STAGE=dev   (dev)"
echo "    make deploy STAGE=qc    (qc)"
echo ""
echo " 2. Create .env in each stage directory:"
echo "    nano /opt/nse/backend/.env           (STAGE=prod)"
echo "    nano /opt/nse-dev/backend/.env       (STAGE=dev)"
echo "    nano /opt/nse-qc/backend/.env        (STAGE=qc)"
echo ""
echo " 3. Start prod services:"
echo "    sudo systemctl start nse-api nse-worker"
echo "    sudo journalctl -u nse-api -f"
echo "========================================="
