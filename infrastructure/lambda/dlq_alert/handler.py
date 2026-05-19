"""Lambda function — Dead Letter Queue alert → SNS email.

Triggered by:  SQS DLQ  (nse-scraping-jobs-{stage}-dlq)
Publishes to:  SNS       (nse-alerts-{stage})

When a scraping task fails 3 times (maxReceiveCount), SQS automatically
moves the message to the DLQ.  This Lambda is triggered by that event and
publishes a formatted alert email so the operator knows which ASIN failed
and why.

Architecture::

    SQS DLQ
      │  (event source mapping — Lambda triggered automatically)
      ▼
    Lambda: nse-dlq-alert-{stage}
      │  reads DynamoDB for task details (error message, ASIN, job_id)
      │  formats human-readable alert
      ▼
    SNS: nse-alerts-{stage}
      ▼
    Email → admin inbox

Deploy:
    cd infrastructure/lambda/dlq_alert
    zip handler.zip handler.py
    aws lambda create-function \
      --function-name nse-dlq-alert-prod \
      --runtime python3.12 \
      --handler handler.lambda_handler \
      --zip-file fileb://handler.zip \
      --role arn:aws:iam::<ACCOUNT>:role/NSELambdaRole \
      --timeout 30 \
      --memory-size 128 \
      --environment Variables="{STAGE=prod}" \
      --region ap-south-1

Wire to SQS DLQ:
    aws lambda create-event-source-mapping \
      --function-name nse-dlq-alert-prod \
      --event-source-arn <DLQ_ARN> \
      --batch-size 1 \
      --region ap-south-1
"""

import json
import logging
import os
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-south-1")
STAGE = os.environ.get("STAGE", "prod")

# Table prefix matches EC2 app: "" for prod, "dev_" for dev, "qc_" for qc
TABLE_PREFIX = "" if STAGE == "prod" else f"{STAGE}_"

_dynamo = boto3.resource("dynamodb", region_name=REGION)
_tasks_table = _dynamo.Table(f"{TABLE_PREFIX}scraping_tasks")
_jobs_table = _dynamo.Table(f"{TABLE_PREFIX}scraping_jobs")

_ssm = boto3.client("ssm", region_name=REGION)
_sns = boto3.client("sns", region_name=REGION)


def _get_sns_arn() -> str:
    """Read SNS topic ARN from SSM Parameter Store.

    Returns:
        SNS topic ARN string, or empty string if not found.
    """
    try:
        resp = _ssm.get_parameter(Name=f"/nse/{STAGE}/sns-alerts-arn")
        return resp["Parameter"]["Value"]
    except Exception as exc:
        logger.error("Could not read SNS ARN from SSM: %s", exc)
        return ""


def _get_task_details(task_id: str) -> dict:
    """Fetch task details from DynamoDB for the alert message.

    Args:
        task_id: UUID of the failed scraping task.

    Returns:
        Task dict from DynamoDB, or empty dict if not found.
    """
    try:
        resp = _tasks_table.get_item(Key={"task_id": task_id})
        return resp.get("Item", {})
    except Exception as exc:
        logger.warning("Could not fetch task %s: %s", task_id, exc)
        return {}


def _format_alert(task_id: str, task: dict, receive_count: int) -> dict:
    """Build a formatted SNS alert message for a permanently failed task.

    Args:
        task_id: UUID of the failed task.
        task: DynamoDB task record (may be empty if lookup failed).
        receive_count: Number of times SQS attempted delivery.

    Returns:
        Dict with ``Subject`` and ``Message`` keys for SNS publish.
    """
    asin = task.get("asin", "UNKNOWN")
    job_id = task.get("job_id", "unknown")
    error = task.get("error", "No error details available")
    status = task.get("status", "unknown")
    queued_at = task.get("queued_at", "unknown")

    subject = f"[NSE {STAGE.upper()}] Scraper job permanently failed — ASIN {asin}"

    message = f"""
NSE Stock Dashboard — Scraping Job Failure Alert
Stage: {STAGE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task ID:       {task_id}
Job ID:        {job_id}
ASIN:          {asin}
Status:        {status}
Queued at:     {queued_at}
SQS attempts:  {receive_count} (max 3 reached → moved to DLQ)

Error:
{error}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
What to check:
  1. Amazon.in may have added CAPTCHA for this ASIN
  2. Playwright / Chromium version compatibility
  3. EC2 memory/CPU pressure during scrape
  4. Network connectivity from EC2 to Amazon.in

DLQ Console:
  https://{REGION}.console.aws.amazon.com/sqs/v2/home?region={REGION}#/queues
  Queue: nse-scraping-jobs-{STAGE}-dlq

Time: {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
""".strip()

    return {"Subject": subject[:100], "Message": message}


def lambda_handler(event: dict, context) -> dict:
    """Process DLQ messages and send SNS alerts for each failed task.

    Triggered automatically by SQS when the DLQ receives messages.
    Processes up to ``batch_size`` (1 by default) records per invocation.

    Args:
        event: SQS event with ``Records`` list from the DLQ trigger.
        context: Lambda context object (unused).

    Returns:
        Dict with ``statusCode`` and count of alerts sent.
    """
    records = event.get("Records", [])
    logger.info("DLQ alert handler: %d records", len(records))

    sns_arn = _get_sns_arn()
    if not sns_arn:
        logger.error("SNS ARN not configured — alerts will not be sent")
        return {"statusCode": 500, "body": "SNS ARN not configured"}

    alerts_sent = 0
    for record in records:
        try:
            body = json.loads(record.get("Body", "{}"))
            task_id = body.get("task_id", "")
            receive_count = int(
                record.get("attributes", {}).get("ApproximateReceiveCount", 3)
            )

            logger.info("Processing DLQ message: task_id=%s, attempts=%d", task_id, receive_count)

            task = _get_task_details(task_id) if task_id else {}
            alert = _format_alert(task_id, task, receive_count)

            _sns.publish(
                TopicArn=sns_arn,
                Subject=alert["Subject"],
                Message=alert["Message"],
            )
            alerts_sent += 1
            logger.info("Alert sent for task_id=%s asin=%s", task_id, task.get("asin"))

        except Exception as exc:
            logger.error("Failed to process DLQ record: %s | error: %s", record, exc)

    return {
        "statusCode": 200,
        "body": json.dumps({"alerts_sent": alerts_sent, "records_processed": len(records)}),
    }
