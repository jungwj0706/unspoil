import { useEffect, useState, type ReactNode } from 'react';
import { formatProgress, resolveLocale, t, type Locale, type MessageKey, type TitleState } from '@unspoil/shared';
import { api, type LiveState, type Proof, type Report, type SettingsView } from './api';

type Screen = 'home' | 'report' | 'proof' | 'settings';

export function App() {
  const [state, setState] = useState<LiveState | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [toast, setToast] = useState('');
  const [adding, setAdding] = useState(false);
  const [synopsisFor, setSynopsisFor] = useState<TitleState | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);

  const locale = resolveLocale(settings?.locale ?? state?.locale ?? 'system', navigator.language);

  useEffect(() => {
    let since = -1;
    let alive = true;
    const pull = async () => {
      try {
        const next = await api.state(since);
        if (!alive) return;
        if (!next.unchanged) {
          since = next.rev;
          setState(next);
        } else {
          setState((current) => (current ? { ...current, extensionSeenAt: next.extensionSeenAt } : current));
        }
      } catch (error) {
        if (alive) setToast(error instanceof Error ? error.message : t(locale, 'common.error'));
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void api.settings().then((value) => {
      setSettings(value);
      if (!value.hasKey) setKeyOpen(true);
    }).catch(() => undefined);
    const timer = setInterval(() => {
      void api.report().then(setReport).catch(() => undefined);
    }, 2000);
    void api.report().then(setReport).catch(() => undefined);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (screen === 'proof') void api.proof().then(setProof).catch(() => setProof({ empty: true }));
  }, [screen]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const apply = (next: LiveState) => setState(next);
  const linked = Boolean(state?.extensionSeenAt && Date.now() - state.extensionSeenAt < 4000);

  return (
    <div className="stage">
      <div className="app">
        <aside className="side">
          <div className="brand">
            <Logo />
            <div>
              <strong>{t(locale, 'app.name')}</strong>
              <span>{t(locale, 'app.tagline')}</span>
            </div>
          </div>
          <nav>
            <NavButton locale={locale} id="home" screen={screen} setScreen={setScreen} label="nav.home" />
            <NavButton locale={locale} id="report" screen={screen} setScreen={setScreen} label="nav.report" />
            <NavButton locale={locale} id="proof" screen={screen} setScreen={setScreen} label="nav.proof" />
            <NavButton locale={locale} id="settings" screen={screen} setScreen={setScreen} label="nav.settings" />
          </nav>
          <p className="version">{settings ? `${t(locale, 'settings.version')} ${settings.version}` : ''}</p>
        </aside>
        <main>
          {screen === 'home' && state && (
            <Home
              locale={locale}
              state={state}
              report={report}
              linked={linked}
              onAdd={() => setAdding(true)}
              onSettings={() => setScreen('settings')}
              onSynopsis={setSynopsisFor}
              onState={apply}
              onToast={setToast}
            />
          )}
          {screen === 'report' && <ReportScreen locale={locale} report={report} />}
          {screen === 'proof' && <ProofScreen locale={locale} proof={proof} />}
          {screen === 'settings' && settings && (
            <SettingsScreen
              locale={locale}
              settings={settings}
              onSaved={(next) => {
                setSettings(next);
                setToast(t(locale, 'settings.saved'));
              }}
              onToast={setToast}
            />
          )}
          {!state && <p className="loading">{t(locale, 'common.loading')}</p>}
        </main>
      </div>
      {adding && (
        <Modal title={t(locale, 'add.title')} onClose={() => setAdding(false)}>
          <TitleForm
            locale={locale}
            onDone={() => setAdding(false)}
            onState={apply}
            onToast={setToast}
          />
        </Modal>
      )}
      {synopsisFor && (
        <Modal title={t(locale, 'synopsis.title')} onClose={() => setSynopsisFor(null)}>
          <SynopsisForm
            locale={locale}
            title={synopsisFor}
            onDone={() => setSynopsisFor(null)}
            onState={apply}
            onToast={setToast}
          />
        </Modal>
      )}
      {keyOpen && (
        <Modal title={t(locale, 'key.title')} onClose={() => setKeyOpen(false)}>
          <KeyForm
            locale={locale}
            onDone={() => {
              setKeyOpen(false);
              void api.settings().then(setSettings);
            }}
          />
        </Modal>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavButton({
  locale,
  id,
  screen,
  setScreen,
  label,
}: {
  locale: Locale;
  id: Screen;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  label: MessageKey;
}) {
  return (
    <button className={screen === id ? 'nav active' : 'nav'} onClick={() => setScreen(id)}>
      {t(locale, label)}
    </button>
  );
}

function Home({
  locale,
  state,
  report,
  linked,
  onAdd,
  onSettings,
  onSynopsis,
  onState,
  onToast,
}: {
  locale: Locale;
  state: LiveState;
  report: Report | null;
  linked: boolean;
  onAdd: () => void;
  onSettings: () => void;
  onSynopsis: (title: TitleState) => void;
  onState: (state: LiveState) => void;
  onToast: (message: string) => void;
}) {
  const [confirmId, setConfirmId] = useState('');
  const empty = state.titles.length === 0;
  return (
    <section className="home">
      <header className="top">
        <div>
          <h1>{t(locale, 'nav.home')}</h1>
          <span className={linked ? 'chip ok' : 'chip wait'}>
            {linked ? t(locale, 'home.connected') : t(locale, 'home.waiting')}
          </span>
        </div>
        <div className="top-actions">
          <ShieldToggle
            on={state.shieldOn}
            label={t(locale, 'home.shield')}
            onChange={async (shieldOn) => {
              onState({ ...(await api.saveSettings({ shieldOn })), shieldOn });
            }}
          />
          <button className="primary" onClick={onAdd}>{t(locale, 'home.addTitle')}</button>
        </div>
      </header>
      {empty ? (
        <div className="empty">
          <p>{t(locale, 'home.empty')}</p>
          <ol className="steps">
            <li>{t(locale, 'onboard.1')}</li>
            <li>{t(locale, 'onboard.2')}</li>
            <li>{t(locale, 'onboard.3')}</li>
          </ol>
          <div className="row">
            <button className="primary giant" onClick={onAdd}>{t(locale, 'home.addTitle')}</button>
            <button className="ghost" onClick={onSettings}>{t(locale, 'onboard.settings')}</button>
            <a className="ghost" href="/demo/" target="_blank" rel="noreferrer">{t(locale, 'onboard.demo')}</a>
          </div>
        </div>
      ) : (
        <div className="grid">
          {state.titles.map((title) => (
            <article className="card" key={title.id}>
              <div className="card-top">
                <Initial name={title.name} />
                <div>
                  <h2>{title.name}</h2>
                  <p className={`memory ${title.memory}`}>{memoryText(locale, title)}</p>
                </div>
              </div>
              <Stepper
                locale={locale}
                title={title}
                onChange={async (progress) => {
                  onState({
                    ...state,
                    titles: state.titles.map((item) => (item.id === title.id ? { ...item, progress } : item)),
                  });
                  try {
                    onState(await api.progress(title.id, progress));
                  } catch (error) {
                    onToast(error instanceof Error ? error.message : t(locale, 'common.error'));
                  }
                }}
              />
              <footer>
                <span>{t(locale, 'home.blockedToday', { count: report?.perTitle[title.id] ?? 0 })}</span>
                <div className="row">
                  {title.memory === 'error' && (
                    <button onClick={() => void api.retry(title.id).then(onState)}>{t(locale, 'home.retry')}</button>
                  )}
                  {(title.memory === 'low_confidence' || title.memory === 'ready') && (
                    <button onClick={() => onSynopsis(title)}>{t(locale, 'home.addSynopsis')}</button>
                  )}
                  <button
                    onClick={async () => {
                      onState(await api.shield(title.id, !title.shieldOn));
                    }}
                  >
                    {title.shieldOn ? t(locale, 'home.shieldOn') : t(locale, 'home.shieldOff')}
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (confirmId !== title.id) {
                        setConfirmId(title.id);
                        return;
                      }
                      onState(await api.remove(title.id));
                    }}
                  >
                    {confirmId === title.id ? t(locale, 'common.deleteConfirm') : t(locale, 'home.delete')}
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function memoryText(locale: Locale, title: TitleState): string {
  const count = title.totalEpisodes ?? title.episodes.length;
  if (title.memory === 'building') return t(locale, 'memory.building');
  if (title.memory === 'error') return t(locale, 'memory.error');
  if (title.memory === 'low_confidence') return t(locale, 'memory.low');
  if (title.source === 'hybrid') return t(locale, 'memory.hybrid', { count });
  if (title.memory === 'ready') {
    return title.kind === 'event' ? t(locale, 'memory.readyEvent') : t(locale, 'memory.ready', { count });
  }
  return t(locale, 'memory.none');
}

function Stepper({
  locale,
  title,
  onChange,
}: {
  locale: Locale;
  title: TitleState;
  onChange: (progress: number) => void;
}) {
  const cap = title.kind === 'event' ? 1 : title.totalEpisodes ?? 99;
  const label = title.kind === 'event'
    ? t(locale, title.progress > 0 ? 'progress.seen' : 'progress.unseen')
    : formatProgress(locale, title.progress, title.episodes);
  return (
    <div className="stepper">
      <button aria-label="-" onClick={() => onChange(Math.max(0, title.progress - 1))}>−</button>
      <div>
        <strong>{title.kind === 'event' ? label : title.progress}</strong>
        <em>{label}</em>
      </div>
      <button aria-label="+" onClick={() => onChange(Math.min(cap, title.progress + 1))}>+</button>
    </div>
  );
}

function TitleForm({
  locale,
  onDone,
  onState,
  onToast,
}: {
  locale: Locale;
  onDone: () => void;
  onState: (state: LiveState) => void;
  onToast: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'series' | 'event'>('series');
  const [progress, setProgress] = useState(5);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          onState(await api.createTitle(name.trim(), kind, kind === 'event' ? Math.min(progress, 1) : progress));
          onDone();
        } catch (error) {
          onToast(error instanceof Error ? error.message : t(locale, 'common.error'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {t(locale, 'add.name')}
        <input
          autoFocus
          value={name}
          placeholder={t(locale, 'add.namePlaceholder')}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <div className="segment" role="group" aria-label={t(locale, 'add.kind')}>
        <button type="button" className={kind === 'series' ? 'on' : ''} onClick={() => setKind('series')}>
          {t(locale, 'add.series')}
        </button>
        <button type="button" className={kind === 'event' ? 'on' : ''} onClick={() => { setKind('event'); setProgress(0); }}>
          {t(locale, 'add.event')}
        </button>
      </div>
      <p>{t(locale, 'add.progress')}</p>
      <div className="stepper">
        <button type="button" onClick={() => setProgress((value) => Math.max(0, value - 1))}>−</button>
        <div>
          <strong>{progress}</strong>
          <em>{kind === 'event' ? t(locale, progress > 0 ? 'progress.seen' : 'progress.unseen') : t(locale, 'progress.episode', { n: progress })}</em>
        </div>
        <button type="button" onClick={() => setProgress((value) => Math.min(kind === 'event' ? 1 : 99, value + 1))}>+</button>
      </div>
      <div className="form-actions">
        <button type="button" onClick={onDone}>{t(locale, 'add.cancel')}</button>
        <button className="primary" disabled={busy || !name.trim()}>{t(locale, 'add.confirm')}</button>
      </div>
    </form>
  );
}

function SynopsisForm({
  locale,
  title,
  onDone,
  onState,
  onToast,
}: {
  locale: Locale;
  title: TitleState;
  onDone: () => void;
  onState: (state: LiveState) => void;
  onToast: (message: string) => void;
}) {
  const [ordinal, setOrdinal] = useState(Math.max(1, title.progress || 1));
  const [text, setText] = useState('');
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          onState(await api.synopsis(title.id, ordinal, text));
          onDone();
        } catch (error) {
          onToast(error instanceof Error ? error.message : t(locale, 'common.error'));
        }
      }}
    >
      <p className="hint">{t(locale, 'synopsis.hint')}</p>
      <label>
        {t(locale, 'synopsis.episode')}
        <input type="number" min={1} value={ordinal} onChange={(event) => setOrdinal(Number(event.target.value))} />
      </label>
      <textarea
        maxLength={2000}
        required
        placeholder={t(locale, 'synopsis.placeholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button className="primary">{t(locale, 'synopsis.save')}</button>
    </form>
  );
}

function KeyForm({ locale, onDone }: { locale: Locale; onDone: () => void }) {
  const [apiKey, setApiKey] = useState('');
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        await api.saveSettings({ apiKey });
        onDone();
      }}
    >
      <p className="hint">{t(locale, 'key.body')}</p>
      <input
        autoFocus
        type="password"
        placeholder={t(locale, 'key.placeholder')}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        required
      />
      <div className="form-actions">
        <button type="button" onClick={onDone}>{t(locale, 'onboarding.skip')}</button>
        <button className="primary">{t(locale, 'key.save')}</button>
      </div>
    </form>
  );
}

function ReportScreen({ locale, report }: { locale: Locale; report: Report | null }) {
  const cards: Array<[MessageKey, string]> = report
    ? [
        ['report.blocked', String(report.blocked)],
        ['report.shown', String(report.shown)],
        ['report.wrong', String(report.reportedWrong)],
        ['report.cache', `${Math.round(report.cacheHitRate * 100)}%`],
        ['report.p50', report.latencyP50 === null ? '—' : `${report.latencyP50} ms`],
        ['report.cost', `$${report.costPerThousand.toFixed(4)}`],
        ['report.titles', String(report.titlesToday)],
      ]
    : [];
  return (
    <section className="panel">
      <h1>{t(locale, 'nav.report')}</h1>
      <div className="stats">
        {cards.map(([key, value]) => (
          <article key={key}>
            <span>{t(locale, key)}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <h2>{t(locale, 'report.recent')}</h2>
      <p className="hint">{t(locale, 'report.note')}</p>
      {!report || report.events.length === 0 ? (
        <p className="empty-copy">{t(locale, 'report.empty')}</p>
      ) : (
        <ul className="events">
          {report.events.map((event, index) => (
            <li key={`${event.ts}-${index}`}>
              <time>{new Date(event.ts).toLocaleTimeString()}</time>
              <span>{event.host}</span>
              <span>{event.titleName ?? '—'}</span>
              <span>{t(locale, `decision.${event.decision}` as MessageKey)}</span>
              <span>{event.reason ? t(locale, `reason.${event.reason}` as MessageKey) : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProofScreen({ locale, proof }: { locale: Locale; proof: Proof | null }) {
  return (
    <section className="panel">
      <h1>{t(locale, 'proof.title')}</h1>
      <p className="hint">{proof?.note || t(locale, 'proof.note')}</p>
      {!proof || proof.empty || !proof.rows?.length ? (
        <p className="empty-copy">{t(locale, 'proof.empty')}</p>
      ) : (
        <>
          {proof.generatedAt && <p className="hint">{t(locale, 'proof.ran', { time: new Date(proof.generatedAt).toLocaleString() })}</p>}
          <table>
            <thead>
              <tr>
                <th>{t(locale, 'proof.method')}</th>
                <th>{t(locale, 'proof.miss')}</th>
                <th>{t(locale, 'proof.over')}</th>
                <th>{t(locale, 'proof.d')}</th>
                <th>{t(locale, 'proof.slice')}</th>
                <th>{t(locale, 'proof.n')}</th>
              </tr>
            </thead>
            <tbody>
              {proof.rows.map((row) => (
                <tr key={`${row.method}-${row.slice}`}>
                  <td>{t(locale, row.method === 'keyword' ? 'proof.keyword' : 'proof.unspoil')}</td>
                  <td>{row.miss}/{row.missOf}</td>
                  <td>{row.over}/{row.overOf}</td>
                  <td>{row.dShown}/{row.dOf}</td>
                  <td>{t(locale, row.slice === 'all' ? 'proof.all' : 'proof.heldout')}</td>
                  <td>{row.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function SettingsScreen({
  locale,
  settings,
  onSaved,
  onToast,
}: {
  locale: Locale;
  settings: SettingsView;
  onSaved: (settings: SettingsView) => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <section className="panel">
      <h1>{t(locale, 'nav.settings')}</h1>
      <form
        className="form settings"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.saveSettings({
              locale: draft.locale,
              strictness: draft.strictness,
              provider: draft.provider,
              baseUrl: draft.baseUrl,
              model: draft.model,
              bibleModel: draft.bibleModel,
              priceInput: Number(draft.priceInput),
              priceCached: Number(draft.priceCached),
              priceOutput: Number(draft.priceOutput),
              ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            });
            setApiKey('');
            onSaved(await api.settings());
          } catch (error) {
            onToast(error instanceof Error ? error.message : t(locale, 'common.error'));
          }
        }}
      >
        <label>
          {t(locale, 'settings.locale')}
          <select value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value as SettingsView['locale'] })}>
            <option value="system">{t(locale, 'settings.localeSystem')}</option>
            <option value="ko">{t(locale, 'settings.localeKo')}</option>
            <option value="en">{t(locale, 'settings.localeEn')}</option>
          </select>
        </label>
        <label>
          {t(locale, 'settings.strictness')}
          <select value={draft.strictness} onChange={(event) => setDraft({ ...draft, strictness: event.target.value as SettingsView['strictness'] })}>
            <option value="chill">Chill</option>
            <option value="careful">Careful</option>
            <option value="paranoid">Paranoid</option>
          </select>
        </label>
        <label>
          {t(locale, 'settings.provider')}
          <input value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} />
        </label>
        <label>
          {t(locale, 'settings.baseUrl')}
          <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
        </label>
        <label>
          {t(locale, 'settings.model')}
          <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
        </label>
        <label>
          {t(locale, 'settings.bibleModel')}
          <input value={draft.bibleModel} onChange={(event) => setDraft({ ...draft, bibleModel: event.target.value })} />
        </label>
        <label>
          {t(locale, 'settings.apiKey')}
          <input type="password" placeholder={settings.keyMask || t(locale, 'key.placeholder')} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </label>
        <p className="hint">{t(locale, 'settings.keyHint')}</p>
        <div className="prices">
          <label>
            {t(locale, 'settings.priceIn')}
            <input type="number" step="0.0001" value={draft.priceInput} onChange={(event) => setDraft({ ...draft, priceInput: Number(event.target.value) })} />
          </label>
          <label>
            {t(locale, 'settings.priceCached')}
            <input type="number" step="0.0001" value={draft.priceCached} onChange={(event) => setDraft({ ...draft, priceCached: Number(event.target.value) })} />
          </label>
          <label>
            {t(locale, 'settings.priceOut')}
            <input type="number" step="0.0001" value={draft.priceOutput} onChange={(event) => setDraft({ ...draft, priceOutput: Number(event.target.value) })} />
          </label>
        </div>
        <button className="primary">{t(locale, 'settings.save')}</button>
      </form>
      <div className="token-box">
        <span>{t(locale, 'settings.token')}</span>
        <code>{settings.token}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(settings.token);
            setCopied(true);
          }}
        >
          {copied ? t(locale, 'onboarding.copied') : t(locale, 'settings.copy')}
        </button>
        <button
          onClick={async () => {
            await api.saveSettings({ regenerateToken: true });
            onSaved(await api.settings());
          }}
        >
          {t(locale, 'settings.regenerate')}
        </button>
      </div>
      <p className="hint">{t(locale, 'settings.port')} {settings.port}</p>
      <button
        className="danger"
        onClick={async () => {
          if (!window.confirm(t(locale, 'settings.resetConfirm'))) return;
          await api.reset();
          onToast(t(locale, 'settings.saved'));
        }}
      >
        {t(locale, 'settings.reset')}
      </button>
    </section>
  );
}

function ShieldToggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button className={on ? 'switch on' : 'switch'} onClick={() => onChange(!on)} aria-pressed={on}>
      <i />
      {label}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="close">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Initial({ name }: { name: string }) {
  const letter = [...name.trim()][0]?.toUpperCase() || 'U';
  const hue = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 40;
  return <div className="initial" style={{ background: `linear-gradient(145deg, hsl(${258 + hue} 85% 62%), hsl(${230 + hue} 70% 42%))` }}>{letter}</div>;
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 27 7v8c0 8-5 12-11 15C10 27 5 23 5 15V7z" />
      <circle cx="16" cy="15" r="3" />
    </svg>
  );
}
