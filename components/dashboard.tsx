'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ArrowUpRight,
  ArrowDownUp,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FlaskConical,
  Layers3,
  Link2,
  Loader2,
  Search,
  Settings2,
  Shield,
  Sparkles,
  TrendingUp,
  Trophy,
  Upload,
  Users,
  X,
  RefreshCw,
  Download,
  LayoutDashboard,
  ArrowLeftRight,
  CalendarDays,
  Activity,
  CheckCircle2,
  UserPlus,
} from 'lucide-react';
import Avatar from './player-avatar';
import WaiverPage from './waiver-page';
import PlayersPage from './players-page';
import { demoLeague, restoreDemoDefenses } from '@/lib/demo';
import {
  League,
  Player,
  Team,
  positions,
  points,
  active,
  total,
  removeIDPPlayers,
} from '@/lib/types';
import { TradeHorizon, horizonLabels } from '@/lib/weekly-trades';
import {
  TradeCandidate,
  FindTradeOptions,
  TradeSearchProgress,
} from '@/lib/trade-finder';
import { runTradeSearch } from '@/lib/trade-search-client';
import { evaluateForecastRoster } from '@/lib/trade-evaluation';
import { TradeMoves } from './trade-moves';
import { TradeWeeklyComparison } from './trade-weekly-comparison';
import {
  applyProjections,
  parseProjectionCSV,
  preserveForecastOverrides,
} from '@/lib/projections';
import { TradeHistoryPanel } from './trade-history';
import { TradeFinder } from './trade-finder';

type View = 'roster' | 'league' | 'players' | 'trade' | 'waivers';
type Modal = 'connect' | 'projections' | 'help' | null;
const STORAGE = 'sunday-league-v1';
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('');
}
function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function TeamMark({ team, small = false }: { team: Team; small?: boolean }) {
  return (
    <span className={`team-mark ${small ? 'small' : ''} team-${team.id % 4}`}>
      <Shield size={small ? 20 : 31} />
      <span>{team.abbreviation.slice(0, 3)}</span>
    </span>
  );
}
function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  );
}
function Dialog({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="modal"
    >
      <div className="modal-inner">
        <button
          className="icon-button modal-close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        {children}
      </div>
    </dialog>
  );
}

