export type SimulationRiskLevel = 'conservative' | 'balanced' | 'growth';

export type SimulationStrategyMode = 'market-probabilities' | 'historical-average' | 'compare-both';

export type SimulationProfile = {
  displayName: string;
  ageRange: string;
  primaryGoal: string;
  monthlyContribution: number;
  targetHorizonYears: number;
  riskLevel: SimulationRiskLevel;
  strategyMode: SimulationStrategyMode;
};

export type SimulationMarketProbabilities = {
  recessionProbability: number;
  rateCutProbability: number;
  spUpProbability: number;
};

export type SimulationOutputs = {
  baseReturn: number;
  level1ExpectedReturn: number;
  level2WeightedReturn: number;
  historicalAverageReturn: number;
  marketProbabilityReturn: number;
  preferredReturn: number;
  projectedFinalBalance: number;
  totalContributions: number;
  projectedGain: number;
};

export type SimulationProjectionPoint = {
  year: number;
  startingBalance: number;
  annualContribution: number;
  gains: number;
  endingBalance: number;
};

export type SimulationRequest = {
  profile: SimulationProfile;
  marketProbabilities: SimulationMarketProbabilities;
};

export type SimulationResponse = {
  generatedAt: string;
  profile: SimulationProfile;
  marketProbabilities: SimulationMarketProbabilities;
  outputs: SimulationOutputs;
  projection: SimulationProjectionPoint[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || '';

function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

export async function fetchSimulation(request: SimulationRequest, signal?: AbortSignal) {
  const response = await fetch(buildApiUrl('/api/simulate'), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    const message = payload?.error?.message || `Simulation request failed with status ${response.status}`;
    throw new Error(message);
  }

  return (await response.json()) as SimulationResponse;
}
