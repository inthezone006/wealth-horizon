const journeySteps = [
  {
    title: 'Set the baseline',
    body: 'Capture the initial account value, regular contributions, time horizon, and expected annual return.',
  },
  {
    title: 'Shape the portfolio',
    body: 'Define a ticker and allocation mix across stocks, bonds, and ETFs to frame the simulation.',
  },
  {
    title: 'Stress the assumptions',
    body: 'Use volatility, inflation, and market scenarios to explore how resilient the plan could be.',
  },
  {
    title: 'Review the projection',
    body: 'Compare the forecast against the target wealth goal and the target age or year.',
  },
];

const guidebookItems = [
  'Mission overview and project origins',
  'How the simulator works in practice',
  'Financial concepts used in the model',
  'Examples, tools, and future improvements',
];

const portfolioLabels = ['Stocks', 'Bonds', 'ETF mix'];

const riskBands = [
  { label: 'Low', value: 28 },
  { label: 'Medium', value: 56 },
  { label: 'High', value: 82 },
];

function App() {
  return (
    <div className="app-shell">
      <div className="background-orb background-orb--one" />
      <div className="background-orb background-orb--two" />

      <header className="topbar">
        <div>
          <p className="eyebrow">WealthHorizon Simulator</p>
          <h1>Modern finance simulation, designed like a product launch.</h1>
        </div>
        <nav className="topbar__nav" aria-label="Primary">
          <a href="#guidebook">Guidebook</a>
          <a href="#simulator">Simulator</a>
          <a href="#forecast">Forecast</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">Personal finance modeling</p>
            <h2>Turn investment assumptions into a clear long-term story.</h2>
            <p className="hero__description">
              WealthHorizon helps users explore how contributions, asset allocation, market volatility, and time horizon
              influence projected wealth accumulation. The backend will stay lightweight for now while the frontend leads
              with a polished, modern experience.
            </p>

            <div className="hero__actions">
              <a className="button button--primary" href="#simulator">
                Open simulator
              </a>
              <a className="button button--secondary" href="#guidebook">
                Read the guidebook
              </a>
            </div>

            <div className="hero__stats">
              <article>
                <span>4</span>
                <p>input phases</p>
              </article>
              <article>
                <span>3</span>
                <p>risk bands</p>
              </article>
              <article>
                <span>1</span>
                <p>clean interface</p>
              </article>
            </div>
          </div>

          <aside className="hero__panel">
            <div className="panel-card panel-card--accent">
              <p className="panel-card__label">Current status</p>
              <h3>Guided input flow</h3>
              <p>Basic finance inputs, portfolio allocation, market assumptions, and target goals are presented in a single narrative.</p>
            </div>

            <div className="mini-grid">
              <article className="panel-card">
                <p className="panel-card__label">Theme</p>
                <h3>Bold fintech</h3>
              </article>
              <article className="panel-card">
                <p className="panel-card__label">Logic</p>
                <h3>Placeholder only</h3>
              </article>
            </div>
          </aside>
        </section>

        <section className="section section--guidebook" id="guidebook">
          <div className="section__header">
            <div>
              <p className="eyebrow">Project Guidebook</p>
              <h2>Reframed as a product narrative.</h2>
            </div>
            <p>
              The original content is preserved in spirit, but the presentation is cleaner, more visual, and easier to scan.
            </p>
          </div>

          <div className="feature-grid">
            <article className="feature-card feature-card--large">
              <p className="panel-card__label">Mission overview</p>
              <h3>Experiment with financial scenarios without leaving the browser.</h3>
              <p>
                The simulator will be used to compare strategies, test contribution patterns, and visualize how long-term
                planning can shape financial outcomes.
              </p>
            </article>

            <article className="feature-card">
              <p className="panel-card__label">Guidebook outline</p>
              <ul className="guidebook-list">
                {guidebookItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="section section--simulator" id="simulator">
          <div className="section__header">
            <div>
              <p className="eyebrow">Early demo framework</p>
              <h2>Input flow with room for future logic.</h2>
            </div>
            <p>
              This layout gives you a modern entry point now and a natural place to connect the Python backend later.
            </p>
          </div>

          <div className="simulator-grid">
            <section className="form-card">
              <div className="form-card__header">
                <h3>Basic inputs</h3>
                <span>Step 1 of 4</span>
              </div>

              <div className="field-grid">
                <label>
                  <span>Initial investment account</span>
                  <input type="text" placeholder="$25,000" />
                </label>
                <label>
                  <span>Monthly contribution</span>
                  <input type="text" placeholder="$500" />
                </label>
                <label>
                  <span>Investment time horizon</span>
                  <input type="text" placeholder="20 years" />
                </label>
                <label>
                  <span>Expected annual return</span>
                  <input type="text" placeholder="8%" />
                </label>
              </div>

              <div className="form-actions">
                <button type="button" className="button button--primary">
                  Submit
                </button>
                <button type="button" className="button button--secondary">
                  Clear
                </button>
              </div>

              <div className="inline-note">
                Excellent work. Basic inputs lead into the portfolio assumptions below.
              </div>

              <div className="field-grid field-grid--portfolio">
                <label>
                  <span>Stock ticker</span>
                  <input type="text" placeholder="VOO" />
                </label>
                <label className="field-grid__full">
                  <span>Portfolio allocation</span>
                </label>
                {portfolioLabels.map((label) => (
                  <label key={label}>
                    <span>{label}</span>
                    <input type="text" placeholder="33%" />
                  </label>
                ))}
              </div>

              <div className="form-actions">
                <button type="button" className="button button--primary">
                  Submit
                </button>
                <button type="button" className="button button--secondary">
                  Clear
                </button>
              </div>
            </section>

            <aside className="forecast-card" id="forecast">
              <div className="forecast-card__header">
                <div>
                  <p className="panel-card__label">Forecast canvas</p>
                  <h3>Projected wealth preview</h3>
                </div>
                <span className="forecast-pill">Placeholder</span>
              </div>

              <div className="chart-shell" aria-hidden="true">
                <div className="chart-bar chart-bar--one" />
                <div className="chart-bar chart-bar--two" />
                <div className="chart-bar chart-bar--three" />
                <div className="chart-bar chart-bar--four" />
                <div className="chart-bar chart-bar--five" />
              </div>

              <div className="forecast-metrics">
                <article>
                  <span>Target wealth</span>
                  <strong>$1.2M</strong>
                </article>
                <article>
                  <span>Target age / year</span>
                  <strong>Age 58</strong>
                </article>
                <article>
                  <span>Inflation assumption</span>
                  <strong>2.8%</strong>
                </article>
              </div>

              <div className="risk-band-list">
                <p className="panel-card__label">Market volatility</p>
                {riskBands.map((band) => (
                  <div key={band.label} className="risk-band">
                    <div className="risk-band__meta">
                      <span>{band.label}</span>
                      <strong>{band.value}%</strong>
                    </div>
                    <div className="risk-band__track">
                      <span style={{ width: `${band.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="section section--roadmap">
          <div className="section__header">
            <div>
              <p className="eyebrow">What comes next</p>
              <h2>The frontend is ready for backend integration.</h2>
            </div>
            <p>
              Once you are ready, the Python backend can compute scenarios, validate inputs, and return chart data to this UI.
            </p>
          </div>

          <div className="roadmap-grid">
            {journeySteps.map((step, index) => (
              <article key={step.title} className="roadmap-card">
                <span className="roadmap-card__index">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;