#!/bin/bash
# Run this INSIDE the EC2 instance to install CloudWatch Agent.
# It ships systemd journal logs to CloudWatch log groups.
# Usage: bash install_agent_on_ec2.sh

set -e

REGION="ap-south-1"

echo "[1/4] Installing CloudWatch Agent..."
wget -q https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i amazon-cloudwatch-agent.deb
rm amazon-cloudwatch-agent.deb
echo "  Installed."

echo "[2/4] Writing agent config..."
sudo mkdir -p /opt/aws/amazon-cloudwatch-agent/etc/

sudo tee /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json > /dev/null << 'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/syslog",
            "log_group_name": "/nse/api",
            "log_stream_name": "{instance_id}/syslog",
            "timezone": "UTC"
          }
        ]
      },
      "journald": {
        "collect_list": [
          {
            "log_group_name": "/nse/api",
            "log_stream_name": "{instance_id}/nse-api",
            "units": ["nse-api.service"]
          },
          {
            "log_group_name": "/nse/worker",
            "log_stream_name": "{instance_id}/nse-worker",
            "units": ["nse-worker.service"]
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "NSE/EC2",
    "metrics_collected": {
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": ["disk_used_percent"],
        "resources": ["/"],
        "metrics_collection_interval": 300
      }
    }
  }
}
EOF

echo "[3/4] Starting CloudWatch Agent..."
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo "[4/4] Enabling on boot..."
sudo systemctl enable amazon-cloudwatch-agent

echo ""
echo "CloudWatch Agent running!"
echo ""
echo "Logs will appear in AWS Console:"
echo "  CloudWatch → Log groups → /nse/api"
echo "  CloudWatch → Log groups → /nse/worker"
echo ""
echo "Custom metrics (memory/disk) in namespace: NSE/EC2"
echo "  CloudWatch → Metrics → Custom namespaces → NSE/EC2"
