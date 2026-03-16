import fs from "fs";
import path from "path";

type PricingTier = {
  name: string;
  priceMonthlyUsd: number;
  targetClient: string;
  features: string[];
};

const FORMAT_OPTIONS = ["md", "html"] as const;
type OutputFormat = (typeof FORMAT_OPTIONS)[number];

export const PRICING_TIERS: PricingTier[] = [
  {
    name: "OSS Free",
    priceMonthlyUsd: 0,
    targetClient: "Solo hunters",
    features: ["GitHub Actions", "Proof CLI"]
  },
  {
    name: "CI Basic",
    priceMonthlyUsd: 500,
    targetClient: "Indie auditors",
    features: ["Multi-chain matrix", "Triage alerts", "Issue templates"]
  },
  {
    name: "Regression Pro",
    priceMonthlyUsd: 2500,
    targetClient: "Mid-tier DeFi",
    features: ["Dashboard", "Weekly digest", "Security score trend"]
  },
  {
    name: "Bounty Enterprise",
    priceMonthlyUsd: 8000,
    targetClient: "Top protocols",
    features: ["Custom invariants", "USD/TVL impact", "Priority support", "White-label reports"]
  }
];

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function normalizeTierName(input: string): string {
  return input.trim().toLowerCase();
}

function getTierByName(name: string): PricingTier | undefined {
  const target = normalizeTierName(name);
  return PRICING_TIERS.find((tier) => normalizeTierName(tier.name) === target);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export function generateProposalMarkdown(clientName: string, tier: PricingTier): string {
  const generatedAt = new Date().toISOString();
  const yearly = tier.priceMonthlyUsd * 12;

  return `# Proposal: gmx-audit retainer for ${clientName}

Generated: ${generatedAt}

## Recommended tier

- Tier: **${tier.name}**
- Price: **${formatUsd(tier.priceMonthlyUsd)}/month** (${formatUsd(yearly)}/year)
- Client profile: ${tier.targetClient}

## Included capabilities

${tier.features.map((feature) => `- ${feature}`).join("\n")}

## Business value

- Continuous invariant coverage across supported chains
- Auto-packaged reproducible proofs for triage and Immunefi reporting
- Security score trend that highlights regression risk before deployment

## Suggested next step

Schedule a 30-minute setup call and run a one-week pilot against your production fork window.
`;
}

export function generateProposalHtml(clientName: string, tier: PricingTier): string {
  const yearly = tier.priceMonthlyUsd * 12;
  const generatedAt = new Date().toISOString();
  const featureItems = tier.features.map((feature) => `<li>${feature}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>gmx-audit Proposal - ${clientName}</title>
  <style>
    :root { --bg: #0b1220; --card: #131d33; --text: #d9e2f2; --muted: #8ca0bf; --accent: #23b26f; }
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: linear-gradient(170deg, #0b1220, #16213d); color: var(--text); }
    .wrap { max-width: 900px; margin: 32px auto; padding: 0 16px; }
    .card { background: var(--card); border: 1px solid #243454; border-radius: 12px; padding: 24px; }
    h1 { margin: 0 0 8px; }
    .muted { color: var(--muted); }
    .price { font-size: 28px; font-weight: 700; color: var(--accent); margin: 12px 0; }
    .tag { display: inline-block; border: 1px solid #355086; border-radius: 999px; padding: 4px 10px; font-size: 12px; color: var(--muted); }
    ul { margin-top: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .pill { background: #0f1728; border: 1px solid #223153; border-radius: 10px; padding: 12px; }
    @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <article class="card">
      <h1>Proposal: gmx-audit retainer for ${clientName}</h1>
      <p class="muted">Generated ${generatedAt}</p>
      <div class="tag">Recommended tier: ${tier.name}</div>
      <p class="price">${formatUsd(tier.priceMonthlyUsd)}/month</p>
      <p class="muted">Annualized: ${formatUsd(yearly)}. Best fit: ${tier.targetClient}.</p>
      <h2>Included capabilities</h2>
      <ul>${featureItems}</ul>
      <h2>Business value</h2>
      <div class="grid">
        <div class="pill">Continuous invariant coverage across supported chains.</div>
        <div class="pill">Auto-packaged reproducible proofs for triage and submission workflows.</div>
        <div class="pill">Security score trend to spot regressions early.</div>
        <div class="pill">One-week pilot with measurable coverage and response-time metrics.</div>
      </div>
    </article>
  </div>
</body>
</html>
`;
}

function printUsage(): void {
  console.error("Usage: npm run pricing:proposal -- --client <name> --tier <tier-name> [--format md|html] [--out path]");
  console.error(`Available tiers: ${PRICING_TIERS.map((t) => t.name).join(", ")}`);
}

function main(): void {
  const client = getArg("--client");
  const tierName = getArg("--tier");
  const formatArg = (getArg("--format") || "html").toLowerCase();
  const outArg = getArg("--out");

  if (!client || !tierName) {
    printUsage();
    process.exit(2);
  }

  if (!FORMAT_OPTIONS.includes(formatArg as OutputFormat)) {
    printUsage();
    process.exit(2);
  }

  const tier = getTierByName(tierName);
  if (!tier) {
    printUsage();
    process.exit(2);
  }

  const format = formatArg as OutputFormat;
  const defaultName = `proposal-${client.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}.${format}`;
  const outputPath = path.resolve(process.cwd(), outArg || defaultName);

  const content = format === "md" ? generateProposalMarkdown(client, tier) : generateProposalHtml(client, tier);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`[pricing:proposal] written ${outputPath}`);
  console.log(`[pricing:proposal] tier=${tier.name} price=${formatUsd(tier.priceMonthlyUsd)}/month`);
}

if (require.main === module) {
  main();
}