export default function Dashboard() {
  const [league, setLeague] = useState<League>(demoLeague),
    [original, setOriginal] = useState<League>(demoLeague),
    [myTeamId, setMyTeamId] = useState(1),
    [viewedId, setViewedId] = useState(1),
    [view, setView] = useState<View>('roster'),
    [ready, setReady] = useState(false);
  const [modal, setModal] = useState<Modal>(null),
    [query, setQuery] = useState(''),
    [position, setPosition] = useState('All'),
    [rosterFilter, setRosterFilter] = useState('All players'),
    [metric, setMetric] = useState<'weekly' | 'ros'>('weekly'),
    [sort, setSort] = useState<'lineup' | 'projection' | 'name'>('lineup');
  const [leagueInput, setLeagueInput] = useState(''),
    [season, setSeason] = useState(2026),
    [privateLeague, setPrivateLeague] = useState(false),
    [s2, setS2] = useState(''),
    [swid, setSwid] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [partnerId, setPartnerId] = useState(2),
    [send, setSend] = useState<number[]>([]),
    [receive, setReceive] = useState<number[]>([]),
    [projectionError, setProjectionError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshBusy = useRef(false);
  const lastRefreshAttempt = useRef(0);
  const connectionGeneration = useRef(0);
  const [includeTradeHistory, setIncludeTradeHistory] = useState(true);
  const [tradePickup, setTradePickup] = useState(false);
  const [tradeWaiverBaseline, setTradeWaiverBaseline] = useState(true);
  const [reviewPolicy, setReviewPolicy] = useState<
    Pick<
      FindTradeOptions,
      | 'scenarios'
      | 'objective'
      | 'playoffs'
      | 'ranking'
      | 'minimumGain'
      | 'partnerMinimumGain'
      | 'partnerHorizon'
    >
  >({ ranking: 'mine', minimumGain: 0 });
  const [manualProgress, setManualProgress] = useState<{
    signature: string;
    progress: TradeSearchProgress;
  } | null>(null);
  const [manualEvaluation, setManualEvaluation] = useState<{
    league: League;
    signature: string;
    candidate?: TradeCandidate;
    error?: string;
  } | null>(null);
  const [tradeHorizon, setTradeHorizon] = useState<TradeHorizon>('remaining');
  const [playoffWeek, setPlayoffWeek] = useState('');
  useEffect(() => {
    setPlayoffWeek('');
  }, [league.id, league.season]);
  const tradeLeague = useMemo(
    () =>
      playoffWeek
        ? {
            ...league,
            playoffStartWeek:
              Number.isInteger(Number(playoffWeek)) &&
              Number(playoffWeek) >= 1 &&
              Number(playoffWeek) <= league.finalWeek
                ? Number(playoffWeek)
                : undefined,
          }
        : league,
    [league, playoffWeek],
  );
  useEffect(() => {
    try {
      const cached = localStorage.getItem(STORAGE);
      if (cached) {
        const data = JSON.parse(cached);
        if (
          data.league?.teams?.length &&
          data.original?.teams?.length &&
          data.league.teams.every((t: Team) => Array.isArray(t.players))
        ) {
          if (data.league.source === 'demo' && !data.league.waiverWire) {
            data.league.waiverWire = demoLeague.waiverWire;
            data.original.waiverWire = demoLeague.waiverWire;
          }
          setLeague(restoreDemoDefenses(removeIDPPlayers(data.league)));
          setOriginal(restoreDemoDefenses(removeIDPPlayers(data.original)));
          const id = data.league.teams.some((t: Team) => t.id === data.myTeamId)
            ? data.myTeamId
            : data.league.teams[0].id;
          setMyTeamId(id);
          setViewedId(id);
          setPartnerId(
            data.league.teams.find((t: Team) => t.id !== id)?.id ?? id,
          );
        }
      }
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(
          STORAGE,
          JSON.stringify({ league, original, myTeamId }),
        );
      } catch {
        setNotice(
          'Browser storage is unavailable. Your league will remain available for this session.',
        );
      }
    }
  }, [league, original, myTeamId, ready]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 7000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const mine = league.teams.find((t) => t.id === myTeamId) ?? league.teams[0],
    team = league.teams.find((t) => t.id === viewedId) ?? mine,
    partner =
      league.teams.find((t) => t.id === partnerId) ??
      league.teams.find((t) => t.id !== myTeamId) ??
      mine;
  const rankings = useMemo(
    () =>
      [...league.teams].sort(
        (a, b) =>
          total(b.players.filter(active), 'ros') -
          total(a.players.filter(active), 'ros'),
      ),
    [league],
  );
  const starters = team.players.filter(active),
    weeklyTotal = total(starters, 'weekly'),
    rosTotal = total(starters, 'ros'),
    rank = rankings.findIndex((t) => t.id === team.id) + 1;
  const displayed = team.players
    .filter(
      (p) =>
        (position === 'All' || p.position === position) &&
        (rosterFilter === 'All players' ||
          (rosterFilter === 'Starters' ? active(p) : !active(p))) &&
        `${p.name} ${p.nflTeam}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'projection'
        ? (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity)
        : sort === 'name'
          ? a.name.localeCompare(b.name)
          : (active(a) ? 0 : 100) +
            (a.slotId === 23 ? 8 : a.slotId) -
            (active(b) ? 0 : 100) -
            (b.slotId === 23 ? 8 : b.slotId),
    );
  const coverage = starters.filter((p) => p[metric] !== null).length;
  const customCount = [
    ...league.teams.flatMap((t) => t.players),
    ...(league.waiverWire?.players ?? []),
  ].filter((p) => p.projectionSource === 'custom').length;
  function navigate(next: View) {
    setView(next);
    setQuery('');
    setPosition('All');
    setRosterFilter('All players');
    if (next === 'roster') setViewedId(myTeamId);
  }
  function openConnect() {
    setError('');
    setLeagueInput(league.source === 'espn' ? league.id : '');
    setSeason(league.season);
    setModal('connect');
  }
  function changeMine(id: number) {
    setMyTeamId(id);
    setViewedId(id);
    setSend([]);
    setReceive([]);
    setTradePickup(false);
    setPartnerId(league.teams.find((t) => t.id !== id)?.id ?? id);
  }
  function clearCredentials() {
    setS2('');
    setSwid('');
    setPrivateLeague(false);
  }
  function closeModal() {
    if (loading) return;
    setModal(null);
    clearCredentials();
    setError('');
    setProjectionError('');
  }
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    connectionGeneration.current++;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/espn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: leagueInput,
          season,
          includeTradeHistory,
          espnS2: privateLeague ? s2 : '',
          swid: privateLeague ? swid : '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed.');
      const next = removeIDPPlayers(data.league);
      const id =
        league.id === next.id && next.teams.some((t) => t.id === myTeamId)
          ? myTeamId
          : next.teams[0].id;
      setLeague(next);
      setOriginal(next);
      setMyTeamId(id);
      setViewedId(id);
      setPartnerId(next.teams.find((t) => t.id !== id)?.id ?? id);
      setSend([]);
      setReceive([]);
      setView(
        (view === 'waivers' || view === 'players') && league.id === next.id
          ? view
          : 'roster',
      );
      setModal(null);
      clearCredentials();
      setNeedsReconnect(false);
      setRefreshError('');
      lastRefreshAttempt.current = Date.now();
      setNotice('League imported. Choose your team from the team selector.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect.');
    } finally {
      setLoading(false);
    }
  }
  const refreshLeague = useCallback(
    async (automatic = false) => {
      if (
        refreshBusy.current ||
        loading ||
        league.source !== 'espn' ||
        needsReconnect
      )
        return;
      refreshBusy.current = true;
      lastRefreshAttempt.current = Date.now();
      const generation = connectionGeneration.current;
      setRefreshing(true);
      setRefreshError('');
      try {
        const response = await fetch('/api/espn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refresh: true,
            leagueId: league.id,
            season: league.season,
          }),
        });
        const data = await response.json();
        if (generation !== connectionGeneration.current) return;
        if (!response.ok) {
          if (data.reconnect || response.status === 401)
            setNeedsReconnect(true);
          throw new Error(data.error || 'Refresh failed. Try again shortly.');
        }
        const next = removeIDPPlayers(data.league);
        setOriginal(next);
        setLeague((current) => preserveForecastOverrides(next, current));
        const fallbackId = next.teams[0].id;
        const keepTeam = (id: number) =>
          next.teams.some((t) => t.id === id) ? id : fallbackId;
        setMyTeamId(keepTeam);
        setViewedId(keepTeam);
        setPartnerId(keepTeam);
        setSend([]);
        setReceive([]);
        setTradePickup(false);
        if (!automatic)
          setNotice('League refreshed. Your custom projections are preserved.');
      } catch (err) {
        if (generation === connectionGeneration.current)
          setRefreshError(
            err instanceof Error ? err.message : 'Could not refresh ESPN.',
          );
      } finally {
        refreshBusy.current = false;
        setRefreshing(false);
      }
    },
    [league.id, league.season, league.source, loading, needsReconnect],
  );

  useEffect(() => {
    if (!ready || league.source !== 'espn' || needsReconnect) return;
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible' || modal === 'connect') return;
      const synced = Date.parse(league.syncedAt) || 0;
      if (
        Date.now() - Math.max(synced, lastRefreshAttempt.current) >=
        5 * 60 * 1000
      )
        void refreshLeague(true);
    };
    refreshIfStale();
    const timer = window.setInterval(refreshIfStale, 30000);
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [
    ready,
    league.source,
    league.syncedAt,
    needsReconnect,
    modal,
    refreshLeague,
  ]);

  function syncESPN() {
    if (league.source === 'demo' || needsReconnect) openConnect();
    else void refreshLeague();
  }
  async function disconnectESPN() {
    try {
      const response = await fetch('/api/espn', { method: 'DELETE' });
      if (!response.ok)
        throw new Error('Could not disconnect ESPN. Try again.');
      connectionGeneration.current++;
      setRefreshError('');
      setNeedsReconnect(false);
      resetDemo();
      setNotice('ESPN disconnected. Saved connection removed.');
    } catch (err) {
      setRefreshError(
        err instanceof Error ? err.message : 'Could not disconnect ESPN.',
      );
    }
  }
  function resetDemo() {
    connectionGeneration.current++;
    setLeague(demoLeague);
    setOriginal(demoLeague);
    changeMine(1);
    setPartnerId(2);
    setView('roster');
    setNotice('Switched to the sample league.');
  }
  function exportRoster() {
    download(
      `${team.abbreviation}-roster.csv`,
      'player_id,name,position,nfl_team,slot,weekly_points,ros_points,projection_source\n' +
        team.players
          .map((p) =>
            [
              p.id,
              `"${p.name.replaceAll('"', '""')}"`,
              p.position,
              p.nflTeam,
              p.slot,
              p.weekly ?? '',
              p.ros ?? '',
              p.projectionSource,
            ].join(','),
          )
          .join('\n'),
    );
  }
  async function importProjections(file: File) {
    setProjectionError('');
    try {
      if (file.size > 1000000) throw new Error('Choose a CSV under 1 MB.');
      const values = parseProjectionCSV(await file.text(), league);
      setLeague(applyProjections(league, values));
      setNotice(`Updated ${values.size} rest-of-season projections.`);
      setModal(null);
    } catch (err) {
      setProjectionError(
        err instanceof Error ? err.message : 'Could not read CSV.',
      );
    }
  }
  const playoffValid =
    Number.isInteger(tradeLeague.playoffStartWeek) &&
    tradeLeague.playoffStartWeek! >= 1 &&
    tradeLeague.playoffStartWeek! <= league.finalWeek;
  const horizonError =
    tradeHorizon === 'playoffs' && !playoffValid
      ? 'Choose your league’s playoff start week.'
      : tradeHorizon !== 'ros' && league.week > league.finalWeek
        ? 'This season has no remaining weeks.'
        : '';
  const manualSignature = JSON.stringify({
    send,
    receive,
    partnerId: partner.id,
    horizon: tradeHorizon,
    pickup: tradePickup,
    waiverBaseline: tradeWaiverBaseline,
    reviewPolicy,
  });
  useEffect(() => {
    if (!send.length || !receive.length || horizonError) return;
    const controller = new AbortController();
    runTradeSearch(tradeLeague, myTeamId, {
      ...reviewPolicy,
      maxPlayers: 2,
      partnerId: partner.id,
      horizon: tradeHorizon,
      includePickup: tradePickup,
      waiverBaseline: tradeWaiverBaseline,
      selectedPackage: { send, receive },
      includeNonImproving: true,
      signal: controller.signal,
      onProgress: (_count, progress) => {
        if (progress && !controller.signal.aborted)
          setManualProgress({ signature: manualSignature, progress });
      },
    })
      .then((result) =>
        setManualEvaluation({
          league: tradeLeague,
          signature: manualSignature,
          candidate: result.candidates[0],
          error: result.candidates.length
            ? ''
            : 'This package lacks complete forecasts or a legal joint roster plan.',
        }),
      )
      .catch((error) => {
        if (!controller.signal.aborted)
          setManualEvaluation({
            league: tradeLeague,
            signature: manualSignature,
            error:
              error instanceof Error
                ? error.message
                : 'Could not evaluate this trade.',
          });
      });
    return () => controller.abort();
  }, [tradeLeague, myTeamId, manualSignature, horizonError]);
  const analysis = useMemo(() => {
    const evaluate = (players: Player[]) =>
      evaluateForecastRoster(
        tradeLeague,
        players,
        horizonError ? 'ros' : tradeHorizon,
        { streaming: !tradeWaiverBaseline },
      );
    const original = evaluate(mine.players),
      theirs = evaluate(partner.players);
    const current =
      manualEvaluation?.league === tradeLeague &&
      manualEvaluation.signature === manualSignature
        ? manualEvaluation
        : undefined;
    const candidate = current?.candidate;
    return {
      before: candidate?.mine.before ?? original,
      partnerBefore: candidate?.partner.before ?? theirs,
      after: candidate?.mine.after ?? original,
      partnerAfter: candidate?.partner.after ?? theirs,
      plan: candidate?.plan ?? null,
      baseline: candidate?.baseline,
      error: current?.error ?? '',
      loading:
        !horizonError && send.length > 0 && receive.length > 0 && !current,
      tradeOnly: candidate?.tradeOnly ?? null,
      candidate,
    };
  }, [
    tradeLeague,
    tradeHorizon,
    horizonError,
    mine,
    partner,
    manualEvaluation,
    manualSignature,
    tradeWaiverBaseline,
    send.length,
    receive.length,
  ]);
  const {
    before,
    after,
    partnerBefore,
    partnerAfter,
    plan: tradePlan,
  } = analysis;
  const planError = analysis.error;
  const canAnalyze =
    !planError &&
    !analysis.loading &&
    !horizonError &&
    send.length > 0 &&
    receive.length > 0 &&
    before.complete &&
    after.complete &&
    partnerBefore.complete &&
    partnerAfter.complete &&
    before.missing === 0 &&
    after.missing === 0 &&
    partnerBefore.missing === 0 &&
    partnerAfter.missing === 0;
  const delta = analysis.candidate?.mine.gain ?? after.total - before.total;
  const projectionDescription =
    league.source === 'demo'
      ? 'Illustrative sample projections'
      : customCount
        ? `ESPN + ${customCount} custom ROS values`
        : 'ESPN league scoring';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Sunday home">
          <span className="brand-symbol">
            <span />
            <span />
            <span />
          </span>
          sunday<span className="brand-period">.</span>
        </a>
        <div className="sidebar-section-label">YOUR PLAYBOOK</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={view === 'roster' ? 'nav-item selected' : 'nav-item'}
            onClick={() => navigate('roster')}
          >
            <LayoutDashboard size={19} />
            My roster
            <span className="nav-dot" />
          </button>
          <button
            className={view === 'league' ? 'nav-item selected' : 'nav-item'}
            onClick={() => navigate('league')}
          >
            <Users size={19} />
            League rosters
          </button>
          <button
            className={view === 'players' ? 'nav-item selected' : 'nav-item'}
            onClick={() => navigate('players')}
          >
            <Activity size={19} />
            Players
          </button>
          <button
            className={view === 'trade' ? 'nav-item selected' : 'nav-item'}
            onClick={() => navigate('trade')}
          >
            <ArrowLeftRight size={19} />
            Trade lab<span className="beta">BETA</span>
          </button>
          <button
            className={view === 'waivers' ? 'nav-item selected' : 'nav-item'}
            onClick={() => navigate('waivers')}
          >
            <UserPlus size={19} />
            Waiver wire
          </button>
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-section-label">LEAGUE</div>
        <button className="league-switch" onClick={() => navigate('league')}>
          <span className="league-icon">
            <Trophy size={18} />
          </span>
          <span>
            <strong>{league.name}</strong>
            <small>
              {league.teams.length} teams · {league.scoring}
            </small>
          </span>
          <ChevronRight size={15} />
        </button>
        <button
          className="nav-item muted"
          onClick={() => {
            setProjectionError('');
            setModal('projections');
          }}
        >
          <Settings2 size={18} />
          Projection settings
        </button>
        <div className="sidebar-bottom">
          <div className="espn-promo">
            <span className="mini-espn">ESPN</span>
            <strong>
              {league.source === 'demo'
                ? 'Your league. All here.'
                : 'League connected.'}
            </strong>
            <p>
              {league.source === 'demo'
                ? 'Bring your ESPN rosters into a clearer view.'
                : 'Fresh rosters make better decisions. Keep yours up to date.'}
            </p>
            <button onClick={openConnect}>
              {league.source === 'demo'
                ? 'Connect your league'
                : 'Refresh league'}
              <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="nav-item muted help-button"
            onClick={() => setModal('help')}
          >
            <CircleHelp size={18} />
            How Sunday works
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="profile-avatar">{initials(mine.owner)}</span>
            <span>
              <strong>{mine.owner.split(' & ')[0]}</strong>
              <small>Fantasy manager</small>
            </span>
            <button
              aria-label="Choose your team"
              onClick={() => {
                navigate('roster');
                document.getElementById('team-select')?.focus();
              }}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Your playbook
            <ChevronRight size={13} />
            <span>
              {view === 'roster'
                ? 'Roster overview'
                : view === 'league'
                  ? 'League rosters'
                  : view === 'players'
                    ? 'Players'
                    : view === 'waivers'
                      ? 'Waiver wire'
                      : 'Trade lab'}
            </span>
          </div>
          <div className="topbar-actions">
            <span className="season-label">
              <CalendarDays size={14} />
              {league.season} season
            </span>
            <span className="week-pill">Week {league.week}</span>
            <button
              className="icon-button"
              aria-label="Help"
              onClick={() => setModal('help')}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                A LITTLE CLARITY. A COMPETITIVE EDGE.
              </div>
              <h1>
                {view === 'roster'
                  ? team.id === myTeamId
                    ? 'My roster'
                    : 'Team roster'
                  : view === 'league'
                    ? 'The whole league.'
                    : view === 'players'
                      ? 'Players'
                      : view === 'waivers'
                        ? 'Find your next upgrade.'
                        : 'Make your next move.'}
              </h1>
              <p>
                {view === 'roster'
                  ? 'Your lineup, your depth, and the road ahead.'
                  : view === 'league'
                    ? 'Know the competition. Find your next opportunity.'
                    : view === 'players'
                      ? 'Browse players and compare their weekly and rest-of-season projections.'
                      : view === 'waivers'
                        ? 'Available players, your roster, and a clearer next move.'
                        : 'Explore what a trade could do for your starting lineup.'}
              </p>
            </div>
            <button
              className="button primary"
              onClick={syncESPN}
              disabled={loading || refreshing}
            >
              {league.source === 'demo' ? (
                <Link2 size={16} />
              ) : (
                <RefreshCw size={16} />
              )}{' '}
              {league.source === 'demo'
                ? 'Connect ESPN'
                : refreshing
                  ? 'Refreshing…'
                  : needsReconnect
                    ? 'Reconnect ESPN'
                    : 'Refresh ESPN'}
              <ArrowUpRight size={15} />
            </button>
          </div>
          {league.source === 'demo' ? (
            <div className="demo-banner">
              <span>
                <FlaskConical size={16} />
                <strong>You’re exploring a sample league.</strong>
                <span>Connect ESPN to make it yours.</span>
              </span>
              <button onClick={openConnect}>
                Let’s connect
                <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <div className="connected-banner">
              <span>
                <CheckCircle2 size={15} />
                ESPN connected · {league.name}
                <span className="sync-time">
                  Updated {new Date(league.syncedAt).toLocaleString()} ·
                  Auto-refresh every 5 minutes while open
                </span>
              </span>
              <div className="connection-actions">
                <button onClick={openConnect} disabled={loading || refreshing}>
                  Change connection
                </button>
                <button
                  onClick={disconnectESPN}
                  disabled={loading || refreshing}
                >
                  Disconnect
                </button>
                <button onClick={resetDemo} disabled={loading || refreshing}>
                  Use sample league
                </button>
              </div>
            </div>
          )}
          {refreshError && league.source === 'espn' && (
            <div className="form-error" role="alert">
              {refreshError} Your saved league is still available.
              {needsReconnect && (
                <button className="button" onClick={openConnect}>
                  Reconnect ESPN
                </button>
              )}
            </div>
          )}
          {view === 'roster' && (
            <>
              <div className="team-overview">
                <div className="team-identity">
                  <TeamMark team={team} />
                  <div>
                    <div className="team-title">
                      <h2>{team.name}</h2>
                      {team.id === myTeamId && (
                        <span className="my-team-tag">MY TEAM</span>
                      )}
                    </div>
                    <p>
                      Managed by {team.owner}
                      <span>·</span>
                      {league.name}
                    </p>
                  </div>
                </div>
                <div className="team-select-wrap">
                  <span>VIEW TEAM</span>
                  <select
                    id="team-select"
                    aria-label="View team"
                    value={team.id}
                    onChange={(e) => {
                      setViewedId(Number(e.target.value));
                      setQuery('');
                      setPosition('All');
                    }}
                  >
                    {league.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {team.id !== myTeamId && (
                    <button onClick={() => changeMine(team.id)}>
                      Set as my team
                    </button>
                  )}
                </div>
              </div>
              <div className="stat-grid">
                <StatCard
                  label="PROJECTED THIS WEEK"
                  value={points(weeklyTotal)}
                  icon={<Activity size={17} />}
                  detail={
                    <>
                      <span className="green-text">
                        {starters.filter((p) => p.weekly !== null).length}/
                        {starters.length} starters
                      </span>{' '}
                      with projections
                    </>
                  }
                />
                <StatCard
                  label="REST-OF-SEASON POINTS"
                  value={points(rosTotal)}
                  icon={<TrendingUp size={17} />}
                  detail={
                    <>
                      Current starters · Weeks{' '}
                      {Math.min(league.week, league.finalWeek)}–
                      {league.finalWeek}
                    </>
                  }
                />
                <StatCard
                  label="LEAGUE ROS RANK"
                  value={`#${rank}`}
                  icon={<Trophy size={17} />}
                  detail={
                    <>
                      of {league.teams.length} teams · projected starter totals
                    </>
                  }
                />
                <StatCard
                  label="SEASON RECORD"
                  value={`${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`}
                  icon={<Shield size={17} />}
                  detail={<>{points(team.pointsFor)} points scored</>}
                />
              </div>
              <div className="roster-layout">
                <section className="panel roster-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>
                        The lineup
                        <span className="count-chip">
                          {team.players.length}
                        </span>
                      </h3>
                      <p>A closer look at your roster.</p>
                    </div>
                    <div className="segmented" aria-label="Projection period">
                      <button
                        className={metric === 'weekly' ? 'current' : ''}
                        onClick={() => setMetric('weekly')}
                      >
                        This week
                      </button>
                      <button
                        className={metric === 'ros' ? 'current' : ''}
                        onClick={() => setMetric('ros')}
                      >
                        Rest of season
                      </button>
                    </div>
                  </div>
                  <div className="table-toolbar">
                    <div className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="Search players"
                        placeholder="Search players..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          aria-label="Clear search"
                          onClick={() => setQuery('')}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <select
                      aria-label="Roster filter"
                      value={rosterFilter}
                      onChange={(e) => setRosterFilter(e.target.value)}
                    >
                      <option>All players</option>
                      <option>Starters</option>
                      <option>Bench & IR</option>
                    </select>
                    <button
                      className="icon-button export-button"
                      aria-label="Export roster CSV"
                      title="Export roster CSV"
                      onClick={exportRoster}
                    >
                      <Download size={17} />
                    </button>
                  </div>
                  <div className="position-tabs" aria-label="Position filter">
                    {['All', ...positions].map((p) => (
                      <button
                        key={p}
                        className={position === p ? 'active' : ''}
                        onClick={() => setPosition(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="table-scroll">
                    <table className="roster-table">
                      <thead>
                        <tr>
                          <th>SLOT</th>
                          <th>
                            <button
                              onClick={() =>
                                setSort(sort === 'name' ? 'lineup' : 'name')
                              }
                            >
                              PLAYER
                              <ArrowDownUp size={11} />
                            </button>
                          </th>
                          <th className="status-col">STATUS</th>
                          <th className="number">
                            <button
                              onClick={() =>
                                setSort(
                                  sort === 'projection'
                                    ? 'lineup'
                                    : 'projection',
                                )
                              }
                            >
                              {metric === 'weekly'
                                ? 'WK ' + league.week + ' PROJ.'
                                : 'ROS PROJ.'}
                              <ArrowDownUp size={11} />
                            </button>
                          </th>
                          <th className="number season-col">SEASON PTS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayed.map((p) => (
                          <tr
                            key={p.id}
                            className={!active(p) ? 'bench-row' : ''}
                          >
                            <td>
                              <span
                                className={`slot-badge ${active(p) ? '' : 'bench'}`}
                              >
                                {p.slot}
                              </span>
                            </td>
                            <td>
                              <div className="player-cell">
                                <Avatar player={p} />
                                <div>
                                  <strong>{p.name}</strong>
                                  <small>
                                    {p.nflTeam}
                                    <span>·</span>
                                    {p.position}
                                    {metric === 'ros' && (
                                      <span className="source-label">
                                        {p.projectionSource === 'estimate'
                                          ? 'EST.'
                                          : p.projectionSource === 'custom'
                                            ? 'CUSTOM'
                                            : p.projectionSource === 'sample'
                                              ? 'SAMPLE'
                                              : ''}
                                      </span>
                                    )}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td className="status-col">
                              {['ACTIVE', 'NORMAL'].includes(p.status) ? (
                                <span className="player-status healthy">
                                  <span />
                                  Healthy
                                </span>
                              ) : (
                                <span className="player-status injury">
                                  {p.status === 'QUESTIONABLE'
                                    ? 'Questionable'
                                    : p.status
                                        .replaceAll('_', ' ')
                                        .toLowerCase()}
                                </span>
                              )}
                            </td>
                            <td className="number projection-number">
                              {points(p[metric])}
                            </td>
                            <td className="number season-col muted-number">
                              {points(p.actual)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!displayed.length && (
                      <div className="empty-state">
                        <Search size={25} />
                        <strong>No players found</strong>
                        <p>Try another name or position.</p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setQuery('');
                            setPosition('All');
                            setRosterFilter('All players');
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      <span className="live-dot" />
                      {projectionDescription}
                    </span>
                    <span>
                      {displayed.length} players · {coverage}/{starters.length}{' '}
                      starters projected
                    </span>
                  </div>
                </section>
                <aside className="insight-column">
                  <section className="panel position-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Where the points are</h3>
                        <p>
                          {metric === 'weekly' ? 'Weekly' : 'ROS'} starter
                          projections by position.
                        </p>
                      </div>
                      <span className="icon-tile">
                        <Layers3 size={17} />
                      </span>
                    </div>
                    <PositionChart players={starters} metric={metric} />
                    <div className="chart-legend">
                      <span>
                        <span className="legend-square" />
                        Projected starter points
                      </span>
                      <strong>{points(total(starters, metric))}</strong>
                    </div>
                  </section>
                  <section className="panel depth-panel">
                    <div className="panel-heading">
                      <div>
                        <h3>Your roster, at a glance</h3>
                        <p>Every piece of the puzzle.</p>
                      </div>
                    </div>
                    <div className="depth-stats">
                      <div>
                        <strong>{starters.length}</strong>
                        <span>Starters</span>
                      </div>
                      <div>
                        <strong>
                          {team.players.filter((p) => p.slotId === 20).length}
                        </strong>
                        <span>Bench</span>
                      </div>
                      <div>
                        <strong>
                          {team.players.filter((p) => p.slotId === 21).length}
                        </strong>
                        <span>IR</span>
                      </div>
                    </div>
                    <div className="depth-track">
                      {team.players.map((p) => (
                        <span
                          key={p.id}
                          className={
                            active(p)
                              ? 'starter'
                              : p.slotId === 21
                                ? 'ir'
                                : 'bench'
                          }
                          title={`${p.name} · ${p.slot}`}
                        />
                      ))}
                    </div>
                    <div className="injury-note">
                      {team.players.some(
                        (p) => !['ACTIVE', 'NORMAL'].includes(p.status),
                      ) ? (
                        <>
                          <Activity size={15} />
                          {
                            team.players.filter(
                              (p) => !['ACTIVE', 'NORMAL'].includes(p.status),
                            ).length
                          }{' '}
                          player(s) with a status to watch
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={15} />
                          No injury flags on your roster
                        </>
                      )}
                    </div>
                  </section>
                  <section className="trade-promo">
                    <span className="promo-icon">
                      <ArrowLeftRight size={21} />
                    </span>
                    <span className="beta">TRADE LAB</span>
                    <h3>
                      A better roster starts
                      <br />
                      with a good question.
                    </h3>
                    <p>
                      See how a potential trade changes your projected starting
                      lineup.
                    </p>
                    <button onClick={() => navigate('trade')}>
                      Explore a trade
                      <ArrowUpRight size={17} />
                    </button>
                    <div className="promo-decoration" />
                  </section>
                </aside>
              </div>
            </>
          )}
          {view === 'league' && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Around the league</h2>
                  <p>
                    Ranked by current starters’ rest-of-season points. Missing
                    projections reduce totals.
                  </p>
                </div>
                <span className="count-chip">{league.teams.length} teams</span>
              </div>
              <LeagueTable
                teams={rankings}
                myTeamId={myTeamId}
                week={league.week}
                onView={(id) => {
                  setViewedId(id);
                  setView('roster');
                  setQuery('');
                  setPosition('All');
                  setRosterFilter('All players');
                }}
              />
            </>
          )}
          {view === 'players' && (
            <PlayersPage
              key={`${league.source}-${league.id}`}
              league={league}
              onProjectionSettings={() => setModal('projections')}
            />
          )}
          {view === 'waivers' && (
            <WaiverPage
              key={`${league.source}-${league.id}-${myTeamId}`}
              league={league}
              mine={mine}
              onTeamChange={changeMine}
              onSync={syncESPN}
            />
          )}
          {view === 'trade' && (
            <>
              <div className="trade-explanation">
                <Sparkles size={19} />
                <div>
                  <strong>A sandbox for your next move.</strong>
                  <p>
                    Compare optimized starters each week, including known byes,
                    current-week injury availability, and roster moves for
                    unequal trades. Missing weekly forecasts use labeled ROS
                    estimates. Nothing is submitted to ESPN.
                  </p>
                </div>
              </div>
              <div className="trade-team-controls">
                <label>
                  Your team
                  <select
                    aria-label="Your team"
                    value={myTeamId}
                    onChange={(e) => changeMine(Number(e.target.value))}
                  >
                    {league.teams.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ArrowLeftRight size={22} />
                <label>
                  Trade partner
                  <select
                    aria-label="Trade partner"
                    value={partner.id}
                    onChange={(e) => {
                      setPartnerId(Number(e.target.value));
                      setReceive([]);
                    }}
                  >
                    {league.teams
                      .filter((t) => t.id !== myTeamId)
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="trade-period-controls">
                <label>
                  Evaluate trades for
                  <select
                    value={tradeHorizon}
                    onChange={(e) =>
                      setTradeHorizon(e.target.value as TradeHorizon)
                    }
                  >
                    {Object.entries(horizonLabels)
                      .filter(([key]) => key !== 'ros')
                      .map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    <option value="ros">{horizonLabels.ros}</option>
                  </select>
                </label>
                <label>
                  Playoffs start in week
                  <input
                    type="number"
                    min="1"
                    max={league.finalWeek}
                    step="1"
                    placeholder="Choose week"
                    value={playoffWeek || league.playoffStartWeek || ''}
                    onChange={(e) => setPlayoffWeek(e.target.value)}
                  />
                </label>
                <p className="finder-note">
                  {league.playoffStartWeek
                    ? 'Playoff timing imported from league settings; you can override it.'
                    : 'Set the playoff start week to enable playoff comparisons.'}{' '}
                  Gains are projected points over the selected period.
                </p>
              </div>
              {horizonError && (
                <p className="form-error" role="alert">
                  {horizonError}
                </p>
              )}
              <TradeHistoryPanel league={league} />
              <TradeFinder
                league={tradeLeague}
                horizon={tradeHorizon}
                myTeamId={myTeamId}
                onUpdateLeague={setLeague}
                onRestoreForecasts={() => setLeague(original)}
                onReview={(candidate) => {
                  setReviewPolicy({
                    partnerHorizon: candidate.partnerHorizon,
                    scenarios: candidate.scenarios,
                    objective: candidate.objective,
                    playoffs: candidate.playoffs,
                    ranking: candidate.searchPolicy?.ranking ?? 'mine',
                    minimumGain: candidate.searchPolicy?.minimumGain ?? 0,
                    partnerMinimumGain:
                      candidate.searchPolicy?.partnerMinimumGain,
                  });
                  setTradeWaiverBaseline(candidate.waiverBaseline ?? true);
                  setPartnerId(candidate.partnerId);
                  setSend(candidate.send.map((p) => p.id));
                  setReceive(candidate.receive.map((p) => p.id));
                  setTradePickup(
                    Boolean(
                      candidate.plan.mine.pickup ||
                      candidate.plan.partner.pickup,
                    ),
                  );
                  requestAnimationFrame(() =>
                    document
                      .querySelector('.trade-grid')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                  );
                }}
              />
              <label className="pickup-option">
                <input
                  type="checkbox"
                  checked={tradeWaiverBaseline}
                  onChange={(e) => setTradeWaiverBaseline(e.target.checked)}
                />{' '}
                Compare with best no-trade add/drop; one immediate acquisition
                per team
              </label>
              {reviewPolicy.scenarios && (
                <p className="finder-note">
                  Reviewed using {reviewPolicy.scenarios.samples} outcome
                  scenarios and the {reviewPolicy.objective ?? 'points'}{' '}
                  objective. These assumptions continue to apply when you edit
                  this trade.{' '}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setReviewPolicy({ ranking: 'mine', minimumGain: 0 })
                    }
                  >
                    Use deterministic points
                  </button>
                </p>
              )}
              <div className="trade-grid">
                <TradePicker
                  team={mine}
                  selected={send}
                  onChange={setSend}
                  label="YOU SEND"
                />
                <TradePicker
                  team={partner}
                  selected={receive}
                  onChange={setReceive}
                  label="YOU RECEIVE"
                />
              </div>
              {send.length > 0 && receive.length > 0 && (
                <>
                  <label className="pickup-option">
                    <input
                      type="checkbox"
                      checked={tradePickup}
                      onChange={(e) => setTradePickup(e.target.checked)}
                    />{' '}
                    Include a free-agent acquisition in the roster plan
                  </label>
                  {planError ? (
                    <p className="form-error" role="alert">
                      {planError}
                    </p>
                  ) : (
                    tradePlan && (
                      <div className="trade-lab-plan">
                        <TradeMoves
                          plan={tradePlan}
                          partnerName={partner.name}
                        />
                      </div>
                    )
                  )}
                </>
              )}
              <div className="panel trade-results">
                <div>
                  <span className="eyebrow">PROJECTED LINEUP IMPACT</span>
                  <h3>
                    {!send.length || !receive.length
                      ? 'What does the trade change?'
                      : analysis.loading
                        ? 'Evaluating trade…'
                        : !canAnalyze
                          ? 'More data needed'
                          : delta > 0.05
                            ? 'Your starting lineup gets stronger.'
                            : delta < -0.05
                              ? 'Your starting lineup loses projected points.'
                              : 'Your starting projection stays about the same.'}
                  </h3>
                  <p>
                    {!send.length || !receive.length
                      ? 'Choose at least one player on each side to compare.'
                      : analysis.loading
                        ? `Comparing legal roster plans and no-trade alternatives.${manualProgress?.signature === manualSignature ? ` ${manualProgress.progress.evaluatedRosters.toLocaleString()} roster plans evaluated.` : ''}`
                        : !canAnalyze
                          ? planError ||
                            'Both teams need projection coverage and enough eligible players for their starting slots. Check the selected period, roster moves, and projection settings.'
                          : `${horizonLabels[tradeHorizon]} · compared with the same roster policy before and after. ${tradePlan?.mine.pickup || tradePlan?.partner.pickup ? 'Includes the optional free-agent pickup.' : ''}`}
                  </p>
                </div>
                <div className="trade-impact">
                  <span>
                    {tradeHorizon === 'ros'
                      ? 'Your ROS change'
                      : 'Your projected change'}
                  </span>
                  <strong
                    className={canAnalyze && delta >= 0 ? 'green-text' : ''}
                  >
                    {canAnalyze
                      ? `${delta >= 0 ? '+' : ''}${points(delta)}`
                      : '—'}
                  </strong>
                  {canAnalyze && (
                    <small>
                      {points(before.total)} → {points(after.total)} pts
                    </small>
                  )}
                </div>
                <div className="trade-impact partner-impact">
                  <span>
                    {tradeHorizon === 'ros'
                      ? 'Partner’s ROS change'
                      : 'Partner’s projected change'}
                  </span>
                  <strong>
                    {canAnalyze
                      ? `${(analysis.candidate?.partner.gain ?? partnerAfter.total - partnerBefore.total) >= 0 ? '+' : ''}${points(analysis.candidate?.partner.gain ?? partnerAfter.total - partnerBefore.total)}`
                      : '—'}
                  </strong>
                </div>
              </div>
              {canAnalyze && analysis.baseline && (
                <div className="finder-note">
                  <p>No-trade moves used for comparison:</p>
                  <TradeMoves
                    plan={analysis.baseline}
                    partnerName={partner.name}
                  />
                </div>
              )}
              {canAnalyze && analysis.candidate?.mine.uncertainty && (
                <p className="finder-note">
                  Your scenario gain: 10th percentile{' '}
                  {points(analysis.candidate.mine.uncertainty.p10)}; improvement
                  in{' '}
                  {(
                    100 *
                    analysis.candidate.mine.uncertainty.probabilityImproves
                  ).toFixed(0)}
                  % of scenarios; Monte Carlo standard error{' '}
                  {analysis.candidate.mine.uncertainty.standardError.toFixed(3)}
                  .
                </p>
              )}
              {canAnalyze && analysis.candidate?.mine.outcomes && (
                <p className="finder-note">
                  Expected wins:{' '}
                  {analysis.candidate.mine.outcomes.before.wins.toFixed(2)} →{' '}
                  {analysis.candidate.mine.outcomes.after.wins.toFixed(2)}.{' '}
                  {analysis.candidate.objective === 'title'
                    ? `Title probability: ${(100 * analysis.candidate.mine.outcomes.before.title!).toFixed(1)}% → ${(100 * analysis.candidate.mine.outcomes.after.title!).toFixed(1)}%.`
                    : ''}
                </p>
              )}
              {canAnalyze &&
                analysis.tradeOnly &&
                (tradePlan?.mine.pickup || tradePlan?.partner.pickup) && (
                  <p className="finder-note">
                    Gains without the optional pickup: your team{' '}
                    {analysis.tradeOnly.mine >= 0 ? '+' : ''}
                    {points(analysis.tradeOnly.mine)} · their team{' '}
                    {analysis.tradeOnly.partner >= 0 ? '+' : ''}
                    {points(analysis.tradeOnly.partner)}.
                  </p>
                )}
              {canAnalyze && tradePlan && tradeHorizon !== 'ros' && (
                <div className="panel trade-weekly-details">
                  <TradeWeeklyComparison
                    league={tradeLeague}
                    before={analysis.baseline?.mine.roster ?? mine.players}
                    scenarios={reviewPolicy.scenarios}
                    streaming={!tradeWaiverBaseline}
                    after={tradePlan.mine.roster}
                    name="Your team"
                  />
                  <TradeWeeklyComparison
                    league={tradeLeague}
                    before={
                      analysis.baseline?.partner.roster ?? partner.players
                    }
                    scenarios={reviewPolicy.scenarios}
                    streaming={!tradeWaiverBaseline}
                    after={tradePlan.partner.roster}
                    name={partner.name}
                  />
                </div>
              )}
              <div className="trade-bottom">
                <span>
                  <Shield size={14} />
                  Local simulation · no league changes
                </span>
                <button
                  className="button secondary"
                  onClick={() => {
                    setSend([]);
                    setReceive([]);
                    setTradePickup(false);
                    setReviewPolicy({ ranking: 'mine', minimumGain: 0 });
                  }}
                >
                  Reset trade
                </button>
              </div>
            </>
          )}
          <div className="projection-disclosure">
            <CircleHelp size={14} />
            <div>
              {league.source === 'demo'
                ? 'Sample data is illustrative, including player teams, records, and projections.'
                : (league.warnings[0] ??
                  'ESPN projections use your league’s scoring settings.')}
              {customCount > 0 &&
                ` ${customCount} ROS values use your uploaded projections.`}{' '}
              <button onClick={() => setModal('projections')}>
                About these projections
                <ArrowUpRight size={11} />
              </button>
            </div>
          </div>
          <footer className="main-footer">
            <span>Built for the long game.</span>
            <span className="footer-brand">sunday.</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Dialog
        label="Connect ESPN league"
        open={modal === 'connect'}
        onClose={closeModal}
      >
        <span className="modal-icon">
          <Link2 size={24} />
        </span>
        <div className="eyebrow">YOUR LEAGUE, CONNECTED</div>
        <h2>Bring your league to Sunday.</h2>
        <p className="modal-description">
          Import your ESPN teams, rosters, league scoring, and available
          projections.
        </p>
        <form onSubmit={connect}>
          <label className="field-label">
            ESPN league URL or ID
            <input
              autoFocus
              required
              placeholder="https://fantasy.espn.com/football/league?leagueId=…"
              value={leagueInput}
              onChange={(e) => setLeagueInput(e.target.value)}
              disabled={loading}
            />
          </label>
          <label className="field-label">
            Season
            <input
              type="number"
              min="2019"
              max={new Date().getFullYear() + 1}
              required
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              disabled={loading}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={privateLeague}
              onChange={(e) => setPrivateLeague(e.target.checked)}
              disabled={loading}
            />
            My league is private
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeTradeHistory}
              onChange={(e) => setIncludeTradeHistory(e.target.checked)}
              disabled={loading}
            />
            Import trade history for this season
          </label>
          <p className="finder-note">
            Includes accessible accepted and declined offer records. History
            adds time to the import and is saved in this browser.
          </p>
          {privateLeague && (
            <div className="private-fields">
              <p>
                Sign in to{' '}
                <a
                  href="https://fantasy.espn.com/football/"
                  target="_blank"
                  rel="noreferrer"
                >
                  ESPN
                  <ExternalLink size={12} />
                </a>
                , then open browser developer tools → Application (Chrome) or
                Storage (Firefox) → Cookies → espn.com. Copy the values for
                these two cookies.
              </p>
              <label className="field-label">
                espn_s2
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={s2}
                  onChange={(e) => setS2(e.target.value)}
                  disabled={loading}
                  placeholder="Your ESPN session cookie"
                />
              </label>
              <label className="field-label">
                SWID
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={swid}
                  onChange={(e) => setSwid(e.target.value)}
                  disabled={loading}
                  placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                />
              </label>
              <div className="privacy-note">
                <Shield size={14} />
                Cookies are sent to this app’s server over your connection and
                forwarded only to ESPN. They are saved encrypted on the server
                so you can refresh without entering them again. Disconnect
                removes the saved connection.
              </div>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="button primary modal-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="spin" />
                Importing your league…
              </>
            ) : (
              <>
                Connect league
                <ArrowRight size={16} />
              </>
            )}
          </button>
          <p className="form-note">
            Your imported roster snapshot is saved in this browser. ESPN’s
            unofficial API may change. Refreshes preserve custom projections;
            connecting a league replaces them.
          </p>
        </form>
      </Dialog>
      <Dialog
        label="Projection settings"
        open={modal === 'projections'}
        onClose={closeModal}
      >
        <span className="modal-icon">
          <TrendingUp size={24} />
        </span>
        <div className="eyebrow">THE NUMBERS BEHIND THE LINEUP</div>
        <h2>Projection settings</h2>
        <p className="modal-description">
          A clear source for every projection.
        </p>
        <div className="projection-source-card">
          <strong>
            {league.source === 'demo' ? 'Sample league' : 'ESPN projections'}
          </strong>
          <span>
            {league.scoring} · {league.season} · Week {league.week}
          </span>
          <p>
            {league.source === 'demo'
              ? 'All sample projections are illustrative and do not represent current player forecasts.'
              : 'Weekly points are ESPN’s current-week projections using league scoring. ROS uses a sum of future weekly forecasts when every remaining week is available; otherwise it estimates projected season average × remaining league weeks. Estimates include the current week and do not adjust future byes or injuries.'}
          </p>
          {league.warnings.slice(1).map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
        <h3 className="upload-heading">Bring your own ROS projections</h3>
        <p className="small-description">
          Upload a CSV with <code>player_id</code> and <code>ros_points</code>{' '}
          columns. Values must match your league scoring and remaining season.
          Waiver players are included in the template. Unlisted players keep
          their existing values.
        </p>
        <div className="upload-actions">
          <button
            className="button secondary"
            onClick={() =>
              download(
                'sunday-projections-template.csv',
                'player_id,ros_points\n' +
                  [
                    ...league.teams.flatMap((t) => t.players),
                    ...(league.waiverWire?.players ?? []),
                  ]
                    .map((p) => `${p.id},${p.ros ?? ''}`)
                    .join('\n'),
              )
            }
          >
            <Download size={15} />
            Download template
          </button>
          <label className="button primary upload-button">
            <Upload size={15} />
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importProjections(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {projectionError && (
          <div className="form-error" role="alert">
            {projectionError}
          </div>
        )}
        {customCount > 0 && (
          <div className="restore-projections">
            <span>{customCount} custom ROS projections in use.</span>
            <button
              onClick={() => {
                setLeague(original);
                setNotice('Original projections restored.');
              }}
            >
              Restore original
            </button>
          </div>
        )}
        <p className="form-note">
          Missing values stay visible as —. Totals include available values
          only. Trade recommendations require complete projection coverage for
          both rosters.
        </p>
      </Dialog>
      <Dialog
        label="How Sunday works"
        open={modal === 'help'}
        onClose={closeModal}
      >
        <span className="modal-icon">
          <Sparkles size={24} />
        </span>
        <h2>Your Sunday playbook.</h2>
        <div className="help-steps">
          <div>
            <span>01</span>
            <div>
              <h3>Connect your league</h3>
              <p>
                Paste an ESPN league link or ID. Private leagues also need your
                ESPN session cookies. Your connection is saved for automatic
                refreshes and the Refresh ESPN button. Reconnect if your ESPN
                session expires.
              </p>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <h3>Pick your team</h3>
              <p>
                Use View team to explore any roster. Select “Set as my team” on
                your roster, or choose your team in Trade lab.
              </p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <h3>Know your projections</h3>
              <p>
                Switch between this week and the rest of the season. Estimated
                ROS values are marked EST. You can upload a projection CSV to
                use your preferred forecasts.
              </p>
            </div>
          </div>
          <div>
            <span>04</span>
            <div>
              <h3>Try a trade</h3>
              <p>
                Select players on both sides. Sunday matches players to eligible
                starting slots and compares the strongest projected lineups.
                This first model ignores weekly schedules and waiver
                replacements.
              </p>
            </div>
          </div>
        </div>
        <button className="button primary modal-submit" onClick={closeModal}>
          Got it
          <Check size={16} />
        </button>
      </Dialog>
    </div>
  );
}

function PositionChart({
  players,
  metric,
}: {
  players: Player[];
  metric: 'weekly' | 'ros';
}) {
  const data = positions
    .filter((p) => players.some((x) => x.position === p))
    .map((p) => ({
      position: p,
      value: total(
        players.filter((x) => x.position === p),
        metric,
      ),
    }));
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="position-chart">
      <div className="chart-y-label">
        {metric === 'weekly' ? 'Weekly' : 'ROS'} points
      </div>
      <div className="chart-area">
        <div className="chart-grid">
          <span>{Math.ceil(max)}</span>
          <span>{Math.ceil(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {data.map((d) => (
            <div className="chart-bar-column" key={d.position}>
              <span className="chart-value">{points(d.value)}</span>
              <div
                className={`chart-bar bar-${d.position.replace('/', '')}`}
                style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }}
                title={`${d.position}: ${points(d.value)} points`}
              />
              <span className="chart-x-label">{d.position}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function TradePicker({
  team,
  selected,
  onChange,
  label,
}: {
  team: Team;
  selected: number[];
  onChange: (ids: number[]) => void;
  label: string;
}) {
  const positionOrder: Player['position'][] = [
    'QB',
    'RB',
    'WR',
    'TE',
    'K',
    'D/ST',
  ];
  const players = [...team.players].sort(
    (a, b) =>
      positionOrder.indexOf(a.position) - positionOrder.indexOf(b.position),
  );
  return (
    <section className="panel trade-picker">
      <div className="trade-picker-heading">
        <div>
          <span className="eyebrow">{label}</span>
          <h3>{team.name}</h3>
        </div>
        <span className="count-chip">{selected.length} selected</span>
      </div>
      <div className="trade-player-list">
        {players.map((p) => (
          <label
            className={`trade-player ${selected.includes(p.id) ? 'chosen' : ''}`}
            key={p.id}
          >
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={() =>
                onChange(
                  selected.includes(p.id)
                    ? selected.filter((id) => id !== p.id)
                    : [...selected, p.id],
                )
              }
            />
            <Avatar player={p} />
            <span className="trade-player-name">
              <strong>{p.name}</strong>
              <small>
                {p.position} · {p.nflTeam}
                {p.projectionSource === 'estimate' ? ' · EST.' : ''}
              </small>
            </span>
            <span className="trade-player-points">
              {points(p.ros)}
              <small>ROS</small>
            </span>
          </label>
        ))}
      </div>
      <div className="trade-picker-footer">
        Selected ROS total
        <strong>
          {points(
            total(
              team.players.filter((p) => selected.includes(p.id)),
              'ros',
            ),
          )}
        </strong>
      </div>
    </section>
  );
}

type LeagueSort = 'rank' | 'team' | 'record' | 'weekly' | 'ros' | 'players';
function LeagueTable({
  teams,
  myTeamId,
  week,
  onView,
}: {
  teams: Team[];
  myTeamId: number;
  week: number;
  onView: (id: number) => void;
}) {
  const [sort, setSort] = useState<LeagueSort>('rank');
  const [ascending, setAscending] = useState(true);
  const rows = teams
    .map((team, i) => ({
      team,
      rank: i + 1,
      weekly: total(team.players.filter(active), 'weekly'),
      ros: total(team.players.filter(active), 'ros'),
      projected: team.players.filter((p) => p.ros !== null).length,
    }))
    .sort((a, b) => {
      const comparison =
        sort === 'team'
          ? a.team.name.localeCompare(b.team.name)
          : sort === 'record'
            ? a.team.wins - b.team.wins || b.team.losses - a.team.losses
            : sort === 'players'
              ? a.team.players.length - b.team.players.length
              : a[sort] - b[sort];
      return (ascending ? comparison : -comparison) || a.rank - b.rank;
    });
  function changeSort(key: LeagueSort) {
    if (key === sort) setAscending(!ascending);
    else {
      setSort(key);
      setAscending(key === 'rank' || key === 'team');
    }
  }
  const columns: { key: LeagueSort; label: string; numeric?: boolean }[] = [
    { key: 'rank', label: 'Rank' },
    { key: 'team', label: 'Team' },
    { key: 'record', label: 'Record', numeric: true },
    { key: 'weekly', label: `Week ${week} proj.`, numeric: true },
    { key: 'ros', label: 'ROS starter pts', numeric: true },
    { key: 'players', label: 'Roster', numeric: true },
  ];
  return (
    <section className="panel league-table-panel" aria-label="League rosters">
      <div
        className="league-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="League roster table; scroll horizontally on small screens"
      >
        <table className="league-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? 'number' : ''}
                  aria-sort={
                    sort === column.key
                      ? ascending
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button onClick={() => changeSort(column.key)}>
                    {column.label}
                    {sort === column.key ? (
                      <ChevronDown
                        size={13}
                        className={ascending ? 'sort-ascending' : ''}
                      />
                    ) : (
                      <ArrowDownUp size={12} />
                    )}
                  </button>
                </th>
              ))}
              <th scope="col" className="number">
                ROS coverage
              </th>
              <th scope="col">
                <span className="sr-only">View roster</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team: t, rank, weekly, ros, projected }) => (
              <tr key={t.id} className={t.id === myTeamId ? 'my-team-row' : ''}>
                <td className="league-table-rank">#{rank}</td>
                <td>
                  <div className="league-table-team">
                    <TeamMark team={t} small />
                    <div>
                      <div className="league-table-name">
                        <button onClick={() => onView(t.id)}>{t.name}</button>
                        {t.id === myTeamId && (
                          <span className="my-team-tag">YOU</span>
                        )}
                      </div>
                      <span className="league-table-owner">{t.owner}</span>
                    </div>
                  </div>
                </td>
                <td className="number league-table-record">
                  {t.wins}–{t.losses}
                  {t.ties ? `–${t.ties}` : ''}
                </td>
                <td className="number">{points(weekly)}</td>
                <td className="number league-table-projection">
                  {points(ros)}
                </td>
                <td className="number">
                  {t.players.length}
                  <span className="league-cell-detail">players</span>
                </td>
                <td className="number">
                  <span
                    className={`coverage-pill ${projected < t.players.length ? 'incomplete' : ''}`}
                  >
                    {projected}/{t.players.length} projected
                  </span>
                </td>
                <td>
                  <button
                    className="league-view-button"
                    aria-label={`View ${t.name} roster`}
                    onClick={() => onView(t.id)}
                  >
                    View roster
                    <ArrowRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="league-table-footer">
        <span>
          {teams.length} teams · Starter projections use current lineups
        </span>
        <span>Click a column to sort</span>
      </div>
    </section>
  );
}
