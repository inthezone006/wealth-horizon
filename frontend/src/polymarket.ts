type PolymarketRawMarket = {
  question?: string;
  title?: string;
  slug?: string;
  description?: string;
  category?: string;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  liquidityNum?: number | string;
  volumeNum?: number | string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  updatedAt?: string;
  endDate?: string;
  series?: Array<{
    title?: string;
    slug?: string;
  }>;
};

export type MarketFeedKey = 'recession' | 'rateCuts' | 'sp500';

export type MarketFeedSource = {
  key: MarketFeedKey;
  label: string;
  probability: number;
  status: 'live' | 'fallback';
  marketTitle: string;
  slug?: string;
  liquidity: number;
  updatedAt?: string;
};

type MarketQuery = {
  key: MarketFeedKey;
  label: string;
  exactSlugs: string[];
  fallbackProbability: number;
  fallbackTitle: string;
  probabilityTransform?: (probability: number) => number;
};

const MARKET_QUERIES: MarketQuery[] = [
  {
    key: 'recession',
    label: 'Recession risk',
    exactSlugs: ['us-recession-by-end-of-2026'],
    fallbackProbability: 0.42,
    fallbackTitle: 'Manual recession risk control',
  },
  {
    key: 'rateCuts',
    label: 'Rate cuts',
    exactSlugs: ['will-no-fed-rate-cuts-happen-in-2026'],
    fallbackProbability: 0.58,
    fallbackTitle: 'Manual rate-cut control',
    probabilityTransform: (probability) => 1 - probability,
  },
  {
    key: 'sp500',
    label: 'S&P 500 positive year',
    exactSlugs: ['spx-up-or-down-on-april-6-2026'],
    fallbackProbability: 0.54,
    fallbackTitle: 'Manual S&P direction control',
  },
];

function parseStringArray(value: string[] | string | undefined) {
  if (!value) {
    return [] as string[];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toNumber(value: number | string | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectSearchText(market: PolymarketRawMarket) {
  return normalizeText(
    [
      market.question,
      market.title,
      market.slug,
      market.description,
      market.category,
      market.series?.map((seriesItem) => [seriesItem.title, seriesItem.slug].filter(Boolean).join(' ')).join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function hasYesNoOutcomes(market: PolymarketRawMarket) {
  const outcomes = parseStringArray(market.outcomes).map(normalizeText);
  return outcomes.includes('yes') && outcomes.includes('no');
}

function getYesProbability(market: PolymarketRawMarket) {
  const outcomes = parseStringArray(market.outcomes).map(normalizeText);
  const outcomePrices = parseStringArray(market.outcomePrices);
  const yesIndex = outcomes.findIndex((outcome) => outcome === 'yes');

  if (yesIndex < 0) {
    return null;
  }

  const probability = Number.parseFloat(outcomePrices[yesIndex] || '');

  if (!Number.isFinite(probability)) {
    return null;
  }

  return Math.min(Math.max(probability, 0), 1);
}

function normalizeSlug(value: string | undefined) {
  return value?.trim().toLowerCase() || '';
}

function isEligibleMarket(market: PolymarketRawMarket) {
  return market.active !== false && market.closed !== true && market.archived !== true;
}

function matchesExactSlug(market: PolymarketRawMarket, exactSlugs: string[]) {
  const slug = normalizeSlug(market.slug);

  return exactSlugs.map(normalizeSlug).includes(slug);
}

function resolveProbabilityFromCandidate(market: PolymarketRawMarket, transform?: (probability: number) => number) {
  const probability = getYesProbability(market);

  if (probability === null) {
    return null;
  }

  const adjustedProbability = transform ? transform(probability) : probability;

  return Math.min(Math.max(adjustedProbability, 0), 1);
}

function resolveMarketSource(query: MarketQuery, markets: PolymarketRawMarket[]): MarketFeedSource {
  const candidate = markets
    .filter(isEligibleMarket)
    .filter((market) => matchesExactSlug(market, query.exactSlugs))
    .sort((left, right) => {
      const liquidityDelta = toNumber(right.liquidityNum) - toNumber(left.liquidityNum);

      if (liquidityDelta !== 0) {
        return liquidityDelta;
      }

      const volumeDelta = toNumber(right.volumeNum) - toNumber(left.volumeNum);

      if (volumeDelta !== 0) {
        return volumeDelta;
      }

      const updatedLeft = left.updatedAt ? Date.parse(left.updatedAt) : 0;
      const updatedRight = right.updatedAt ? Date.parse(right.updatedAt) : 0;

      return updatedRight - updatedLeft;
    })[0];

  if (!candidate) {
    return {
      key: query.key,
      label: query.label,
      probability: query.fallbackProbability,
      status: 'fallback',
      marketTitle: query.fallbackTitle,
      liquidity: 0,
    };
  }

  const probability = resolveProbabilityFromCandidate(candidate, query.probabilityTransform);

  if (probability === null) {
    return {
      key: query.key,
      label: query.label,
      probability: query.fallbackProbability,
      status: 'fallback',
      marketTitle: query.fallbackTitle,
      slug: candidate.slug,
      liquidity: toNumber(candidate.liquidityNum),
      updatedAt: candidate.updatedAt,
    };
  }

  return {
    key: query.key,
    label: query.label,
    probability,
    status: 'live',
    marketTitle: candidate.question || candidate.title || query.label,
    slug: candidate.slug,
    liquidity: toNumber(candidate.liquidityNum),
    updatedAt: candidate.updatedAt,
  };
}

export async function fetchPolymarketMarketFeed(signal?: AbortSignal) {
  const response = await fetch('https://gamma-api.polymarket.com/markets', {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Polymarket request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as PolymarketRawMarket[];
  const markets = Array.isArray(payload) ? payload : [];

  return {
    generatedAt: new Date().toISOString(),
    availableMarkets: markets.length,
    sources: MARKET_QUERIES.map((query) => resolveMarketSource(query, markets)),
  };
}
