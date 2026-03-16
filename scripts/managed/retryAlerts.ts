import fs from "fs";
import path from "path";

type DeadLetter = {
  timestamp: string;
  clientId: string;
  runId: string;
  webhookEnvName: string;
  payload: { text: string };
  attempts: number;
};

function findDeadLetters(): Array<{ filePath: string; letter: DeadLetter }> {
  const base = path.join(process.cwd(), "outputs", "managed");
  const results: Array<{ filePath: string; letter: DeadLetter }> = [];

  if (!fs.existsSync(base)) return results;

  for (const clientId of fs.readdirSync(base)) {
    const clientDir = path.join(base, clientId);
    if (!fs.statSync(clientDir).isDirectory()) continue;
    for (const day of fs.readdirSync(clientDir)) {
      const dayDir = path.join(clientDir, day);
      if (!fs.statSync(dayDir).isDirectory()) continue;
      for (const run of fs.readdirSync(dayDir)) {
        const deadLetterPath = path.join(dayDir, run, "alerts", "dead-letter.json");
        if (fs.existsSync(deadLetterPath)) {
          try {
            const letter = JSON.parse(fs.readFileSync(deadLetterPath, "utf8")) as DeadLetter;
            results.push({ filePath: deadLetterPath, letter });
          } catch {
            console.warn(`[retry-alerts] Skipping corrupt dead-letter: ${deadLetterPath}`);
          }
        }
      }
    }
  }

  return results;
}

async function retryDeadLetter(filePath: string, letter: DeadLetter): Promise<boolean> {
  const webhook = process.env[letter.webhookEnvName];
  if (!webhook) {
    console.warn(
      `[retry-alerts] Skip ${letter.clientId}/${letter.runId}: env var "${letter.webhookEnvName}" is not set`
    );
    return false;
  }

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(letter.payload)
      });
      if (res.ok) {
        console.log(`[retry-alerts] Delivered: ${letter.clientId}/${letter.runId}`);
        fs.unlinkSync(filePath);
        return true;
      }
      console.warn(`[retry-alerts] Attempt ${i + 1} failed: ${res.status}`);
    } catch (err) {
      console.warn(`[retry-alerts] Attempt ${i + 1} error: ${(err as Error).message}`);
    }
    if (i < 2) await new Promise<void>((r) => setTimeout(r, 1000 * (i + 1)));
  }

  console.error(`[retry-alerts] Failed to deliver ${letter.clientId}/${letter.runId} — dead-letter kept`);
  return false;
}

async function main(): Promise<void> {
  const deadLetters = findDeadLetters();

  if (deadLetters.length === 0) {
    console.log("[retry-alerts] Dead-letter queue is empty.");
    process.exit(0);
  }

  console.log(`[retry-alerts] Found ${deadLetters.length} failed alert(s), retrying...`);

  let delivered = 0;
  for (const { filePath, letter } of deadLetters) {
    const ok = await retryDeadLetter(filePath, letter);
    if (ok) delivered++;
  }

  console.log(`[retry-alerts] ${delivered}/${deadLetters.length} delivered.`);
  process.exit(delivered === deadLetters.length ? 0 : 1);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
