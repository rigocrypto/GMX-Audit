import nodemailer from "nodemailer";

export type BillingAlertLevel = "info" | "warning" | "critical";

export type BillingAlert = {
  title: string;
  level: BillingAlertLevel;
  source: "billing-webhook" | "billing-health" | "billing-summary";
  message: string;
  details?: Record<string, unknown>;
  timestamp?: string;
};

export type BillingAlertNotifier = (alert: BillingAlert) => Promise<void>;

function toList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildText(alert: BillingAlert): string {
  const ts = alert.timestamp ?? new Date().toISOString();
  const details = alert.details ? `\n${JSON.stringify(alert.details)}` : "";
  return `[${alert.level.toUpperCase()}] ${alert.title}\nsource=${alert.source}\ntime=${ts}\n${alert.message}${details}`;
}

async function postWebhook(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    // Slack uses text, Discord uses content. Including both keeps setup simple.
    body: JSON.stringify({ text, content: text })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`webhook_post_failed status=${response.status} body=${body.slice(0, 300)}`);
  }
}

export function createBillingAlertNotifierFromEnv(): BillingAlertNotifier {
  const webhookUrl = process.env.BILLING_ALERT_WEBHOOK_URL?.trim();
  const emailTo = toList(process.env.BILLING_ALERT_EMAIL_TO);
  const emailFrom = process.env.BILLING_ALERT_EMAIL_FROM?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = Number.parseInt(process.env.SMTP_PORT || "587", 10);
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS;

  const hasEmailConfig = Boolean(emailFrom && smtpHost && Number.isFinite(smtpPort) && emailTo.length > 0);
  const transporter = hasEmailConfig
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
      })
    : undefined;

  return async (alert: BillingAlert): Promise<void> => {
    const text = buildText(alert);
    const tasks: Array<Promise<unknown>> = [];

    if (webhookUrl) {
      tasks.push(postWebhook(webhookUrl, text));
    }

    if (transporter && emailFrom && emailTo.length > 0) {
      tasks.push(
        transporter.sendMail({
          from: emailFrom,
          to: emailTo.join(", "),
          subject: `[billing][${alert.level}] ${alert.title}`,
          text
        })
      );
    }

    if (tasks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[billing:alerts] failed to send alert", {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          title: alert.title,
          level: alert.level
        });
      }
    }
  };
}