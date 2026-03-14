'use client';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { PlayerData, MatchSummary } from '@/lib/pubg';

// Chart.js — dynamic import to avoid SSR issues
const Line = dynamic(() => import('react-chartjs-2').then(m => m.Line), { ssr: false });
const Bar  = dynamic(() => import('react-chartjs-2').then(m => m.Bar),  { ssr: false });
const Radar= dynamic(() => import('react-chartjs-2').then(m => m.Radar),{ ssr: false });

// Register Chart.js
if (typeof window !== 'undefined') {
  const { Chart, CategoryScale, LinearScale, PointElement, LineElement,
          BarElement, RadialLinearScale, Tooltip, Legend, Filler } = require('chart.js');
  Chart.register(CategoryScale, LinearScale, PointElement, LineElement,
                 BarElement, RadialLinearScale, Tooltip, Legend, Filler);
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface PlayerResult {
  ok: boolean;
  data?: PlayerData;
  name?: string;
  error?: string;
}
interface ApiResponse {
  players: PlayerResult[];
  fetchedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const COLORS = {
  p1: { hex: '#f5a623', dim: 'rgba(245,166,35,0.15)' },
  p2: { hex: '#e74c3c', dim: 'rgba(231,76,60,0.15)'  },
  p3: { hex: '#2ecc71', dim: 'rgba(46,204,113,0.15)' },
  p4: { hex: '#a78bfa', dim: 'rgba(167,139,250,0.15)'},
};
const PKEYS = ['p1','p2','p3','p4'] as const;
const GRID_COLOR = 'rgba(255,255,255,0.06)';

const modeShort = (mode: string) => {
  const m: Record<string,string> = {
    'squad-fpp':'Sq FPP','duo-fpp':'Duo FPP','solo-fpp':'Solo FPP',
    'squad':'Squad','duo':'Duo','solo':'Solo',
  };
  return m[mode] ?? mode;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function calcStats(matches: MatchSummary[]) {
  if (!matches.length) return { kd:0, avgDmg:0, avgRank:0, totalKills:0, totalDmg:0, top5:0, consistency:0, maxKills:0 };
  const kills  = matches.map(m => m.kills);
  const totalK = kills.reduce((a,b)=>a+b,0);
  const deaths = matches.filter(m=>m.rank>1).length;
  const totalDmg = matches.reduce((a,m)=>a+m.damage,0);
  return {
    kd:          deaths>0 ? Math.round((totalK/deaths)*100)/100 : totalK,
    avgDmg:      Math.round(totalDmg/matches.length),
    avgRank:     Math.round(matches.reduce((a,m)=>a+m.rank,0)/matches.length*10)/10,
    totalKills:  totalK,
    totalDmg,
    top5:        matches.filter(m=>m.rank<=5).length,
    consistency: Math.round((kills.filter(k=>k>0).length/matches.length)*100),
    maxKills:    Math.max(...kills),
  };
}

function norm(v: number, mn: number, mx: number) {
  return mx===mn ? 0 : Math.min(Math.max(((v-mn)/(mx-mn))*100,0),100);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Loader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="w-10 h-10 border-2 border-[#f5a623] border-t-transparent rounded-full spinner" />
      <p className="font-mono text-xs tracking-widest text-[var(--muted)]">DOHVAĆAM PODATKE…</p>
    </div>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  const isNoKey = msg.includes('PUBG_API_KEY');
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6 text-center">
      <div className="text-4xl">⚠️</div>
      <div className="font-['Bebas_Neue'] text-3xl tracking-widest text-[#e74c3c]">GREŠKA</div>
      <p className="font-mono text-sm text-[var(--muted)] max-w-lg">{msg}</p>
      {isNoKey && (
        <div className="bg-[var(--surface)] border border-[#f5a623]/30 rounded-lg p-5 max-w-lg text-left text-sm font-mono text-[var(--muted)] space-y-2">
          <p className="text-[#f5a623] font-bold mb-3">// KAKO DODATI API KLJUČ:</p>
          <p>1. Idi na <a href="https://developer.pubg.com" target="_blank" className="text-[#58a6ff] hover:underline">developer.pubg.com</a></p>
          <p>2. Registriraj se i generiraj API ključ</p>
          <p>3. Vercel Dashboard → Tvoj projekt → Settings → Environment Variables</p>
          <p>4. Dodaj: <span className="text-[#f5a623]">PUBG_API_KEY</span> = tvoj ključ</p>
          <p>5. Redeploy projekt</p>
        </div>
      )}
      <button onClick={onRetry}
        className="px-6 py-2 border border-[#f5a623]/40 text-[#f5a623] font-['Bebas_Neue'] tracking-widest text-lg hover:bg-[#f5a623]/10 transition rounded">
        POKUŠAJ PONOVO
      </button>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-[var(--surface2)] rounded-md p-3">
      <div className="text-[10px] text-[var(--muted)] tracking-widest uppercase mb-1 font-mono">{label}</div>
      <div className="font-['Bebas_Neue'] text-2xl leading-none" style={{ color }}>{value}</div>
    </div>
  );
}

function GameRow({ match }: { match: MatchSummary }) {
  const rankColor = match.rank<=5 ? '#2ecc71' : match.rank<=15 ? '#f5a623' : '#7d8590';
  const killColor = match.kills===0?'#7d8590':match.kills<=1?'#e6edf3':match.kills<=3?'#f5a623':'#2ecc71';
  return (
    <div className="grid text-xs border-b border-white/5 hover:bg-white/[0.02] transition px-3 py-2"
         style={{ gridTemplateColumns:'44px 68px 1fr 38px 64px' }}>
      <span className="font-mono font-bold" style={{ color: rankColor }}>#{match.rank}</span>
      <span className="font-mono text-[var(--muted)]">{modeShort(match.mode)}</span>
      <span className="font-mono text-[var(--muted)] truncate">{match.map}</span>
      <span className="font-['Bebas_Neue'] text-lg text-right" style={{ color: killColor }}>{match.kills}K</span>
      <span className="font-mono text-[var(--muted)] text-right">{match.damage}dmg</span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Home() {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [tab, setTab] = useState<'overview'|'charts'|'games'>('overview');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch('/api/players');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'API error');
      setData(json);
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) return <Loader />;
  if (error)   return <ErrorState msg={error} onRetry={() => fetchData()} />;
  if (!data)   return null;

  const players = data.players.filter(p => p.ok && p.data).map((p, i) => ({
    ...p.data!,
    color: COLORS[PKEYS[i]].hex,
    colorDim: COLORS[PKEYS[i]].dim,
    pkey: PKEYS[i],
    stats: calcStats(p.data!.recentMatches),
  }));

  const gameLabels = players[0]?.recentMatches.map((_, i) => `G${i+1}`) ?? [];

  // Chart datasets helpers
  const lineDataset = (p: typeof players[0], fn: (m: MatchSummary) => number) => ({
    label: p.name,
    data: p.recentMatches.map(fn),
    borderColor: p.color,
    backgroundColor: p.colorDim,
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: p.color,
    tension: 0.3,
  });

  const barDataset = (p: typeof players[0], val: number) => ({
    label: p.name,
    data: [val],
    backgroundColor: p.colorDim.replace('0.15','0.75'),
    borderColor: p.color,
    borderWidth: 2,
    borderRadius: 4,
  });

  const chartOpts = (yLabel?: string) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#ccc', boxWidth: 10, font: { size: 11 } } } },
    scales: {
      x: { grid: { color: GRID_COLOR }, ticks: { color: '#7d8590', font: { size: 10 } } },
      y: { grid: { color: GRID_COLOR }, beginAtZero: true, ticks: { color: '#7d8590' },
           ...(yLabel ? { title: { display: true, text: yLabel, color: '#7d8590' } } : {}) },
    },
  });

  const radarDatasets = players.map(p => ({
    label: p.name,
    data: [
      norm(p.stats.kd, 0, 2),
      norm(p.stats.avgDmg, 0, 500),
      norm(21 - p.stats.avgRank, 0, 10),
      norm(p.stats.consistency, 0, 100),
      norm(p.stats.top5, 0, 10),
    ],
    borderColor: p.color,
    backgroundColor: p.colorDim.replace('0.15','0.18'),
    borderWidth: 2,
    pointBackgroundColor: p.color,
    pointRadius: 4,
  }));

  // sorted leaderboard by K/D
  const sorted = [...players].sort((a,b) => b.stats.kd - a.stats.kd);
  const medals = ['🥇','🥈','🥉','4th'];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* ── HEADER ── */}
      <header className="relative text-center py-12 px-6 border-b border-[var(--border)] overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(ellipse at 50% -20%, rgba(245,166,35,0.07) 0%, transparent 70%)' }} />
        <div className="font-mono text-[11px] tracking-[4px] text-[#f5a623] opacity-80 mb-2">
          // PUBG SQUAD TRACKER — LIVE — SEZONA 40
        </div>
        <h1 className="font-['Bebas_Neue'] text-6xl tracking-widest leading-none">
          BATTLE <span className="text-[#f5a623]">STATS</span>
        </h1>
        <div className="font-mono text-[11px] tracking-[3px] text-[var(--muted)] mt-2">
          REAL-TIME · PUBG OFFICIAL API · AUTO-REFRESH 3 MIN
        </div>

        {/* Player legend */}
        <div className="flex justify-center gap-6 mt-5 flex-wrap">
          {players.map(p => (
            <div key={p.name} className="flex items-center gap-2 text-sm font-semibold tracking-wide">
              <div className="w-3 h-3 rounded-sm" style={{ background: p.color }} />
              <span style={{ color: p.color }}>{p.name}</span>
            </div>
          ))}
        </div>

        {/* Refresh status */}
        <div className="flex items-center justify-center gap-3 mt-4">
          <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--muted)]">
            <span className="w-2 h-2 rounded-full bg-[#2ecc71] pulse-dot inline-block" />
            LIVE
          </div>
          {lastRefresh && (
            <span className="text-[11px] font-mono text-[var(--muted)]">
              zadnji refresh: {lastRefresh.toLocaleTimeString('hr-HR')}
            </span>
          )}
          <button onClick={() => fetchData(true)} disabled={refreshing}
            className="text-[11px] font-mono text-[#58a6ff] hover:text-white transition disabled:opacity-40 flex items-center gap-1">
            {refreshing && <span className="w-3 h-3 border border-[#58a6ff] border-t-transparent rounded-full spinner" />}
            {refreshing ? 'REFRESHING…' : '↻ REFRESH'}
          </button>
        </div>
      </header>

      {/* ── TABS ── */}
      <div className="flex border-b border-[var(--border)] sticky top-0 z-50 bg-[var(--bg)]">
        {(['overview','charts','games'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-8 py-3 font-['Bebas_Neue'] text-lg tracking-widest transition border-b-2 ${
              tab===t ? 'border-[#f5a623] text-[#f5a623]' : 'border-transparent text-[var(--muted)] hover:text-white'
            }`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <main className="max-w-[1500px] mx-auto px-4 py-8 pb-16">

        {/* ══ TAB: OVERVIEW ══ */}
        {tab === 'overview' && (
          <div className="space-y-8 fade-up">

            {/* Player cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {players.map(p => (
                <div key={p.name}
                  className="rounded-lg p-5 relative overflow-hidden border"
                  style={{ background:'var(--surface)', borderColor: p.color+'40' }}>
                  <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: p.color }} />
                  <div className="font-['Bebas_Neue'] text-xl tracking-wide mb-1 break-all" style={{ color: p.color }}>{p.name}</div>
                  <div className="font-mono text-[10px] text-[var(--muted)] tracking-widest mb-4">// S40 · {p.recentMatches.length} igara</div>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard label="K/D" value={p.stats.kd} color={p.color} />
                    <StatCard label="Avg DMG" value={p.stats.avgDmg} color={p.color} />
                    <StatCard label="Avg Rank" value={`#${p.stats.avgRank}`} color={p.color} />
                    <StatCard label="Total Kills" value={p.stats.totalKills} color={p.color} />
                    <StatCard label="Top 5" value={`${p.stats.top5}x`} color={p.color} />
                    <StatCard label="Konzist." value={`${p.stats.consistency}%`} color={p.color} />
                    <StatCard label="Total DMG" value={p.stats.totalDmg.toLocaleString()} color={p.color} />
                    <StatCard label="Max Kills" value={p.stats.maxKills} color={p.color} />
                  </div>
                  {/* Season stats if available */}
                  {p.seasonStats && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="font-mono text-[9px] text-[#f5a623] tracking-widest mb-2">// SEASON {p.currentSeason.split('.').pop()}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <StatCard label="S Kills" value={p.seasonStats.kills} color={p.color} />
                        <StatCard label="S Wins" value={p.seasonStats.wins} color={p.color} />
                        <StatCard label="S K/D" value={p.seasonStats.kd} color={p.color} />
                        <StatCard label="S Igara" value={p.seasonStats.roundsPlayed} color={p.color} />
                        <StatCard label="S Avg DMG" value={p.seasonStats.avgDamage} color={p.color} />
                        <StatCard label="Top 10" value={p.seasonStats.top10s} color={p.color} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Leaderboard */}
            <div className="rounded-lg border border-[var(--border)] overflow-hidden" style={{ background:'var(--surface)' }}>
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <div className="font-['Bebas_Neue'] text-xl tracking-widest text-[var(--muted)]">
                  <span className="text-[10px] font-mono text-[#f5a623] border border-[#f5a623] px-2 py-0.5 mr-3">02</span>
                  LEADERBOARD — ZADNJIH 20 IGARA
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      {['#','IGRAČ','K/D','AVG DMG','AVG RANK','KILLS','TOTAL DMG','TOP 5','KONZIST.'].map(h => (
                        <th key={h} className="text-left px-4 py-3 font-mono text-[11px] tracking-widest text-[var(--muted)] uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((p, i) => (
                      <tr key={p.name} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition">
                        <td className="px-4 py-3 font-['Bebas_Neue'] text-xl">
                          <span className={i===0?'text-yellow-400':i===1?'text-gray-300':i===2?'text-orange-400':'text-[var(--muted)]'}>
                            {medals[i]}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-['Bebas_Neue'] text-base tracking-wide" style={{ color: p.color }}>{p.name}</td>
                        <td className="px-4 py-3 font-mono">{p.stats.kd}</td>
                        <td className="px-4 py-3 font-mono">{p.stats.avgDmg}</td>
                        <td className="px-4 py-3 font-mono">#{p.stats.avgRank}</td>
                        <td className="px-4 py-3 font-mono">{p.stats.totalKills}</td>
                        <td className="px-4 py-3 font-mono">{p.stats.totalDmg.toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono">{p.stats.top5}x</td>
                        <td className="px-4 py-3 font-mono">{p.stats.consistency}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB: CHARTS ══ */}
        {tab === 'charts' && (
          <div className="space-y-5 fade-up">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

              {/* K/D */}
              <div className="rounded-lg border border-[var(--border)] p-5" style={{ background:'var(--surface)' }}>
                <div className="font-['Bebas_Neue'] tracking-widest text-[var(--muted)] mb-1">K/D RATIO</div>
                <div className="font-mono text-[11px] text-[var(--muted)] opacity-50 mb-4">// zadnjih 20 igara</div>
                <div className="h-56">
                  <Bar data={{ labels:['K/D'], datasets: players.map(p=>barDataset(p, p.stats.kd)) }}
                       options={chartOpts() as any} />
                </div>
              </div>

              {/* Avg Damage */}
              <div className="rounded-lg border border-[var(--border)] p-5" style={{ background:'var(--surface)' }}>
                <div className="font-['Bebas_Neue'] tracking-widest text-[var(--muted)] mb-1">PROSJEČNI DAMAGE</div>
                <div className="font-mono text-[11px] text-[var(--muted)] opacity-50 mb-4">// avg damage per game</div>
                <div className="h-56">
                  <Bar data={{ labels:['Avg Damage'], datasets: players.map(p=>barDataset(p, p.stats.avgDmg)) }}
                       options={chartOpts() as any} />
                </div>
              </div>

              {/* Kills timeline */}
              <div className="rounded-lg border border-[var(--border)] p-5 md:col-span-2" style={{ background:'var(--surface)' }}>
                <div className="font-['Bebas_Neue'] tracking-widest text-[var(--muted)] mb-1">KILLS PO IGRI — TIMELINE</div>
                <div className="font-mono text-[11px] text-[var(--muted)] opacity-50 mb-4">// kills u svakoj od zadnjih {gameLabels.length} igara</div>
                <div className="h-72">
                  <Line data={{ labels: gameLabels, datasets: players.map(p=>lineDataset(p, m=>m.kills)) }}
                        options={chartOpts() as any} />
                </div>
              </div>

              {/* Damage timeline */}
              <div className="rounded-lg border border-[var(--border)] p-5 md:col-span-2" style={{ background:'var(--surface)' }}>
                <div className="font-['Bebas_Neue'] tracking-widest text-[var(--muted)] mb-1">DAMAGE PO IGRI — TIMELINE</div>
                <div className="font-mono text-[11px] text-[var(--muted)] opacity-50 mb-4">// damage po igri</div>
                <div className="h-72">
                  <Line data={{ labels: gameLabels, datasets: players.map(p=>({...lineDataset(p,m=>m.damage), fill:true})) }}
                        options={chartOpts() as any} />
                </div>
              </div>

              {/* Rank timeline */}
              <div className="rounded-lg border border-[var(--border)] p-5 md:col-span-2" style={{ background:'var(--surface)' }}>
                <div className="font-['Bebas_Neue'] tracking-widest text-[var(--muted)] mb-1">PLACEMENT RANK — TIMELINE</div>
                <div className="font-mono text-[11px] text-[var(--muted)] opacity-50 mb-4">// niži broj = bolji placement</div>
                <div className="h-72">
                  <Line
                    data={{ labels: gameLabels, datasets: players.map(p=>lineDataset(p, m=>m.rank)) }}
                    options={{
                      ...chartOpts(),
                      scales: {
                        x: { grid:{ color:GRID_COLOR }, ticks:{ color:'#7d8590', font:{size:10}} },
                        y: { grid:{ color:GRID_COLOR }, reverse: true, min: 1, ticks:{ color:'#7d8590', callback:(v:any)=>`#${v}` } },
                      },
                    } as any} />
                </div>
              </div>

              {/* Radar */}
              <div className="rounded-lg border border-[var(--border)] p-5 md:col-span-2" style={{ background:'var(--surface)' }}>
                <div className="font-['Bebas_Neue'] tracking-widest text-[var(--muted)] mb-1">OVERALL PERFORMANCE RADAR</div>
                <div className="font-mono text-[11px] text-[var(--muted)] opacity-50 mb-4">// usporedba po kategorijama (normalizirano)</div>
                <div className="h-96">
                  <Radar
                    data={{
                      labels: ['K/D Ratio','Avg Damage','Avg Rank\n(niži=bolje)','Konzistentnost','Top 5\nFinishes'],
                      datasets: radarDatasets,
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { labels: { color: '#ccc', boxWidth: 10, font: { size: 12 } } } },
                      scales: { r: {
                        min: 0, max: 100,
                        grid: { color: 'rgba(255,255,255,0.07)' },
                        angleLines: { color: 'rgba(255,255,255,0.07)' },
                        ticks: { display: false },
                        pointLabels: { color: '#aaa', font: { size: 11 } },
                      }},
                    } as any} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB: GAMES ══ */}
        {tab === 'games' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 fade-up">
            {players.map(p => (
              <div key={p.name} className="rounded-lg border overflow-hidden" style={{ background:'var(--surface)', borderColor: p.color+'40' }}>
                <div className="px-4 py-3 border-b font-['Bebas_Neue'] text-base tracking-widest break-all"
                     style={{ color: p.color, borderColor: p.color+'30' }}>
                  {p.name}
                  <span className="ml-2 text-[10px] font-mono text-[var(--muted)]">{p.recentMatches.length} igara</span>
                </div>
                <div className="text-xs font-mono text-[var(--muted)] grid px-3 py-1 bg-[var(--surface2)] border-b border-white/5"
                     style={{ gridTemplateColumns:'44px 68px 1fr 38px 64px' }}>
                  <span>RANK</span><span>MODE</span><span>MAP</span><span className="text-right">K</span><span className="text-right">DMG</span>
                </div>
                {p.recentMatches.map(m => <GameRow key={m.id} match={m} />)}
              </div>
            ))}
          </div>
        )}

      </main>

      <footer className="text-center py-5 font-mono text-[11px] text-[var(--muted)] border-t border-[var(--border)] opacity-40">
        PUBG SQUAD TRACKER · DATA: PUBG OFFICIAL API · AUTO-REFRESH: 3 MIN · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
