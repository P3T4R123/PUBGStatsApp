// lib/pubg.ts — optimized for 10 RPM rate limit
// Strategy:
//   1. Fetch all 4 players in ONE request (/players?filter[playerNames]=A,B,C,D)
//   2. Fetch current season in ONE request
//   3. Fetch season stats for all 4 in ONE request (/players/{id}/seasons/{season} × 4, but staggered)
//   4. Fetch only 5 recent matches per player (not 20) = 5 requests total per player
//   Total per full refresh: 1 + 1 + 4 + (5×4) = 26 requests — spread over time with caching

const BASE = 'https://api.pubg.com/shards/steam';
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const makeHeaders = (apiKey: string) => ({
  'Authorization': `Bearer ${apiKey}`,
  'Accept': 'application/vnd.api+json',
});

export interface PlayerSeason {
  kills: number;
  assists: number;
  deaths: number;
  wins: number;
  top10s: number;
  roundsPlayed: number;
  damageDealt: number;
  headshotKills: number;
  longestKill: number;
  timeSurvived: number;
  kd: number;
  avgDamage: number;
}

export interface MatchSummary {
  id: string;
  mode: string;
  map: string;
  date: string;
  rank: number;
  totalPlayers: number;
  kills: number;
  damage: number;
  assists: number;
  survived: number;
  headshots: number;
  walkDistance: number;
  rideDistance: number;
}

export interface PlayerData {
  name: string;
  id: string;
  recentMatches: MatchSummary[];
  seasonStats: PlayerSeason | null;
  currentSeason: string;
}

// ---------- core fetch ----------
async function apiFetch(url: string, apiKey: string, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: makeHeaders(apiKey),
      cache: 'no-store',
    });
    if (res.status === 429) {
      // Rate limited — wait 12s and retry
      if (attempt < retries) { await delay(12000); continue; }
      throw new Error('PUBG API rate limit (429) — try again in a minute');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`PUBG API ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json();
  }
}

// ---------- fetch all players in ONE request ----------
export async function getPlayersByNames(names: string[], apiKey: string): Promise<{ id: string; name: string; matchIds: string[] }[]> {
  const joined = names.map(encodeURIComponent).join(',');
  const data = await apiFetch(`${BASE}/players?filter[playerNames]=${joined}`, apiKey);
  return (data.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.attributes.name,
    matchIds: (p.relationships?.matches?.data ?? []).slice(0, 5).map((m: any) => m.id),
  }));
}

// ---------- current season ----------
export async function getCurrentSeason(apiKey: string): Promise<string> {
  const data = await apiFetch(`${BASE}/seasons`, apiKey);
  const current = data.data.find((s: any) => s.attributes.isCurrentSeason);
  return current?.id ?? data.data[data.data.length - 1].id;
}

// ---------- season stats for one player ----------
export async function getSeasonStats(playerId: string, seasonId: string, apiKey: string): Promise<PlayerSeason | null> {
  try {
    const data = await apiFetch(`${BASE}/players/${playerId}/seasons/${seasonId}`, apiKey);
    const attrs = data.data.attributes.gameModeStats;
    const modes = Object.values(attrs) as any[];
    let kills = 0, assists = 0, deaths = 0, wins = 0, top10s = 0,
        rounds = 0, damage = 0, headshots = 0, longestKill = 0, timeSurvived = 0;
    for (const m of modes) {
      kills        += m.kills         ?? 0;
      assists      += m.assists       ?? 0;
      deaths       += m.losses        ?? 0;
      wins         += m.wins          ?? 0;
      top10s       += m.top10s        ?? 0;
      rounds       += m.roundsPlayed  ?? 0;
      damage       += m.damageDealt   ?? 0;
      headshots    += m.headshotKills ?? 0;
      timeSurvived += m.timeSurvived  ?? 0;
      if ((m.longestKill ?? 0) > longestKill) longestKill = m.longestKill;
    }
    return {
      kills, assists, deaths, wins, top10s,
      roundsPlayed: rounds,
      damageDealt: Math.round(damage),
      headshotKills: headshots,
      longestKill: Math.round(longestKill),
      timeSurvived,
      kd: deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills,
      avgDamage: rounds > 0 ? Math.round(damage / rounds) : 0,
    };
  } catch {
    return null;
  }
}

// ---------- fetch one match ----------
async function fetchMatch(matchId: string, playerName: string, apiKey: string): Promise<MatchSummary | null> {
  try {
    const match = await apiFetch(`${BASE}/matches/${matchId}`, apiKey);
    const attrs = match.data.attributes;
    const participant = match.included?.find((inc: any) =>
      inc.type === 'participant' &&
      inc.attributes?.stats?.name?.toLowerCase() === playerName.toLowerCase()
    );
    if (!participant) return null;
    const stats = participant.attributes.stats;
    const rosters: any[] = match.included?.filter((i: any) => i.type === 'roster') ?? [];
    const myRoster = rosters.find((r: any) =>
      r.relationships?.participants?.data?.some((p: any) => p.id === participant.id)
    );
    return {
      id:           match.data.id,
      mode:         attrs.gameMode ?? 'unknown',
      map:          mapName(attrs.mapName),
      date:         attrs.createdAt,
      rank:         myRoster?.attributes?.stats?.rank ?? stats.winPlace ?? 0,
      totalPlayers: attrs.totalPlayers ?? 0,
      kills:        stats.kills          ?? 0,
      damage:       Math.round(stats.damageDealt ?? 0),
      assists:      stats.assists         ?? 0,
      survived:     Math.round(stats.timeSurvived ?? 0),
      headshots:    stats.headshotKills   ?? 0,
      walkDistance: Math.round((stats.walkDistance ?? 0) / 1000 * 100) / 100,
      rideDistance: Math.round((stats.rideDistance ?? 0) / 1000 * 100) / 100,
    };
  } catch {
    return null;
  }
}

function mapName(raw: string): string {
  const m: Record<string, string> = {
    Baltic_Main: 'Erangel', Savage_Main: 'Sanhok', Desert_Main: 'Miramar',
    DihorOtok_Main: 'Vikendi', Summerland_Main: 'Karakin', Tiger_Main: 'Taego',
    Kiki_Main: 'Deston', Neon_Main: 'Rondo', Heaven_Main: 'Airangel',
    Chimera_Main: 'Paramo',
  };
  return m[raw] ?? raw ?? 'Unknown';
}

// ---------- main export: fetch all players efficiently ----------
// Total API calls: 1 (players) + 1 (season) + 4 (season stats) + up to 20 (matches) = ~26
// Spread over ~30s with delays to stay under 10 RPM
export async function getAllPlayersData(names: string[], apiKey: string): Promise<PlayerData[]> {
  // Request 1: all players at once
  const players = await getPlayersByNames(names, apiKey);
  await delay(6500); // wait before next request

  // Request 2: current season
  const seasonId = await getCurrentSeason(apiKey);
  await delay(6500);

  const results: PlayerData[] = [];

  for (const player of players) {
    // Request 3+: season stats (one per player, staggered)
    const seasonStats = await getSeasonStats(player.id, seasonId, apiKey);
    await delay(6500);

    // Requests 4+: match details (up to 5, staggered)
    const recentMatches: MatchSummary[] = [];
    for (const matchId of player.matchIds) {
      const m = await fetchMatch(matchId, player.name, apiKey);
      if (m) recentMatches.push(m);
      await delay(6500);
    }

    results.push({
      name: player.name,
      id: player.id,
      recentMatches,
      seasonStats,
      currentSeason: seasonId,
    });
  }

  return results;
}
