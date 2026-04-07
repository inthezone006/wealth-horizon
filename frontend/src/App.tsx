import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Timestamp,
} from 'firebase/firestore';
import { appAuth, appDb, firebaseConfigStatus } from './firebase';
import { fetchPolymarketMarketFeed, type MarketFeedSource } from './polymarket';
import { fetchSimulation, type SimulationProfile, type SimulationProjectionPoint, type SimulationRequest, type SimulationResponse } from './simulationApi';

type AuthMode = 'signin' | 'signup';
type RiskLevel = 'conservative' | 'balanced' | 'growth';
type StrategyMode = 'market-probabilities' | 'historical-average' | 'compare-both';
type OnboardingStep = 1 | 2 | 3;
type ThemeMode = 'light' | 'dark';

type OnboardingData = {
  displayName: string;
  ageRange: string;
  primaryGoal: string;
  monthlyContribution: number;
  targetHorizonYears: number;
  riskLevel: RiskLevel;
  strategyMode: StrategyMode;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

type SimulationRecord = {
  id: string;
  snapshot?: SimulationSnapshot;
  createdAt?: Timestamp;
};

type SimulationSnapshot = {
  generatedAt: string;
  displayName: string;
  ageRange: string;
  primaryGoal: string;
  monthlyContribution: number;
  targetHorizonYears: number;
  riskLevel: RiskLevel;
  strategyMode: StrategyMode;
  marketProbabilities: {
    recessionProbability: number;
    rateCutProbability: number;
    spUpProbability: number;
  };
  outputs: {
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
  projection: SimulationProjectionPoint[];
  shareToken?: string;
};

type FirebaseClientError = {
  code?: string;
  message?: string;
};

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'This email is already registered. Sign in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Use at least 6 characters for your password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'No user found with this email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
};

const DEFAULT_ONBOARDING: Omit<OnboardingData, 'createdAt' | 'updatedAt'> = {
  displayName: '',
  ageRange: '26-35',
  primaryGoal: 'Financial independence',
  monthlyContribution: 700,
  targetHorizonYears: 20,
  riskLevel: 'balanced',
  strategyMode: 'compare-both',
};

const DEFAULT_MARKET_VALUES = {
  recessionProbability: 42,
  rateCutProbability: 58,
  spUpProbability: 54,
};

const RISK_BASE_RETURN: Record<RiskLevel, number> = {
  conservative: 0.056,
  balanced: 0.074,
  growth: 0.094,
};

const EXPECTED_RETURN_TREND_PROBS = [0.40, 0.35, 0.25] as const;
const EXPECTED_RETURN_TREND_VALUES = [0.12, 0.07, -0.15] as const;

const RISK_LABELS: Record<RiskLevel, string> = {
  conservative: 'Conservative',
  balanced: 'Balanced',
  growth: 'Growth',
};

const STRATEGY_LABELS: Record<StrategyMode, string> = {
  'market-probabilities': 'Market probabilities',
  'historical-average': 'Historical average',
  'compare-both': 'Compare both',
};

const ONBOARDING_STEPS = [
  {
    title: 'Profile',
    description: 'Tell us who you are and your primary financial goal.',
  },
  {
    title: 'Plan',
    description: 'Set your contribution level, age range, and target horizon.',
  },
  {
    title: 'Strategy',
    description: 'Choose how the simulator should interpret market information.',
  },
] as const;

const THEME_STORAGE_KEY = 'wealth-horizon-theme';

function getFirebaseErrorMessage(error: unknown, fallback: string) {
  const firebaseError = error as FirebaseClientError;
  const errorCode = (firebaseError?.code || '').toLowerCase();
  const configuredProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'unknown-project';

  if (errorCode.endsWith('permission-denied')) {
    return `Firestore permission denied in project ${configuredProjectId}. Publish rules that allow authenticated users to read/write users/{uid} and users/{uid}/simulations/{docId}, and confirm you are signed in to the same Firebase project.`;
  }

  if (errorCode.endsWith('unavailable')) {
    return 'Firestore is unavailable right now. Check your internet connection and Firebase project status.';
  }

  if (errorCode.endsWith('failed-precondition')) {
    return 'Firestore is not fully initialized in this project. Enable Firestore Database in the Firebase console.';
  }

  if (errorCode.endsWith('unauthenticated')) {
    return 'Firestore request is unauthenticated. Sign out, sign in again, and confirm Firebase Auth is enabled.';
  }

  if (errorCode.endsWith('not-found')) {
    return 'Firebase project resources were not found. Verify VITE_FIREBASE_PROJECT_ID and the selected Firebase project.';
  }

  if (errorCode.endsWith('invalid-api-key') || errorCode.endsWith('app/invalid-api-key')) {
    return 'Firebase API key is invalid. Check VITE_FIREBASE_API_KEY in frontend/.env.';
  }

  if (errorCode.endsWith('auth/network-request-failed')) {
    return 'Network request to Firebase failed. Check your connection and retry.';
  }

  if (errorCode.includes('missing firebase session') || errorCode.includes('firebase is not ready')) {
    return 'Firebase configuration is incomplete in frontend/.env. Restart the dev server after updating env values.';
  }

  if (firebaseError?.code) {
    return `${fallback} (code: ${firebaseError.code})`;
  }

  return fallback;
}

type ShareableSimulationState = {
  profile: SimulationProfile;
  marketProbabilities: {
    recessionProbability: number;
    rateCutProbability: number;
    spUpProbability: number;
  };
};

function encodeShareToken(value: ShareableSimulationState) {
  const json = JSON.stringify(value);
  return window.btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeShareToken(token: string) {
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const json = decodeURIComponent(escape(window.atob(padded)));
  return JSON.parse(json) as ShareableSimulationState;
}

function buildSimulationRequest(profile: Omit<SimulationProfile, 'displayName'> & { displayName: string }, marketProbabilities: ShareableSimulationState['marketProbabilities']): SimulationRequest {
  return {
    profile,
    marketProbabilities,
  };
}

function toSnapshotFromSimulation(response: SimulationResponse): SimulationSnapshot {
  return {
    generatedAt: response.generatedAt,
    displayName: response.profile.displayName,
    ageRange: response.profile.ageRange,
    primaryGoal: response.profile.primaryGoal,
    monthlyContribution: response.profile.monthlyContribution,
    targetHorizonYears: response.profile.targetHorizonYears,
    riskLevel: response.profile.riskLevel,
    strategyMode: response.profile.strategyMode,
    marketProbabilities: response.marketProbabilities,
    outputs: response.outputs,
    projection: response.projection,
  };
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [mode, setMode] = useState<AuthMode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profile, setProfile] = useState<OnboardingData | null>(null);
  const [recentSimulations, setRecentSimulations] = useState<SimulationRecord[]>([]);
  const [isOnboardingSaving, setIsOnboardingSaving] = useState(false);
  const [isSimulationSaving, setIsSimulationSaving] = useState(false);

  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(1);
  const [onboardingName, setOnboardingName] = useState('');
  const [ageRange, setAgeRange] = useState(DEFAULT_ONBOARDING.ageRange);
  const [primaryGoal, setPrimaryGoal] = useState(DEFAULT_ONBOARDING.primaryGoal);
  const [monthlyContribution, setMonthlyContribution] = useState(String(DEFAULT_ONBOARDING.monthlyContribution));
  const [targetHorizonYears, setTargetHorizonYears] = useState(String(DEFAULT_ONBOARDING.targetHorizonYears));
  const [riskLevel, setRiskLevel] = useState<RiskLevel>(DEFAULT_ONBOARDING.riskLevel);
  const [strategyMode, setStrategyMode] = useState<StrategyMode>(DEFAULT_ONBOARDING.strategyMode);

  const [recessionProbability, setRecessionProbability] = useState(42);
  const [rateCutProbability, setRateCutProbability] = useState(DEFAULT_MARKET_VALUES.rateCutProbability);
  const [spUpProbability, setSpUpProbability] = useState(DEFAULT_MARKET_VALUES.spUpProbability);
  const [marketSources, setMarketSources] = useState<MarketFeedSource[]>([]);
  const [marketFeedState, setMarketFeedState] = useState<'idle' | 'loading' | 'ready' | 'degraded' | 'error'>('idle');
  const [marketFeedUpdatedAt, setMarketFeedUpdatedAt] = useState<string | null>(null);
  const [marketRefreshNonce, setMarketRefreshNonce] = useState(0);
  const [backendSimulation, setBackendSimulation] = useState<SimulationResponse | null>(null);
  const [backendSimulationState, setBackendSimulationState] = useState<'idle' | 'loading' | 'ready' | 'fallback' | 'error'>('idle');
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [sharedSimulation, setSharedSimulation] = useState<ShareableSimulationState | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSignUp = mode === 'signup';

  const hasValidConfig = useMemo(
    () => firebaseConfigStatus.isValid && appAuth !== null && appDb !== null,
    [],
  );

  const view: 'auth' | 'onboarding' | 'dashboard' = useMemo(() => {
    if (!currentUser) {
      return 'auth';
    }

    if (!profile) {
      return 'onboarding';
    }

    return 'dashboard';
  }, [currentUser, profile]);

  const effectiveDisplayName = useMemo(() => {
    if (sharedSimulation?.profile.displayName) {
      return sharedSimulation.profile.displayName;
    }

    if (profile?.displayName) {
      return profile.displayName;
    }

    return currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Investor';
  }, [currentUser, profile, sharedSimulation]);

  const baseReturn = useMemo(() => {
    const selectedRisk = profile?.riskLevel || riskLevel;
    return RISK_BASE_RETURN[selectedRisk];
  }, [profile?.riskLevel, riskLevel]);

  const level1ExpectedReturn = useMemo(() => {
    const recessionDrag = (recessionProbability / 100) * 0.35;
    return Math.max(baseReturn * (1 - recessionDrag), 0.01);
  }, [baseReturn, recessionProbability]);

  const level2WeightedReturn = useMemo(() => {
    const recession = recessionProbability / 100;
    const rateCuts = rateCutProbability / 100;
    const spUp = spUpProbability / 100;

    const total = recession + rateCuts + spUp;
    const normalizedProbs =
      total > 0
        ? {
            riskOn: spUp / total,
            disinflation: rateCuts / total,
            recession: recession / total,
          }
        : {
            riskOn: EXPECTED_RETURN_TREND_PROBS[0],
            disinflation: EXPECTED_RETURN_TREND_PROBS[1],
            recession: EXPECTED_RETURN_TREND_PROBS[2],
          };

    const regimeReturns = {
      riskOn: EXPECTED_RETURN_TREND_VALUES[0],
      disinflation: EXPECTED_RETURN_TREND_VALUES[1],
      recession: EXPECTED_RETURN_TREND_VALUES[2],
    };

    const weighted =
      normalizedProbs.riskOn * regimeReturns.riskOn +
      normalizedProbs.disinflation * regimeReturns.disinflation +
      normalizedProbs.recession * regimeReturns.recession;

    return Math.max(weighted, 0.01);
  }, [recessionProbability, rateCutProbability, spUpProbability]);

  const level3Comparison = useMemo(() => {
    const historical = baseReturn;
    const marketForward = (level1ExpectedReturn + level2WeightedReturn) / 2;

    return {
      historical,
      marketForward,
      delta: marketForward - historical,
    };
  }, [baseReturn, level1ExpectedReturn, level2WeightedReturn]);

  const preferredReturn = useMemo(() => {
    const profileStrategy = sharedSimulation?.profile.strategyMode || profile?.strategyMode || strategyMode;

    if (profileStrategy === 'historical-average') {
      return level3Comparison.historical;
    }

    if (profileStrategy === 'market-probabilities') {
      return level3Comparison.marketForward;
    }

    return (level3Comparison.historical + level3Comparison.marketForward) / 2;
  }, [level3Comparison, profile?.strategyMode, sharedSimulation, strategyMode]);

  const simulationProfile = useMemo<SimulationProfile>(
    () => ({
      displayName: effectiveDisplayName,
      ageRange: sharedSimulation?.profile.ageRange || profile?.ageRange || ageRange,
      primaryGoal: sharedSimulation?.profile.primaryGoal || profile?.primaryGoal || primaryGoal,
      monthlyContribution: Number(sharedSimulation?.profile.monthlyContribution || profile?.monthlyContribution || monthlyContribution),
      targetHorizonYears: Number(sharedSimulation?.profile.targetHorizonYears || profile?.targetHorizonYears || targetHorizonYears),
      riskLevel: (sharedSimulation?.profile.riskLevel || profile?.riskLevel || riskLevel) as RiskLevel,
      strategyMode: (sharedSimulation?.profile.strategyMode || profile?.strategyMode || strategyMode) as StrategyMode,
    }),
    [ageRange, effectiveDisplayName, monthlyContribution, primaryGoal, profile, riskLevel, sharedSimulation, strategyMode, targetHorizonYears],
  );

  const simulationRequest = useMemo<SimulationRequest>(
    () => ({
      profile: simulationProfile,
      marketProbabilities: {
        recessionProbability,
        rateCutProbability,
        spUpProbability,
      },
    }),
    [recessionProbability, rateCutProbability, simulationProfile, spUpProbability],
  );

  const simulationProjection = useMemo<SimulationProjectionPoint[]>(() => {
    const annualContribution = simulationProfile.monthlyContribution * 12;
    const timeline: SimulationProjectionPoint[] = [];
    let balance = 0;

    for (let year = 1; year <= simulationProfile.targetHorizonYears; year += 1) {
      const startingBalance = balance;
      const gains = (startingBalance + annualContribution) * preferredReturn;
      balance = startingBalance + annualContribution + gains;

      timeline.push({
        year,
        startingBalance: Number(startingBalance.toFixed(2)),
        annualContribution: Number(annualContribution.toFixed(2)),
        gains: Number(gains.toFixed(2)),
        endingBalance: Number(balance.toFixed(2)),
      });
    }

    return timeline;
  }, [preferredReturn, simulationProfile.monthlyContribution, simulationProfile.targetHorizonYears]);

  const snapshotPayload = useMemo<SimulationSnapshot>(
    () => ({
      generatedAt: new Date().toISOString(),
      displayName: simulationProfile.displayName,
      ageRange: simulationProfile.ageRange,
      primaryGoal: simulationProfile.primaryGoal,
      monthlyContribution: simulationProfile.monthlyContribution,
      targetHorizonYears: simulationProfile.targetHorizonYears,
      riskLevel: simulationProfile.riskLevel,
      strategyMode: simulationProfile.strategyMode,
      marketProbabilities: {
        recessionProbability,
        rateCutProbability,
        spUpProbability,
      },
      outputs: {
        baseReturn,
        level1ExpectedReturn,
        level2WeightedReturn,
        historicalAverageReturn: level3Comparison.historical,
        marketProbabilityReturn: level3Comparison.marketForward,
        preferredReturn,
        projectedFinalBalance: simulationProjection.at(-1)?.endingBalance ?? 0,
        totalContributions: Number((simulationProfile.monthlyContribution * 12 * simulationProfile.targetHorizonYears).toFixed(2)),
        projectedGain: Number(((simulationProjection.at(-1)?.endingBalance ?? 0) - simulationProfile.monthlyContribution * 12 * simulationProfile.targetHorizonYears).toFixed(2)),
      },
      projection: simulationProjection,
    }),
    [
      baseReturn,
      level1ExpectedReturn,
      level2WeightedReturn,
      level3Comparison.historical,
      level3Comparison.marketForward,
      preferredReturn,
      recessionProbability,
      rateCutProbability,
      simulationProfile,
      simulationProjection,
      spUpProbability,
    ],
  );

  const activeSimulation = useMemo<SimulationSnapshot>(
    () => (backendSimulation ? toSnapshotFromSimulation(backendSimulation) : snapshotPayload),
    [backendSimulation, snapshotPayload],
  );

  const chartProjection = activeSimulation.projection.length > 0 ? activeSimulation.projection : simulationProjection;

  const chartMaxBalance = useMemo(() => {
    const peak = Math.max(...chartProjection.map((point) => point.endingBalance), 0);
    return peak > 0 ? peak : 1;
  }, [chartProjection]);

  const chartSeries = useMemo(() => {
    if (chartProjection.length === 0) {
      return [] as Array<SimulationProjectionPoint & { x: number; y: number }>;
    }

    const chartWidth = 640;
    const chartHeight = 240;
    const step = chartProjection.length > 1 ? chartWidth / (chartProjection.length - 1) : chartWidth;

    return chartProjection.map((point, index) => ({
      ...point,
      x: Number((index * step).toFixed(2)),
      y: Number((chartHeight - (point.endingBalance / chartMaxBalance) * chartHeight).toFixed(2)),
    }));
  }, [chartMaxBalance, chartProjection]);

  const chartLinePoints = useMemo(
    () => chartSeries.map((point) => `${point.x},${point.y}`).join(' '),
    [chartSeries],
  );

  const shareToken = useMemo(
    () =>
      encodeShareToken({
        profile: simulationProfile,
        marketProbabilities: simulationRequest.marketProbabilities,
      }),
    [simulationProfile, simulationRequest],
  );

  const shareUrl = useMemo(
    () => `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(shareToken)}`,
    [shareToken],
  );

  const backendStatusLabel =
    backendSimulationState === 'ready'
      ? 'Backend synced'
      : backendSimulationState === 'loading'
        ? 'Syncing backend'
        : backendSimulationState === 'fallback'
          ? 'Local fallback'
          : backendSimulationState === 'error'
            ? 'Backend unavailable'
            : 'Local model';

  const hydrateOnboardingDraft = (user: User, savedProfile?: Partial<OnboardingData> | null) => {
    const draftDisplayName = savedProfile?.displayName || user.displayName || user.email?.split('@')[0] || '';

    setProfile(null);
    setOnboardingName(draftDisplayName);
    setAgeRange(savedProfile?.ageRange || DEFAULT_ONBOARDING.ageRange);
    setPrimaryGoal(savedProfile?.primaryGoal || DEFAULT_ONBOARDING.primaryGoal);
    setMonthlyContribution(String(savedProfile?.monthlyContribution || DEFAULT_ONBOARDING.monthlyContribution));
    setTargetHorizonYears(String(savedProfile?.targetHorizonYears || DEFAULT_ONBOARDING.targetHorizonYears));
    setRiskLevel(savedProfile?.riskLevel || DEFAULT_ONBOARDING.riskLevel);
    setStrategyMode(savedProfile?.strategyMode || DEFAULT_ONBOARDING.strategyMode);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!appAuth || !hasValidConfig) {
      return;
    }

    setPersistence(appAuth, browserSessionPersistence).catch(() => {
      setErrorMessage('Could not apply session persistence for Firebase Auth.');
    });

    const unsubscribe = onAuthStateChanged(appAuth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });

    return unsubscribe;
  }, [hasValidConfig]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');

    if (!shareToken) {
      return;
    }

    try {
      setSharedSimulation(decodeShareToken(shareToken));
      setShareStatus('Shared simulation loaded from the link.');
    } catch {
      setShareStatus('Could not read the shared simulation link.');
    }
  }, []);

  useEffect(() => {
    const loadUserProfile = async () => {
      if (!currentUser || !appDb) {
        setProfile(null);
        setRecentSimulations([]);
        setIsProfileLoading(false);
        return;
      }

      setIsProfileLoading(true);

      try {
        const profileRef = doc(appDb, 'users', currentUser.uid);
        const profileSnapshot = await getDoc(profileRef);

        if (!profileSnapshot.exists()) {
          hydrateOnboardingDraft(currentUser);
          return;
        }

        const data = profileSnapshot.data() as DocumentData;
        const onboardingRecord: OnboardingData = {
          displayName: data.displayName || currentUser.displayName || '',
          ageRange: data.ageRange || DEFAULT_ONBOARDING.ageRange,
          primaryGoal: data.primaryGoal || DEFAULT_ONBOARDING.primaryGoal,
          monthlyContribution: Number(data.monthlyContribution) || DEFAULT_ONBOARDING.monthlyContribution,
          targetHorizonYears: Number(data.targetHorizonYears) || DEFAULT_ONBOARDING.targetHorizonYears,
          riskLevel: (data.riskLevel as RiskLevel) || DEFAULT_ONBOARDING.riskLevel,
          strategyMode: (data.strategyMode as StrategyMode) || DEFAULT_ONBOARDING.strategyMode,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };

        setProfile(onboardingRecord);
        setOnboardingName(onboardingRecord.displayName);
        setAgeRange(onboardingRecord.ageRange);
        setPrimaryGoal(onboardingRecord.primaryGoal);
        setMonthlyContribution(String(onboardingRecord.monthlyContribution));
        setTargetHorizonYears(String(onboardingRecord.targetHorizonYears));
        setRiskLevel(onboardingRecord.riskLevel);
        setStrategyMode(onboardingRecord.strategyMode);

      } catch (error) {
        hydrateOnboardingDraft(currentUser);
        setStatusMessage(getFirebaseErrorMessage(error, 'Using local onboarding defaults until Firebase profile access is available.'));
      } finally {
        setIsProfileLoading(false);
      }
    };

    loadUserProfile();
  }, [currentUser]);

  useEffect(() => {
    const loadSimulations = async () => {
      if (!currentUser || !appDb) {
        setRecentSimulations([]);
        return;
      }

      try {
        const simulationCollection = query(
          collection(appDb, 'users', currentUser.uid, 'simulations'),
          orderBy('createdAt', 'desc'),
          limit(3),
        );

        const simulationSnapshots = await getDocs(simulationCollection);
        setRecentSimulations(
          simulationSnapshots.docs.map((snapshot) => ({
            id: snapshot.id,
            ...(snapshot.data() as Omit<SimulationRecord, 'id'>),
          })),
        );
      } catch (error) {
        setRecentSimulations([]);
        setStatusMessage(getFirebaseErrorMessage(error, 'Could not load saved simulations from Firestore.'));
      }
    };

    loadSimulations();
  }, [currentUser, profile]);

  useEffect(() => {
    if (!currentUser || view !== 'dashboard') {
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;

    const loadMarketFeed = async () => {
      setMarketFeedState('loading');

      try {
        const feed = await fetchPolymarketMarketFeed(controller.signal);

        if (!isCurrent) {
          return;
        }

        setMarketSources(feed.sources);
        setMarketFeedUpdatedAt(feed.generatedAt);

        const sourceByKey = Object.fromEntries(feed.sources.map((source) => [source.key, source] as const));
        setRecessionProbability(Math.round((sourceByKey.recession?.probability ?? DEFAULT_MARKET_VALUES.recessionProbability / 100) * 100));
        setRateCutProbability(Math.round((sourceByKey.rateCuts?.probability ?? DEFAULT_MARKET_VALUES.rateCutProbability / 100) * 100));
        setSpUpProbability(Math.round((sourceByKey.sp500?.probability ?? DEFAULT_MARKET_VALUES.spUpProbability / 100) * 100));

        setMarketFeedState(feed.sources.some((source) => source.status === 'fallback') ? 'degraded' : 'ready');
      } catch {
        if (!isCurrent) {
          return;
        }

        setMarketFeedState('error');
      }
    };

    loadMarketFeed();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [currentUser, view, marketRefreshNonce]);

  useEffect(() => {
    if (!currentUser || view !== 'dashboard') {
      setBackendSimulation(null);
      setBackendSimulationState('idle');
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;

    const syncBackendSimulation = async () => {
      setBackendSimulationState('loading');

      try {
        const response = await fetchSimulation(simulationRequest, controller.signal);

        if (!isCurrent) {
          return;
        }

        setBackendSimulation(response);
        setBackendSimulationState('ready');
      } catch {
        if (!isCurrent) {
          return;
        }

        setBackendSimulation(null);
        setBackendSimulationState('fallback');
      }
    };

    syncBackendSimulation();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [currentUser, simulationRequest, view]);

  const resetMessages = () => {
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const validateInputs = () => {
    if (!email.trim() || !password.trim()) {
      return 'Email and password are required.';
    }

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return 'Use a valid email address format.';
    }

    if (isSignUp) {
      if (name.trim().length < 2) {
        return 'Name must contain at least 2 characters.';
      }

      if (password.length < 6) {
        return 'Password must be at least 6 characters long.';
      }

      if (password !== confirmPassword) {
        return 'Password and confirm password must match.';
      }
    }

    return null;
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!appAuth || !hasValidConfig) {
      setErrorMessage('Firebase is not configured yet. Add VITE_FIREBASE_* values to run auth.');
      return;
    }

    const validationError = validateInputs();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(appAuth, email.trim(), password);

        if (name.trim()) {
          await updateProfile(userCredential.user, { displayName: name.trim() });
        }

        if (appDb) {
          await setDoc(
            doc(appDb, 'users', userCredential.user.uid),
            {
              displayName: name.trim() || userCredential.user.displayName || userCredential.user.email?.split('@')[0] || 'Wealth Horizon User',
              email: userCredential.user.email,
              ageRange: DEFAULT_ONBOARDING.ageRange,
              primaryGoal: DEFAULT_ONBOARDING.primaryGoal,
              monthlyContribution: DEFAULT_ONBOARDING.monthlyContribution,
              targetHorizonYears: DEFAULT_ONBOARDING.targetHorizonYears,
              riskLevel: DEFAULT_ONBOARDING.riskLevel,
              strategyMode: DEFAULT_ONBOARDING.strategyMode,
              onboardingComplete: false,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }

        setStatusMessage('Account created. Continue to onboarding to personalize your simulation engine.');
      } else {
        await signInWithEmailAndPassword(appAuth, email.trim(), password);
        setStatusMessage('Sign in successful. Loading your online profile from Firebase.');
      }

      resetForm();
    } catch (error) {
      const authError = error as { code?: string };
      const message = (authError.code && FIREBASE_ERROR_MESSAGES[authError.code]) || 'Authentication failed. Try again.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    if (!appAuth) {
      return;
    }

    resetMessages();
    setProfile(null);
    setRecentSimulations([]);
    setBackendSimulation(null);
    setBackendSimulationState('idle');
    setShareStatus(null);
    setSharedSimulation(null);
    setOnboardingStep(1);
    await signOut(appAuth);
    setStatusMessage('Signed out successfully.');
  };

  const validateOnboardingStep = () => {
    if (onboardingStep === 1) {
      if (onboardingName.trim().length < 2) {
        return 'Display name must contain at least 2 characters.';
      }

      if (primaryGoal.trim().length < 3) {
        return 'Primary goal must contain at least 3 characters.';
      }
    }

    if (onboardingStep === 2) {
      const monthly = Number(monthlyContribution);
      const horizon = Number(targetHorizonYears);

      if (!Number.isFinite(monthly) || monthly <= 0) {
        return 'Monthly contribution must be greater than 0.';
      }

      if (!Number.isFinite(horizon) || horizon < 3 || horizon > 45) {
        return 'Target horizon must be between 3 and 45 years.';
      }
    }

    return null;
  };

  const saveOnboardingToFirebase = async () => {
    if (!currentUser || !appDb) {
      throw new Error('Missing Firebase session.');
    }

    const cleanName = onboardingName.trim() || currentUser.displayName || 'Wealth Horizon User';
    const payload: Omit<OnboardingData, 'createdAt' | 'updatedAt'> = {
      displayName: cleanName,
      ageRange,
      primaryGoal: primaryGoal.trim() || DEFAULT_ONBOARDING.primaryGoal,
      monthlyContribution: Number(monthlyContribution),
      targetHorizonYears: Number(targetHorizonYears),
      riskLevel,
      strategyMode,
    };

    await setDoc(
      doc(appDb, 'users', currentUser.uid),
      {
        ...payload,
        email: currentUser.email,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );

    if (currentUser.displayName !== cleanName) {
      await updateProfile(currentUser, { displayName: cleanName });
    }

    setProfile(payload);
  };

  const handleOnboardingNext = async () => {
    resetMessages();

    const validationError = validateOnboardingStep();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    if (onboardingStep < 3) {
      setOnboardingStep((currentStep) => (currentStep + 1) as OnboardingStep);
      return;
    }

    setIsOnboardingSaving(true);
    try {
      await saveOnboardingToFirebase();
      setStatusMessage('Onboarding saved to online Firebase successfully.');
      setOnboardingStep(1);
    } catch (error) {
      setErrorMessage(getFirebaseErrorMessage(error, 'Could not save onboarding to Firebase. Check Firestore rules and try again.'));
    } finally {
      setIsOnboardingSaving(false);
    }
  };

  const handleOnboardingBack = () => {
    resetMessages();
    setOnboardingStep((currentStep) => Math.max(1, currentStep - 1) as OnboardingStep);
  };

  const saveSimulationSnapshot = async () => {
    if (!currentUser || !appDb) {
      throw new Error('Firebase is not ready.');
    }

    const simulationSnapshot = activeSimulation;
    const simulationId = `simulation-${Date.now()}`;

    const simulationDoc = doc(appDb, 'users', currentUser.uid, 'simulations', simulationId);
    await setDoc(simulationDoc, {
      shareUrl,
      shareToken,
      snapshot: simulationSnapshot,
      source: backendSimulationState,
      createdAt: serverTimestamp(),
    });

    setStatusMessage('Simulation snapshot saved to Firestore.');
  };

  const handleSaveSimulation = async () => {
    resetMessages();
    setIsSimulationSaving(true);

    try {
      await saveSimulationSnapshot();
    } catch (error) {
      setErrorMessage(getFirebaseErrorMessage(error, 'Could not save simulation snapshot to Firestore. Check Firestore rules and try again.'));
    } finally {
      setIsSimulationSaving(false);
    }
  };

  const handleDownloadSimulation = () => {
    resetMessages();

    const blob = new Blob([JSON.stringify(activeSimulation, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `wealth-horizon-simulation-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
    setStatusMessage('Simulation JSON exported locally.');
  };

  const handleCopyShareLink = async () => {
    resetMessages();

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus('Share link copied to clipboard.');
    } catch {
      setShareStatus('Copy failed. You can use the share URL shown in the browser address bar.');
    }
  };

  const handleCopySummary = async () => {
    resetMessages();

    const summary = [
      `Wealth Horizon simulation for ${activeSimulation.displayName}`,
      `Preferred return: ${(activeSimulation.outputs.preferredReturn * 100).toFixed(2)}%`,
      `Projected final balance: $${activeSimulation.outputs.projectedFinalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `Time horizon: ${activeSimulation.targetHorizonYears} years`,
      `Risk profile: ${RISK_LABELS[activeSimulation.riskLevel]}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setShareStatus('Simulation summary copied to clipboard.');
    } catch {
      setShareStatus('Could not copy the summary automatically.');
    }
  };

  const refreshMarketFeed = () => {
    resetMessages();
    setMarketRefreshNonce((currentNonce) => currentNonce + 1);
  };

  const handleThemeToggle = () => {
    setThemeMode((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  };

  if (!isAuthReady) {
    return (
      <div className="app-shell">
        <main className="single-column">
          <section className="surface-card">
            <h1>Initializing Wealth Horizon</h1>
            <p>Connecting to Firebase...</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="grain-overlay" aria-hidden="true" />

      <header className="app-header">
        <div className="app-header__top">
          <p className="eyebrow">Wealth Horizon</p>
          <button className="theme-toggle" type="button" onClick={handleThemeToggle}>
            {themeMode === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </button>
        </div>
        <h1>{view === 'auth' ? 'Secure access for your financial workspace' : 'Forward-looking wealth simulator'}</h1>
        <p>
          {view === 'auth'
            ? 'Sign in or create an account with Firebase Authentication.'
            : 'Market-aware scenarios, probability-weighted outcomes, and strategy comparison in one simulator.'}
        </p>
      </header>

      {view === 'auth' && (
        <main className="layout-grid">
          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-card__top">
              <h2 id="auth-title">Authentication</h2>
              <span className="status-chip">Online Firebase</span>
            </div>

            {!hasValidConfig && (
              <div className="alert alert--error" role="alert">
                Missing Firebase environment variables: {firebaseConfigStatus.missing.join(', ')}
              </div>
            )}

            {statusMessage && (
              <div className="alert alert--success" role="status">
                {statusMessage}
              </div>
            )}

            {errorMessage && (
              <div className="alert alert--error" role="alert">
                {errorMessage}
              </div>
            )}

            <div className="mode-switch" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={`mode-switch__item ${mode === 'signin' ? 'is-active' : ''}`}
                onClick={() => {
                  resetMessages();
                  setMode('signin');
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`mode-switch__item ${mode === 'signup' ? 'is-active' : ''}`}
                onClick={() => {
                  resetMessages();
                  setMode('signup');
                }}
              >
                Sign up
              </button>
            </div>

            <form className="auth-form" onSubmit={handleAuthSubmit} noValidate>
              {isSignUp && (
                <label>
                  <span>Full name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder="Ava Carter"
                  />
                </label>
              )}

              <label>
                <span>Email address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>

              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  placeholder="Enter your password"
                />
              </label>

              {isSignUp && (
                <label>
                  <span>Confirm password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Confirm your password"
                  />
                </label>
              )}

              <button className="button button--primary" type="submit" disabled={isSubmitting || !hasValidConfig}>
                {isSubmitting ? 'Processing...' : isSignUp ? 'Create account' : 'Sign in'}
              </button>
            </form>
          </section>

          <aside className="insight-card" aria-label="Security and setup details">
            <h2>What happens next</h2>
            <ul>
              <li>Create account with Firebase Authentication</li>
              <li>Complete onboarding right after account creation</li>
              <li>Persist onboarding profile in online Firestore</li>
              <li>Save simulation snapshots directly in Firestore</li>
            </ul>

            <div className="meta-block">
              <p className="meta-block__label">Level 1</p>
              <p>Use Polymarket probabilities to shift expected returns and scenario assumptions.</p>
            </div>

            <div className="meta-block">
              <p className="meta-block__label">Level 2</p>
              <p>Build weighted scenarios such as rate cuts and S&P trends and aggregate outcomes.</p>
            </div>

            <div className="meta-block">
              <p className="meta-block__label">Level 3</p>
              <p>Compare historical averages against market-implied probability models.</p>
            </div>
          </aside>
        </main>
      )}

      {view === 'onboarding' && (
        <main className="single-column">
          <section className="surface-card">
            <div className="auth-card__top">
              <div>
                <h2>Welcome onboarding</h2>
                <p className="muted-copy">Step {onboardingStep} of 3</p>
              </div>
              <span className="status-chip">{ONBOARDING_STEPS[onboardingStep - 1].title}</span>
            </div>

            <div className="progress-shell" aria-label="Onboarding progress">
              <div className="progress-track">
                <span style={{ width: `${(onboardingStep / 3) * 100}%` }} />
              </div>
              <p className="muted-copy">{ONBOARDING_STEPS[onboardingStep - 1].description}</p>
            </div>

            {isProfileLoading && <p className="muted-copy">Loading profile...</p>}

            {statusMessage && (
              <div className="alert alert--success" role="status">
                {statusMessage}
              </div>
            )}

            {errorMessage && (
              <div className="alert alert--error" role="alert">
                {errorMessage}
              </div>
            )}

            <form className="onboarding-form" onSubmit={(event) => event.preventDefault()}>
              {onboardingStep === 1 && (
                <>
                  <label>
                    <span>Display name</span>
                    <input
                      type="text"
                      value={onboardingName}
                      onChange={(event) => setOnboardingName(event.target.value)}
                      placeholder="Your name"
                    />
                  </label>

                  <label>
                    <span>Primary goal</span>
                    <input
                      type="text"
                      value={primaryGoal}
                      onChange={(event) => setPrimaryGoal(event.target.value)}
                      placeholder="Financial independence"
                    />
                  </label>
                </>
              )}

              {onboardingStep === 2 && (
                <>
                  <label>
                    <span>Age range</span>
                    <select value={ageRange} onChange={(event) => setAgeRange(event.target.value)}>
                      <option value="18-25">18-25</option>
                      <option value="26-35">26-35</option>
                      <option value="36-45">36-45</option>
                      <option value="46-60">46-60</option>
                      <option value="61+">61+</option>
                    </select>
                  </label>

                  <label>
                    <span>Monthly contribution (USD)</span>
                    <input
                      type="number"
                      min={50}
                      step={50}
                      value={monthlyContribution}
                      onChange={(event) => setMonthlyContribution(event.target.value)}
                    />
                  </label>

                  <label>
                    <span>Target horizon (years)</span>
                    <input
                      type="number"
                      min={3}
                      max={45}
                      value={targetHorizonYears}
                      onChange={(event) => setTargetHorizonYears(event.target.value)}
                    />
                  </label>
                </>
              )}

              {onboardingStep === 3 && (
                <>
                  <label>
                    <span>Risk profile</span>
                    <select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as RiskLevel)}>
                      <option value="conservative">Conservative</option>
                      <option value="balanced">Balanced</option>
                      <option value="growth">Growth</option>
                    </select>
                  </label>

                  <label>
                    <span>Default strategy mode</span>
                    <select value={strategyMode} onChange={(event) => setStrategyMode(event.target.value as StrategyMode)}>
                      <option value="compare-both">Compare both</option>
                      <option value="market-probabilities">Market probabilities</option>
                      <option value="historical-average">Historical average</option>
                    </select>
                  </label>
                </>
              )}

              <div className="button-row">
                {onboardingStep > 1 && (
                  <button className="button button--secondary" type="button" onClick={handleOnboardingBack}>
                    Back
                  </button>
                )}

                <button className="button button--primary" type="button" onClick={handleOnboardingNext} disabled={isOnboardingSaving}>
                  {isOnboardingSaving ? 'Saving...' : onboardingStep === 3 ? 'Finish onboarding' : 'Continue'}
                </button>

                <button className="button button--secondary" type="button" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </form>
          </section>
        </main>
      )}

      {view === 'dashboard' && profile && (
        <main className="dashboard-stack">
          <section className="surface-card surface-card--hero">
            <div className="dashboard-top">
              <div>
                <p className="eyebrow">Signed in as {effectiveDisplayName}</p>
                <h2>Probability-driven portfolio simulator</h2>
                <p className="muted-copy">
                  Preferred mode: {STRATEGY_LABELS[profile.strategyMode]} | Risk: {RISK_LABELS[profile.riskLevel]} | Goal: {profile.primaryGoal}
                </p>
              </div>
              <div className="button-row">
                <span className="status-chip status-chip--muted">{backendStatusLabel}</span>
                <button className="button button--secondary" type="button" onClick={handleDownloadSimulation}>
                  Download JSON
                </button>
                <button className="button button--secondary" type="button" onClick={handleCopyShareLink}>
                  Copy share link
                </button>
                <button className="button button--secondary" type="button" onClick={handleCopySummary}>
                  Copy summary
                </button>
                <button className="button button--secondary" type="button" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            </div>

            {shareStatus && (
              <div className="alert alert--success" role="status">
                {shareStatus}
              </div>
            )}

            <div className="metric-grid">
              <article>
                <p>Expected annual return</p>
                <strong>{(activeSimulation.outputs.preferredReturn * 100).toFixed(2)}%</strong>
              </article>
              <article>
                <p>Monthly contribution</p>
                <strong>${activeSimulation.monthlyContribution.toLocaleString()}</strong>
              </article>
              <article>
                <p>Time horizon</p>
                <strong>{activeSimulation.targetHorizonYears} years</strong>
              </article>
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <h3>Simulation engine levels</h3>
              <p>Built from your roadmap: market probabilities, weighted scenarios, and strategy comparison.</p>
            </div>

            <div className="level-grid">
              <article>
                <h4>Level 1: Probability pull</h4>
                <p>
                  Pull probabilities from Polymarket and shift expected return when recession risk rises. Use all relevant markets
                  to keep assumptions forward-looking.
                </p>
                <strong>{(activeSimulation.outputs.level1ExpectedReturn * 100).toFixed(2)}% expected return</strong>
              </article>

              <article>
                <h4>Level 2: Scenario weighting</h4>
                <p>
                  Build weighted scenarios such as rate cuts and S&P direction, then aggregate the outcomes from both scenario views.
                </p>
                <strong>{(activeSimulation.outputs.level2WeightedReturn * 100).toFixed(2)}% weighted return</strong>
              </article>

              <article>
                <h4>Level 3: Compare paradigms</h4>
                <p>
                  Compare historical averages against market-implied probability models. The default view is compare-both.
                </p>
                <strong>
                  {activeSimulation.outputs.marketProbabilityReturn - activeSimulation.outputs.historicalAverageReturn >= 0 ? '+' : ''}
                  {((activeSimulation.outputs.marketProbabilityReturn - activeSimulation.outputs.historicalAverageReturn) * 100).toFixed(2)}% delta vs historical
                </strong>
              </article>
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <h3>Scenario controls</h3>
              <p>Live Polymarket market probabilities seed the three-level engine, and you can still fine-tune the inputs below.</p>
            </div>

            <div className="market-feed-banner">
              <div>
                <p className="meta-block__label">Polymarket feed</p>
                <h4>Live market inputs</h4>
                <p className="muted-copy">
                  {marketFeedState === 'loading' && 'Loading the latest market data from Gamma...'}
                  {marketFeedState === 'ready' && 'All three market feeds are live and seeded into the simulator.'}
                  {marketFeedState === 'degraded' && 'Some feeds fell back to manual defaults, but the live markets still seeded the engine.'}
                  {marketFeedState === 'error' && 'Unable to reach the live feed right now. Manual values remain available.'}
                  {marketFeedState === 'idle' && 'Waiting for the live market feed to load.'}
                </p>
              </div>

              <div className="button-row">
                {marketFeedUpdatedAt && (
                  <span className="status-chip status-chip--muted">
                    Updated {new Date(marketFeedUpdatedAt).toLocaleTimeString()}
                  </span>
                )}
                <button className="button button--secondary" type="button" onClick={refreshMarketFeed} disabled={marketFeedState === 'loading'}>
                  {marketFeedState === 'loading' ? 'Refreshing...' : 'Refresh live feed'}
                </button>
              </div>
            </div>

            <div className="market-feed-grid">
              {marketSources.length === 0 ? (
                <article className="market-feed-card market-feed-card--empty">
                  <p className="muted-copy">Live market sources will appear here once the feed loads.</p>
                </article>
              ) : (
                marketSources.map((source) => (
                  <article key={source.key} className={`market-feed-card ${source.status === 'fallback' ? 'market-feed-card--fallback' : ''}`}>
                    <div className="market-feed-card__top">
                      <p className="meta-block__label">{source.label}</p>
                      <span className={`status-chip ${source.status === 'live' ? 'status-chip--live' : 'status-chip--muted'}`}>
                        {source.status === 'live' ? 'Live' : 'Fallback'}
                      </span>
                    </div>

                    <strong>{(source.probability * 100).toFixed(1)}%</strong>
                    <p className="muted-copy">{source.marketTitle}</p>
                    <p className="market-feed-card__meta">
                      {source.slug ? `Slug: ${source.slug}` : 'Manual default source'}
                      {source.liquidity > 0 ? ` • Liquidity ${source.liquidity.toLocaleString()}` : ''}
                    </p>
                  </article>
                ))
              )}
            </div>

            <div className="slider-grid">
              <label>
                <span>Recession probability ({recessionProbability}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={recessionProbability}
                  onChange={(event) => setRecessionProbability(Number(event.target.value))}
                />
              </label>

              <label>
                <span>Rate cut probability ({rateCutProbability}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={rateCutProbability}
                  onChange={(event) => setRateCutProbability(Number(event.target.value))}
                />
              </label>

              <label>
                <span>S&P positive year probability ({spUpProbability}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={spUpProbability}
                  onChange={(event) => setSpUpProbability(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="compare-grid">
              <article>
                <p>Historical average model</p>
                <strong>{(activeSimulation.outputs.historicalAverageReturn * 100).toFixed(2)}%</strong>
              </article>
              <article>
                <p>Market probability model</p>
                <strong>{(activeSimulation.outputs.marketProbabilityReturn * 100).toFixed(2)}%</strong>
              </article>
              <article>
                <p>Current strategy mode</p>
                <strong>{STRATEGY_LABELS[activeSimulation.strategyMode]}</strong>
              </article>
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <h3>Projection curve</h3>
              <p>Visualized ending balance for each year in the active simulation. The backend response is used when available.</p>
            </div>

            <div className="projection-layout">
              <div className="projection-chart" aria-label="Projected balance chart">
                <svg viewBox="0 0 640 240" role="img" aria-labelledby="projection-title projection-desc">
                  <title id="projection-title">Projected balance line chart</title>
                  <desc id="projection-desc">Annual projected ending balance, contribution growth, and gains over the target horizon.</desc>
                  <line x1="0" y1="220" x2="640" y2="220" className="projection-chart__baseline" />
                  <polyline points={chartLinePoints} className="projection-chart__line" />
                  {chartSeries.map((point) => (
                    <circle key={point.year} cx={point.x} cy={point.y} r="4" className="projection-chart__dot" />
                  ))}
                </svg>
              </div>

              <div className="projection-summary">
                <article>
                  <p>Projected final balance</p>
                  <strong>${activeSimulation.outputs.projectedFinalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </article>
                <article>
                  <p>Total contributions</p>
                  <strong>${activeSimulation.outputs.totalContributions.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </article>
                <article>
                  <p>Projected gain</p>
                  <strong>${activeSimulation.outputs.projectedGain.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </article>
                <article>
                  <p>Latest year</p>
                  <strong>{chartProjection.at(-1)?.year ?? activeSimulation.targetHorizonYears}</strong>
                </article>
              </div>
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <h3>Saved simulations</h3>
              <p>Snapshots are stored directly in Firestore under users/{'{uid}'}/simulations.</p>
            </div>

            <div className="button-row">
              <button className="button button--primary" type="button" onClick={handleSaveSimulation} disabled={isSimulationSaving}>
                {isSimulationSaving ? 'Saving...' : 'Save current simulation'}
              </button>
            </div>

            <div className="recent-list">
              {recentSimulations.length === 0 ? (
                <p className="muted-copy">No saved simulations yet.</p>
              ) : (
                recentSimulations.map((simulation) => (
                  <article key={simulation.id} className="recent-list__item">
                    <div>
                      <strong>{simulation.snapshot?.displayName || 'Simulation run'}</strong>
                      <p className="muted-copy">
                        {simulation.snapshot?.marketProbabilities.recessionProbability ?? 0}% recession |{' '}
                        {simulation.snapshot?.outputs.preferredReturn ? (simulation.snapshot.outputs.preferredReturn * 100).toFixed(2) : '0.00'}% return |{' '}
                        ${simulation.snapshot?.outputs.projectedFinalBalance ? simulation.snapshot.outputs.projectedFinalBalance.toLocaleString() : '0'} projected
                      </p>
                    </div>
                    <div className="recent-list__actions">
                      {simulation.snapshot?.shareToken && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(simulation.snapshot?.shareToken || '')}`);
                              setShareStatus('Saved simulation share link copied to clipboard.');
                            } catch {
                              setShareStatus('Could not copy the saved simulation link.');
                            }
                          }}
                        >
                          Copy share link
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;