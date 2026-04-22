import { createBillingWebhookApp } from "./webhookHandler";
import { runBillingMigrations } from "./migrate";

const port = Number(process.env.PORT || 3000);

function main(): void {
  runBillingMigrations();

  const app = createBillingWebhookApp();
  app.listen(port, () => {
    console.log(`[billing:webhook] listening on :${port}`);
  });
}

main();
