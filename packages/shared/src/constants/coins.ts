// Supported coins on Hyperliquid
// This list should be updated as new coins are added

export const MAJOR_COINS = [
  'BTC',
  'ETH',
  'SOL',
  'DOGE',
  'XRP',
  'ADA',
  'AVAX',
  'LINK',
  'DOT',
  'MATIC',
  'UNI',
  'ATOM',
  'LTC',
  'FIL',
  'APT',
  'ARB',
  'OP',
  'INJ',
  'SUI',
  'SEI',
] as const;

export const MEME_COINS = [
  'DOGE',
  'SHIB',
  'PEPE',
  'FLOKI',
  'BONK',
  'WIF',
  'POPCAT',
  'MOG',
  'BRETT',
  'NEIRO',
] as const;

export const DEFI_COINS = [
  'UNI',
  'AAVE',
  'MKR',
  'SNX',
  'CRV',
  'LDO',
  'COMP',
  'YFI',
  'SUSHI',
  'BAL',
] as const;

export const ALL_COINS = [
  ...new Set([...MAJOR_COINS, ...MEME_COINS, ...DEFI_COINS]),
] as const;

export type MajorCoin = typeof MAJOR_COINS[number];
export type MemeCoin = typeof MEME_COINS[number];
export type DefiCoin = typeof DEFI_COINS[number];
export type Coin = typeof ALL_COINS[number];

// Coin categories for filtering
export const COIN_CATEGORIES = {
  major: MAJOR_COINS,
  meme: MEME_COINS,
  defi: DEFI_COINS,
} as const;

export type CoinCategory = keyof typeof COIN_CATEGORIES;

// Coin display info
export interface CoinInfo {
  symbol: string;
  name: string;
  category: CoinCategory;
  decimals: number;
}

export const COIN_INFO: Record<string, CoinInfo> = {
  BTC: { symbol: 'BTC', name: 'Bitcoin', category: 'major', decimals: 5 },
  ETH: { symbol: 'ETH', name: 'Ethereum', category: 'major', decimals: 4 },
  SOL: { symbol: 'SOL', name: 'Solana', category: 'major', decimals: 2 },
  DOGE: { symbol: 'DOGE', name: 'Dogecoin', category: 'meme', decimals: 0 },
  // Add more as needed
};

// Get coin category
export function getCoinCategory(coin: string): CoinCategory | null {
  if (MAJOR_COINS.includes(coin as MajorCoin)) return 'major';
  if (MEME_COINS.includes(coin as MemeCoin)) return 'meme';
  if (DEFI_COINS.includes(coin as DefiCoin)) return 'defi';
  return null;
}
