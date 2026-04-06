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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { appAuth, appDb, appStorage, firebaseConfigStatus } from './firebase';

type AuthMode = 'signin' | 'signup';
type RiskLevel = 'conservative' | 'balanced' | 'growth';
type StrategyMode = 'market-probabilities' | 'historical-average' | 'compare-both';
type OnboardingStep = 1 | 2 | 3;

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
  downloadUrl?: string;
  storagePath?: string;
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
    level1ExpectedReturn: number;
    level2WeightedReturn: number;
    historicalAverageReturn: number;
    marketProbabilityReturn: number;
    preferredReturn: number;
  };
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

const RISK_BASE_RETURN: Record<RiskLevel, number> = {
  conservative: 0.056,
  balanced: 0.074,
  growth: 0.094,
};

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

function App() {
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
  const [rateCutProbability, setRateCutProbability] = useState(58);
  const [spUpProbability, setSpUpProbability] = useState(54);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSavedSnapshotUrl, setLastSavedSnapshotUrl] = useState<string | null>(null);

  const isSignUp = mode === 'signup';

  const hasValidConfig = useMemo(
    () => firebaseConfigStatus.isValid && appAuth !== null && appDb !== null && appStorage !== null,
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
    if (profile?.displayName) {
      return profile.displayName;
    }

    return currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Investor';
  }, [currentUser, profile]);

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

    const regimeReturns = {
      recession: baseReturn - 0.045,
      disinflation: baseReturn + 0.012,
      riskOn: baseReturn + 0.025,
    };

    const weighted =
      recession * regimeReturns.recession +
      rateCuts * (1 - recession) * regimeReturns.disinflation +
      spUp * regimeReturns.riskOn +
      (1 - spUp) * (baseReturn - 0.012);

    return Math.max(weighted, 0.01);
  }, [baseReturn, recessionProbability, rateCutProbability, spUpProbability]);

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
    const profileStrategy = profile?.strategyMode || strategyMode;

    if (profileStrategy === 'historical-average') {
      return level3Comparison.historical;
    }

    if (profileStrategy === 'market-probabilities') {
      return level3Comparison.marketForward;
    }

    return (level3Comparison.historical + level3Comparison.marketForward) / 2;
  }, [profile?.strategyMode, strategyMode, level3Comparison]);

  const snapshotPayload = useMemo<SimulationSnapshot>(
    () => ({
      generatedAt: new Date().toISOString(),
      displayName: effectiveDisplayName,
      ageRange: profile?.ageRange || ageRange,
      primaryGoal: profile?.primaryGoal || primaryGoal,
      monthlyContribution: Number(profile?.monthlyContribution || monthlyContribution),
      targetHorizonYears: Number(profile?.targetHorizonYears || targetHorizonYears),
      riskLevel: profile?.riskLevel || riskLevel,
      strategyMode: profile?.strategyMode || strategyMode,
      marketProbabilities: {
        recessionProbability,
        rateCutProbability,
        spUpProbability,
      },
      outputs: {
        level1ExpectedReturn,
        level2WeightedReturn,
        historicalAverageReturn: level3Comparison.historical,
        marketProbabilityReturn: level3Comparison.marketForward,
        preferredReturn,
      },
    }),
    [
      ageRange,
      effectiveDisplayName,
      level1ExpectedReturn,
      level2WeightedReturn,
      level3Comparison.historical,
      level3Comparison.marketForward,
      monthlyContribution,
      preferredReturn,
      primaryGoal,
      profile,
      rateCutProbability,
      recessionProbability,
      riskLevel,
      spUpProbability,
      strategyMode,
      targetHorizonYears,
    ],
  );

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
          setProfile(null);
          setOnboardingName(currentUser.displayName || currentUser.email?.split('@')[0] || '');
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

      } catch {
        setErrorMessage('Could not load onboarding profile from Firebase.');
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
      } catch {
        setRecentSimulations([]);
      }
    };

    loadSimulations();
  }, [currentUser, profile]);

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
    } catch {
      setErrorMessage('Could not save onboarding to Firebase. Check Firestore rules and try again.');
    } finally {
      setIsOnboardingSaving(false);
    }
  };

  const handleOnboardingBack = () => {
    resetMessages();
    setOnboardingStep((currentStep) => Math.max(1, currentStep - 1) as OnboardingStep);
  };

  const saveSimulationSnapshot = async () => {
    if (!currentUser || !appDb || !appStorage) {
      throw new Error('Firebase is not ready.');
    }

    const simulationId = `simulation-${Date.now()}`;
    const storagePath = `users/${currentUser.uid}/simulations/${simulationId}.json`;
    const fileRef = ref(appStorage, storagePath);
    const blob = new Blob([JSON.stringify(snapshotPayload, null, 2)], { type: 'application/json' });

    await uploadBytes(fileRef, blob, { contentType: 'application/json' });
    const downloadUrl = await getDownloadURL(fileRef);

    const simulationDoc = doc(appDb, 'users', currentUser.uid, 'simulations', simulationId);
    await setDoc(simulationDoc, {
      storagePath,
      downloadUrl,
      snapshot: snapshotPayload,
      createdAt: serverTimestamp(),
    });

    setLastSavedSnapshotUrl(downloadUrl);
    setStatusMessage('Simulation snapshot saved to Firebase Storage and Firestore.');
  };

  const handleSaveSimulation = async () => {
    resetMessages();
    setIsSimulationSaving(true);

    try {
      await saveSimulationSnapshot();
    } catch {
      setErrorMessage('Could not save simulation snapshot to Firebase Storage. Check bucket permissions.');
    } finally {
      setIsSimulationSaving(false);
    }
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
        <p className="eyebrow">Wealth Horizon</p>
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
              <li>Save simulation snapshots to Firebase Storage</li>
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
              <button className="button button--secondary" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>

            <div className="metric-grid">
              <article>
                <p>Expected annual return</p>
                <strong>{(preferredReturn * 100).toFixed(2)}%</strong>
              </article>
              <article>
                <p>Monthly contribution</p>
                <strong>${profile.monthlyContribution.toLocaleString()}</strong>
              </article>
              <article>
                <p>Time horizon</p>
                <strong>{profile.targetHorizonYears} years</strong>
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
                <strong>{(level1ExpectedReturn * 100).toFixed(2)}% expected return</strong>
              </article>

              <article>
                <h4>Level 2: Scenario weighting</h4>
                <p>
                  Build weighted scenarios such as rate cuts and S&P direction, then aggregate the outcomes from both scenario views.
                </p>
                <strong>{(level2WeightedReturn * 100).toFixed(2)}% weighted return</strong>
              </article>

              <article>
                <h4>Level 3: Compare paradigms</h4>
                <p>
                  Compare historical averages against market-implied probability models. The default view is compare-both.
                </p>
                <strong>
                  {level3Comparison.delta >= 0 ? '+' : ''}
                  {(level3Comparison.delta * 100).toFixed(2)}% delta vs historical
                </strong>
              </article>
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <h3>Scenario controls</h3>
              <p>These controls represent the three-level engine and can be connected to live Polymarket data later.</p>
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
                <strong>{(level3Comparison.historical * 100).toFixed(2)}%</strong>
              </article>
              <article>
                <p>Market probability model</p>
                <strong>{(level3Comparison.marketForward * 100).toFixed(2)}%</strong>
              </article>
              <article>
                <p>Current strategy mode</p>
                <strong>{STRATEGY_LABELS[profile.strategyMode]}</strong>
              </article>
            </div>
          </section>

          <section className="surface-card">
            <div className="section-heading">
              <h3>Saved simulations</h3>
              <p>Snapshots are stored in Firebase Storage and indexed in Firestore.</p>
            </div>

            <div className="button-row">
              <button className="button button--primary" type="button" onClick={handleSaveSimulation} disabled={isSimulationSaving}>
                {isSimulationSaving ? 'Saving...' : 'Save current simulation'}
              </button>
              {lastSavedSnapshotUrl && (
                <a className="button button--secondary" href={lastSavedSnapshotUrl} target="_blank" rel="noreferrer">
                  Open latest snapshot
                </a>
              )}
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
                        {simulation.snapshot?.outputs.preferredReturn ? (simulation.snapshot.outputs.preferredReturn * 100).toFixed(2) : '0.00'}% return
                      </p>
                    </div>
                    {simulation.downloadUrl && (
                      <a href={simulation.downloadUrl} target="_blank" rel="noreferrer">
                        View JSON
                      </a>
                    )}
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