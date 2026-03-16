export type USDValue = {
  value: bigint;
  display: string;
  isLoss: boolean;
};

export interface WeiConversion {
  eth: string;
  usd: string;
  usdRaw: number;
  isLoss: boolean;
}

function parseUsdToMicro(priceUsd: string): bigint {
  const text = priceUsd.trim();
  const match = text.match(/^\d+(?:\.\d+)?$/);
  if (!match) {
    throw new Error(`Invalid ETH_PRICE_USD value: ${priceUsd}`);
  }

  const [whole, fraction = ""] = text.split(".");
  const padded = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(padded);
}

function formatUsdCents(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;

  const dollars = abs / 100n;
  const cents = abs % 100n;
  const dollarsWithCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}$${dollarsWithCommas}.${cents.toString().padStart(2, "0")}`;
}

export function rawAmountToUsd(rawAmount: string, ethPriceUsd: string, decimals = 18): USDValue {
  const amount = BigInt(rawAmount);
  const absAmount = amount < 0n ? -amount : amount;
  const priceMicro = parseUsdToMicro(ethPriceUsd);

  const units = 10n ** BigInt(decimals);
  const usdMicro = (absAmount * priceMicro) / units;
  const usdCents = usdMicro / 10_000n;

  const signedCents = amount < 0n ? -usdCents : usdCents;
  return {
    value: signedCents,
    display: formatUsdCents(signedCents),
    isLoss: signedCents < 0n
  };
}

export function weiToUSD(
  raw: string,
  ethPriceUSD: number,
  decimals = 18
): WeiConversion {
  const value = BigInt(raw);
  const isNeg = value < 0n;
  const absValue = isNeg ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = absValue / divisor;
  const fraction = absValue % divisor;

  const eth = `${isNeg ? "-" : ""}${whole}.${fraction.toString().padStart(decimals, "0").slice(0, 6)}`;
  const usdRaw = Number(eth) * ethPriceUSD;
  const isLoss = usdRaw < 0;
  const usd = `${isLoss ? "-" : "+"}${Math.abs(usdRaw).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  })}`;

  return {
    eth,
    usd,
    usdRaw,
    isLoss
  };
}

export function formatUsdFromCents(value: bigint): string {
  return formatUsdCents(value);
}
