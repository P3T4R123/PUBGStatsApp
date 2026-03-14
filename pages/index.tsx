'use client';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { PlayerData, MatchSummary } from '@/lib/pubg';

const Line  = dynamic(() => import('react-chartjs-2').then(m => m.Line),  { ssr: false });
const Bar   = dynamic(() => import('react-chartjs-2').then(m => m.Bar),   { ssr: false });
const Radar = dynamic(() => import('react-chartjs-2').then(m => m.Radar), { ssr: false });

if (typeof window !== 'undefined') {
  const { Chart, CategoryScale, LinearScale, PointElement, LineElement,
          BarElement, RadialLinearScale, Tooltip, Legend, Filler } = require('chart.js');
  Chart.register(CategoryScale, LinearScale, PointElement, LineElement,
                 BarElement, RadialLinearScale, Tooltip, Legend, Filler);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface PlayerResult { ok: boolean; data?: PlayerData; name?: string; error?: string; }
interface ApiResponse  { players: PlayerResult[]; fetchedAt: string; }

interface RichPlayer extends PlayerData {
  color: string; colorDim: string; pkey: string;
  stats: ReturnType<typeof calcStats>;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = {
  p1: { hex: '#f5a623', dim: 'rgba(245,166,35,0.15)' },
  p2: { hex: '#e74c3c', dim: 'rgba(231,76,60,0.15)'  },
  p3: { hex: '#2ecc71', dim: 'rgba(46,204,113,0.15)' },
  p4: { hex: '#a78bfa', dim: 'rgba(167,139,250,0.15)'},
} as const;
const PKEYS = ['p1','p2','p3','p4'] as const;
const GRID  = 'rgba(255,255,255,0.06)';

const modeShort = (m: string) => ({ 'squad-fpp':'Sq FPP','duo-fpp':'Duo FPP','solo-fpp':'Solo FPP',
  'squad':'Squad','duo':'Duo','solo':'Solo','ibr':'IBR' }[m] ?? m);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcStats(matches: MatchSummary[]) {
  if (!matches?.length) return { kd:0, avgDmg:0, avgRank:0, totalKills:0, totalDmg:0, top5:0, consistency:0, maxKills:0 };
  const kills   = matches.map(m => m.kills);
  const totalK  = kills.reduce((a,b)=>a+b,0);
  const deaths  = matches.filter(m=>m.rank>1).length;
  const totalDmg= matches.reduce((a,m)=>a+m.damage,0);
  return {
    kd:          deaths>0 ? Math.round((totalK/deaths)*100)/100 : totalK,
    avgDmg:      Math.round(totalDmg/matches.length),
    avgRank:     Math.round(matches.reduce((a,m)=>a+m.rank,0)/matches.length*10)/10,
    totalKills:  totalK,
    totalDmg,
    top5:        matches.filter(m=>m.rank<=5).length,
    consistency: Math.round((kills.filter(k=>k>0).length/matches.length)*100),
    maxKills:    Math.max(...kills, 0),
  };
}

function norm(v: number, mn: number, mx: number) {
  return mx===mn ? 0 : Math.min(Math.max(((v-mn)/(mx-mn))*100,0),100);
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Loader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="w-10 h-10 border-2 border-[#f5a623] border-t-transparent rounded-full" style={{animation:'spin .8s linear infinite'}} />
      <p className="font-mono text-xs tracking-widest text-[#7d8590]">DOHVAĆAM PODATKE… (može potrajati ~1 min zbog API rate limita)</p>
    </div>
  );
}

function ErrorBanner({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 px-6 text-center">
      <div className="text-4xl">⚠️</div>
      <div className="font-['Bebas_Neue'] text-3xl tracking-widest text-[#e74c3c]">GREŠKA</div>
      <p className="font-mono text-sm text-[#7d8590] max-w-lg">{msg}</p>
      {msg.includes('PUBG_API_KEY') && (
        <div className="bg-[#0d1117] border border-[#f5a623]/30 rounded-lg p-5 max-w-lg text-left text-sm font-mono text-[#7d8590] space-y-2">
          <p className="text-[#f5a623] font-bold mb-3">// KAKO DODATI API KLJUČ:</p>
          <p>1. developer.pubg.com → registracija → Generate API Key</p>
          <p>2. Vercel Dashboard → Settings → Environment Variables</p>
          <p>3. Dodaj: <span className="text-[#f5a623]">PUBG_API_KEY</span> = tvoj ključ</p>
          <p>4. Redeploy projekt</p>
        </div>
      )}
      <button onClick={onRetry} className="px-6 py-2 border border-[#f5a623]/40 text-[#f5a623] font-['Bebas_Neue'] tracking-widest text-lg hover:bg-[#f5a623]/10 transition rounded">
        POKUŠAJ PONOVO
      </button>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string|number; color: string }) {
  return (
    <div className="bg-[#161b22] rounded-md p-3">
      <div className="text-[10px] text-[#7d8590] tracking-widest uppercase mb-1 font-mono">{label}</div>
      <div className="font-['Bebas_Neue'] text-2xl leading-none" style={{ color }}>{value}</div>
    </div>
  );
}

function GameRow({ match }: { match: MatchSummary }) {
  const rc = match.rank<=5?'#2ecc71':match.rank<=15?'#f5a623':'#7d8590';
  const kc = match.kills===0?'#7d8590':match.kills<=1?'#e6edf3':match.kills<=3?'#f5a623':'#2ecc71';
  return (
    <div className="grid text-xs border-b border-white/5 hover:bg-white/[0.02] px-3 py-2"
         style={{ gridTemplateColumns:'44px 60px 1fr 36px 60px' }}>
      <span className="font-mono font-bold" style={{color:rc}}>#{match.rank}</span>
      <span className="font-mono text-[#7d8590]">{modeShort(match.mode)}</span>
      <span className="font-mono text-[#7d8590] truncate">{match.map}</span>
      <span className="font-['Bebas_Neue'] text-lg text-right" style={{color:kc}}>{match.kills}K</span>
      <span className="font-mono text-[#7d8590] text-right">{match.damage}dmg</span>
    </div>
  );
}

function FailedPlayerCard({ name, color, error }: { name: string; color: string; error?: string }) {
  return (
    <div className="rounded-lg p-5 relative overflow-hidden border border-white/10 bg-[#0d1117]">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{background:color}} />
      <div className="font-['Bebas_Neue'] text-xl tracking-wide mb-1 break-all" style={{color}}>{name}</div>
      <div className="font-mono text-[10px] text-[#7d8590] mb-4">// PODACI NEDOSTUPNI</div>
      <div className="bg-[#161b22] rounded p-3 text-[11px] font-mono text-[#e74c3c]">
        {error?.includes('429') ? '⏳ Rate limit — podaci će se učitati pri sljedećem refreshu (3 min)' : `⚠ ${error}`}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [data,       setData]       = useState<ApiResponse|null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string|null>(null);
  const [lastRefresh,setLastRefresh]= useState<Date|null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'overview'|'charts'|'games'>('overview');

  const fetchData = useCallback(async (silent=false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch('/api/players');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'API greška');
      setData(json);
      setLastRefresh(new Date());
    } catch(e: any) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(() => fetchData(true), 3*60*1000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) return <Loader />;
  if (error)   return <ErrorBanner msg={error} onRetry={() => fetchData()} />;
  if (!data)   return null;

  // Build player list — preserve original index for consistent colors
  // even when some players fail due to rate limiting
  const allEntries = data.players.map((p, i) => {
    const pkey  = PKEYS[Math.min(i, PKEYS.length-1)];
    const color = COLORS[pkey].hex;
    const dim   = COLORS[pkey].dim;
    if (!p.ok || !p.data) return { ok: false as const, name: p.data?.name ?? p.name ?? '???', color, error: p.error };
    const rich: RichPlayer = { ...p.data, color, colorDim: dim, pkey, stats: calcStats(p.data.recentMatches) };
    return { ok: true as const, name: rich.name, color, data: rich };
  });

  const players = allEntries.filter(e => e.ok && 'data' in e).map(e => (e as any).data as RichPlayer);
  const hasPlayers = players.length > 0;
  const gameLabels = (players[0]?.recentMatches ?? []).map((_,i) => `G${i+1}`);

  const lineDs = (p: RichPlayer, fn: (m: MatchSummary) => number) => ({
    label: p.name, data: (p.recentMatches ?? []).map(fn),
    borderColor: p.color, backgroundColor: p.colorDim,
    borderWidth: 2, pointRadius: 3, pointBackgroundColor: p.color, tension: 0.3,
  });
  const barDs = (p: RichPlayer, val: number) => ({
    label: p.name, data: [val],
    backgroundColor: p.colorDim.replace('0.15','0.75'),
    borderColor: p.color, borderWidth: 2, borderRadius: 4,
  });
  const chartOpts = () => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color:'#ccc', boxWidth:10, font:{size:11} } } },
    scales: {
      x: { grid:{color:GRID}, ticks:{color:'#7d8590',font:{size:10}} },
      y: { grid:{color:GRID}, beginAtZero:true, ticks:{color:'#7d8590'} },
    },
  });

  const sorted = [...players].sort((a,b) => b.stats.kd - a.stats.kd);
  const medals = ['🥇','🥈','🥉','4th'];

  return (
    <div className="min-h-screen" style={{background:'#070a0f'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* HEADER */}
      <header className="relative text-center py-12 px-6 border-b border-[#21262d] overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{background:'radial-gradient(ellipse at 50% -20%,rgba(245,166,35,0.07) 0%,transparent 70%)'}} />
        <div className="font-mono text-[11px] tracking-[4px] text-[#f5a623] opacity-80 mb-2">// PUBG SQUAD TRACKER — LIVE — SEZONA 40</div>
        <h1 className="font-['Bebas_Neue'] text-6xl tracking-widest leading-none text-white">
          BATTLE <span className="text-[#f5a623]">STATS</span>
        </h1>
        <div className="font-mono text-[11px] tracking-[3px] text-[#7d8590] mt-2">REAL-TIME · PUBG OFFICIAL API · AUTO-REFRESH 3 MIN</div>

        <div className="flex justify-center gap-6 mt-5 flex-wrap">
          {allEntries.map(e => (
            <div key={e.name} className="flex items-center gap-2 text-sm font-semibold tracking-wide">
              <div className="w-3 h-3 rounded-sm" style={{background:e.color}} />
              <span style={{color:e.color}}>{e.name}</span>
              {!e.ok && <span className="text-[10px] font-mono text-[#e74c3c]">(429)</span>}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 mt-4">
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#7d8590]">
            <span className="w-2 h-2 rounded-full bg-[#2ecc71] inline-block" style={{animation:'pulse 1.4s ease-in-out infinite'}} />
            LIVE
          </div>
          {lastRefresh && <span className="text-[11px] font-mono text-[#7d8590]">zadnji refresh: {lastRefresh.toLocaleTimeString('hr-HR')}</span>}
          <button onClick={() => fetchData(true)} disabled={refreshing}
            className="text-[11px] font-mono text-[#58a6ff] hover:text-white transition disabled:opacity-40 flex items-center gap-1">
            {refreshing && <span className="w-3 h-3 border border-[#58a6ff] border-t-transparent rounded-full inline-block" style={{animation:'spin .8s linear infinite'}} />}
            {refreshing ? 'REFRESHING…' : '↻ REFRESH'}
          </button>
        </div>

        {allEntries.some(e => !e.ok) && (
          <div className="mt-3 inline-block bg-[#e74c3c]/10 border border-[#e74c3c]/30 rounded px-4 py-2 font-mono text-[11px] text-[#e74c3c]">
            ⏳ {allEntries.filter(e=>!e.ok).map(e=>e.name).join(', ')} — rate limit (429), automatski retry za 3 min
          </div>
        )}
      </header>

      {/* TABS */}
      <div className="flex border-b border-[#21262d] sticky top-0 z-50 bg-[#070a0f]">
        {(['overview','charts','games'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-8 py-3 font-['Bebas_Neue'] text-lg tracking-widest transition border-b-2 ${
              tab===t ? 'border-[#f5a623] text-[#f5a623]' : 'border-transparent text-[#7d8590] hover:text-white'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <main className="max-w-[1500px] mx-auto px-4 py-8 pb-16">

        {/* ══ OVERVIEW ══ */}
        {tab==='overview' && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {allEntries.map(e => {
                if (!e.ok || !('data' in e)) return <FailedPlayerCard key={e.name} name={e.name} color={e.color} error={e.error} />;
                const p = e.data as RichPlayer;
                return (
                  <div key={p.name} className="rounded-lg p-5 relative overflow-hidden border" style={{background:'#0d1117', borderColor: p.color+'40'}}>
                    <div className="absolute top-0 left-0 right-0 h-[3px]" style={{background:p.color}} />
                    <div className="font-['Bebas_Neue'] text-xl tracking-wide mb-1 break-all" style={{color:p.color}}>{p.name}</div>
                    <div className="font-mono text-[10px] text-[#7d8590] tracking-widest mb-4">// S40 · {p.recentMatches?.length ?? 0} igara</div>
                    <div className="grid grid-cols-2 gap-2">
                      <StatCard label="K/D"      value={p.stats.kd}                        color={p.color} />
                      <StatCard label="Avg DMG"  value={p.stats.avgDmg}                    color={p.color} />
                      <StatCard label="Avg Rank" value={`#${p.stats.avgRank}`}             color={p.color} />
                      <StatCard label="Kills"    value={p.stats.totalKills}                color={p.color} />
                      <StatCard label="Top 5"    value={`${p.stats.top5}x`}               color={p.color} />
                      <StatCard label="Konzist." value={`${p.stats.consistency}%`}         color={p.color} />
                      <StatCard label="Tot DMG"  value={p.stats.totalDmg.toLocaleString()} color={p.color} />
                      <StatCard label="Max Kills" value={p.stats.maxKills}                 color={p.color} />
                    </div>
                    {p.seasonStats && (
                      <div className="mt-3 pt-3 border-t border-white/5">
                        <div className="font-mono text-[9px] text-[#f5a623] tracking-widest mb-2">// SEASON TOTALS</div>
                        <div className="grid grid-cols-2 gap-2">
                          <StatCard label="S Kills"   value={p.seasonStats.kills}         color={p.color} />
                          <StatCard label="S Wins"    value={p.seasonStats.wins}          color={p.color} />
                          <StatCard label="S K/D"     value={p.seasonStats.kd}            color={p.color} />
                          <StatCard label="S Igara"   value={p.seasonStats.roundsPlayed}  color={p.color} />
                          <StatCard label="S Avg DMG" value={p.seasonStats.avgDamage}     color={p.color} />
                          <StatCard label="Top 10"    value={p.seasonStats.top10s}        color={p.color} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Leaderboard */}
            {hasPlayers && (
              <div className="rounded-lg border border-[#21262d] overflow-hidden bg-[#0d1117]">
                <div className="px-5 py-4 border-b border-[#21262d] font-['Bebas_Neue'] text-xl tracking-widest text-[#7d8590]">
                  <span className="text-[10px] font-mono text-[#f5a623] border border-[#f5a623] px-2 py-0.5 mr-3">02</span>
                  LEADERBOARD — ZADNJIH {players[0]?.recentMatches?.length ?? 0} IGARA
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#21262d]">
                        {['#','IGRAČ','K/D','AVG DMG','AVG RANK','KILLS','TOTAL DMG','TOP 5','KONZIST.'].map(h=>(
                          <th key={h} className="text-left px-4 py-3 font-mono text-[11px] tracking-widest text-[#7d8590] uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p,i)=>(
                        <tr key={p.name} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition">
                          <td className="px-4 py-3 font-['Bebas_Neue'] text-xl">
                            <span className={i===0?'text-yellow-400':i===1?'text-gray-300':i===2?'text-orange-400':'text-[#7d8590]'}>{medals[i]}</span>
                          </td>
                          <td className="px-4 py-3 font-['Bebas_Neue'] text-base tracking-wide" style={{color:p.color}}>{p.name}</td>
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
            )}
          </div>
        )}

        {/* ══ CHARTS ══ */}
        {tab==='charts' && (
          <div className="space-y-5">
            {!hasPlayers ? (
              <div className="text-center py-20 font-mono text-[#7d8590]">⏳ Čekam podatke igrača… (rate limit, refresh za 3 min)</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                <div className="rounded-lg border border-[#21262d] p-5 bg-[#0d1117]">
                  <div className="font-['Bebas_Neue'] tracking-widest text-[#7d8590] mb-1">K/D RATIO</div>
                  <div className="font-mono text-[11px] text-[#7d8590] opacity-50 mb-4">// zadnjih {players[0]?.recentMatches?.length} igara</div>
                  <div className="h-56"><Bar data={{labels:['K/D'], datasets:players.map(p=>barDs(p,p.stats.kd))}} options={chartOpts() as any} /></div>
                </div>

                <div className="rounded-lg border border-[#21262d] p-5 bg-[#0d1117]">
                  <div className="font-['Bebas_Neue'] tracking-widest text-[#7d8590] mb-1">PROSJEČNI DAMAGE</div>
                  <div className="font-mono text-[11px] text-[#7d8590] opacity-50 mb-4">// avg damage per game</div>
                  <div className="h-56"><Bar data={{labels:['Avg Damage'], datasets:players.map(p=>barDs(p,p.stats.avgDmg))}} options={chartOpts() as any} /></div>
                </div>

                <div className="rounded-lg border border-[#21262d] p-5 bg-[#0d1117] md:col-span-2">
                  <div className="font-['Bebas_Neue'] tracking-widest text-[#7d8590] mb-1">KILLS PO IGRI — TIMELINE</div>
                  <div className="font-mono text-[11px] text-[#7d8590] opacity-50 mb-4">// svaka igra</div>
                  <div className="h-72"><Line data={{labels:gameLabels, datasets:players.map(p=>lineDs(p,m=>m.kills))}} options={chartOpts() as any} /></div>
                </div>

                <div className="rounded-lg border border-[#21262d] p-5 bg-[#0d1117] md:col-span-2">
                  <div className="font-['Bebas_Neue'] tracking-widest text-[#7d8590] mb-1">DAMAGE PO IGRI — TIMELINE</div>
                  <div className="font-mono text-[11px] text-[#7d8590] opacity-50 mb-4">// svaka igra</div>
                  <div className="h-72"><Line data={{labels:gameLabels, datasets:players.map(p=>({...lineDs(p,m=>m.damage),fill:true}))}} options={chartOpts() as any} /></div>
                </div>

                <div className="rounded-lg border border-[#21262d] p-5 bg-[#0d1117] md:col-span-2">
                  <div className="font-['Bebas_Neue'] tracking-widest text-[#7d8590] mb-1">PLACEMENT RANK — TIMELINE</div>
                  <div className="font-mono text-[11px] text-[#7d8590] opacity-50 mb-4">// niži broj = bolji placement</div>
                  <div className="h-72">
                    <Line data={{labels:gameLabels, datasets:players.map(p=>lineDs(p,m=>m.rank))}}
                      options={{...chartOpts(), scales:{
                        x:{grid:{color:GRID},ticks:{color:'#7d8590',font:{size:10}}},
                        y:{grid:{color:GRID},reverse:true,min:1,ticks:{color:'#7d8590',callback:(v:any)=>`#${v}`}},
                      }} as any} />
                  </div>
                </div>

                <div className="rounded-lg border border-[#21262d] p-5 bg-[#0d1117] md:col-span-2">
                  <div className="font-['Bebas_Neue'] tracking-widest text-[#7d8590] mb-1">OVERALL PERFORMANCE RADAR</div>
                  <div className="font-mono text-[11px] text-[#7d8590] opacity-50 mb-4">// usporedba po kategorijama</div>
                  <div style={{height:380}}>
                    <Radar
                      data={{
                        labels:['K/D Ratio','Avg Damage','Avg Rank\n(niži=bolje)','Konzistentnost','Top 5 Finishes'],
                        datasets: players.map(p=>({
                          label:p.name,
                          data:[norm(p.stats.kd,0,2),norm(p.stats.avgDmg,0,500),norm(21-p.stats.avgRank,0,10),norm(p.stats.consistency,0,100),norm(p.stats.top5,0,10)],
                          borderColor:p.color, backgroundColor:p.colorDim.replace('0.15','0.2'),
                          borderWidth:2, pointBackgroundColor:p.color, pointRadius:4,
                        }))
                      }}
                      options={{responsive:true,maintainAspectRatio:false,
                        plugins:{legend:{labels:{color:'#ccc',boxWidth:10,font:{size:12}}}},
                        scales:{r:{min:0,max:100,grid:{color:'rgba(255,255,255,0.07)'},angleLines:{color:'rgba(255,255,255,0.07)'},ticks:{display:false},pointLabels:{color:'#aaa',font:{size:11}}}}
                      } as any} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ GAMES ══ */}
        {tab==='games' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {allEntries.map(e => {
              if (!e.ok || !('data' in e)) return (
                <div key={e.name} className="rounded-lg border border-white/10 bg-[#0d1117] p-4">
                  <div className="font-['Bebas_Neue'] text-base tracking-widest mb-2 break-all" style={{color:e.color}}>{e.name}</div>
                  <div className="font-mono text-[11px] text-[#e74c3c]">⏳ Rate limit — refresh za ~3 min</div>
                </div>
              );
              const p = e.data as RichPlayer;
              return (
                <div key={p.name} className="rounded-lg border overflow-hidden bg-[#0d1117]" style={{borderColor:p.color+'40'}}>
                  <div className="px-4 py-3 border-b font-['Bebas_Neue'] text-base tracking-widest break-all" style={{color:p.color,borderColor:p.color+'30'}}>
                    {p.name} <span className="text-[10px] font-mono text-[#7d8590]">{p.recentMatches?.length} igara</span>
                  </div>
                  <div className="text-xs font-mono text-[#7d8590] grid px-3 py-1 bg-[#161b22] border-b border-white/5"
                       style={{gridTemplateColumns:'44px 60px 1fr 36px 60px'}}>
                    <span>RANK</span><span>MODE</span><span>MAP</span><span className="text-right">K</span><span className="text-right">DMG</span>
                  </div>
                  {(p.recentMatches ?? []).map(m => <GameRow key={m.id} match={m} />)}
                </div>
              );
            })}
          </div>
        )}

      </main>

      <footer className="text-center py-5 font-mono text-[11px] text-[#7d8590] border-t border-[#21262d] opacity-40">
        PUBG SQUAD TRACKER · PUBG OFFICIAL API · AUTO-REFRESH 3 MIN · {new Date().getFullYear()}
      </footer>
    </div>
  );
}
