export type ModelPosition = {
  id: string;
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  isLong: boolean;
  feeAccrued: bigint;
};

export type ModelPnl = {
  positionId: string;
  realizedPnl: bigint;
};

export class GMXAccountingModel {
  private readonly positions = new Map<string, ModelPosition>();

  openPosition(collateral: bigint, size: bigint, price: bigint, isLong: boolean): ModelPosition {
    const id = `pos-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const position: ModelPosition = {
      id,
      collateral,
      size,
      entryPrice: price,
      isLong,
      feeAccrued: 0n
    };
    this.positions.set(id, position);
    return position;
  }

  closePosition(positionId: string, sizeDelta: bigint, price: bigint): ModelPnl {
    const position = this.positions.get(positionId);
    if (!position) {
      return { positionId, realizedPnl: 0n };
    }

    const effectiveDelta = sizeDelta > position.size ? position.size : sizeDelta;
    const priceDiff = position.isLong ? price - position.entryPrice : position.entryPrice - price;
    const realizedPnl = position.entryPrice === 0n ? 0n : (effectiveDelta * priceDiff) / position.entryPrice;

    position.size -= effectiveDelta;
    if (position.size === 0n) {
      this.positions.delete(positionId);
    } else {
      this.positions.set(positionId, position);
    }

    return { positionId, realizedPnl };
  }

  applyFee(positionId: string, feeAmount: bigint): void {
    const position = this.positions.get(positionId);
    if (!position) {
      return;
    }
    position.feeAccrued += feeAmount;
    position.collateral = position.collateral > feeAmount ? position.collateral - feeAmount : 0n;
    this.positions.set(positionId, position);
  }

  expectedCollateralAfterOpen(collateral: bigint, feeRateBps: bigint): bigint {
    const fee = (collateral * feeRateBps) / 10_000n;
    return collateral > fee ? collateral - fee : 0n;
  }

  expectedPnl(positionId: string, exitPrice: bigint): bigint {
    const position = this.positions.get(positionId);
    if (!position || position.entryPrice === 0n) {
      return 0n;
    }
    const direction = position.isLong ? 1n : -1n;
    const delta = exitPrice - position.entryPrice;
    return (position.size * delta * direction) / position.entryPrice;
  }

  classifyDivergence(actual: bigint, expected: bigint, tolerance: bigint): "expected" | "rounding" | "mismatch" {
    const diff = actual >= expected ? actual - expected : expected - actual;
    if (diff === 0n) {
      return "expected";
    }
    if (diff <= tolerance) {
      return "rounding";
    }
    return "mismatch";
  }
}
