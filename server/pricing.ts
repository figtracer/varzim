export function calculateCost(blockSpan: number): number {
  // $0.01 base + $0.001 per 1000 blocks
  // Min: $0.01, Max: $0.10
  const base = 0.01
  const perThousand = 0.001
  const variable = Math.ceil(blockSpan / 1000) * perThousand
  return Math.min(Math.max(base + variable, 0.01), 0.10)
}

// Shadow watch: $0.05 per hour per contract
export const WATCH_COST_PER_HOUR = 0.05
export const WATCH_DURATION_MS = 60 * 60 * 1000 // 1 hour
export const WATCH_POLL_INTERVAL_MS = 12_000 // ~1 block time
