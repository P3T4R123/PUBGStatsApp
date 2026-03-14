// lib/pubg.ts
// PUBG Official API wrapper — https://developer.pubg.com

const BASE = 'https://api.pubg.com/shards/steam';

const headers = (apiKey: string) => ({
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
  avgRank: number;
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
  survived: number; // seconds
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

// ---------- helpers ----------

async function apiFetch(url: string, apiKey: string) {
  const res = await fetch(url, { headers: headers(apiKey), next: { revalidate: 120 } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PUBG API ${res.status}: ${txt}`);
  }
  return res.json();
}

// ---------- public functions ----------

export async function getPlayerByName(name: string, apiKey: string): Promise<{ id: string; name: string }> {
  const data = await apiFetch(`${BASE}/players?filter[playerNames]=${encodeURIComponent(name)}`, apiKey);
  const p = data.data[0];
  return { id: p.id, name: p.attributes.name };
}

export async function getCurrentSeason(apiKey: string): Promise<string> {
  const data = await apiFetch(`${BASE}/seasons`, apiKey);
  const current = data.data.find((s: any) => s.attributes.isCurrentSeason);
  return current?.id ?? data.data[data.data.length - 1].id;
}

export async function getSeasonStats(playerId: string, seasonId: string, apiKey: string): Promise<PlayerSeason | null> {
  try {
    const data = await apiFetch(`${BASE}/players/${playerId}/seasons/${seasonId}`, apiKey);
    const attrs = data.data.attributes.gameModeStats;

    // aggregate across all modes
    const modes = Object.values(attrs) as any[];
    let kills = 0, assists = 0, deaths = 0, wins = 0, top10s = 0,
        rounds = 0, damage = 0, headshots = 0, longestKill = 0, timeSurvived = 0;

    for (const m of modes) {
      kills       += m.kills        ?? 0;
      assists     += m.assists      ?? 0;
      deaths      += m.losses       ?? 0;
      wins        += m.wins         ?? 0;
      top10s      += m.top10s       ?? 0;
      rounds      += m.roundsPlayed ?? 0;
      damage      += m.damageDealt  ?? 0;
      headshots   += m.headshotKills?? 0;
      timeSurvived+= m.timeSurvived ?? 0;
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
      avgRank: 0, // not directly available via season endpoint
    };
  } catch {
    return null;
  }
}

export async function getRecentMatches(
  playerId: string,
  playerName: string,
  apiKey: string,
  limit = 20
): Promise<MatchSummary[]> {
  // 1. Get player match list
  const playerData = await apiFetch(`${BASE}/players/${playerId}`, apiKey);
  const matchRefs: any[] = playerData.data.relationships.matches.data.slice(0, limit);

  const results: MatchSummary[] = [];

  // 2. Fetch each match (PUBG API rate limit: be conservative, fetch in small batches)
  const batchSize = 5;
  for (let i = 0; i < matchRefs.length; i += batchSize) {
    const batch = matchRefs.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map((ref: any) => apiFetch(`${BASE}/matches/${ref.id}`, apiKey))
    );
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      const match = result.value;
      const attrs = match.data.attributes;

      // find this player's participant
      const roster = match.included?.find((inc: any) =>
        inc.type === 'participant' &&
        inc.attributes?.stats?.name?.toLowerCase() === playerName.toLowerCase()
      );
      if (!roster) continue;

      const stats = roster.attributes.stats;
      const rosters: any[] = match.included?.filter((i: any) => i.type === 'roster') ?? [];
      const myRoster = rosters.find((r: any) =>
        r.relationships?.participants?.data?.some((p: any) => p.id === roster.id)
      );

      results.push({
        id:           match.data.id,
        mode:         attrs.gameMode ?? 'unknown',
        map:          mapName(attrs.mapName),
        date:         attrs.createdAt,
        rank:         myRoster?.attributes?.stats?.rank ?? stats.winPlace ?? 0,
        totalPlayers: myRoster?.attributes?.stats?.teamId ? (attrs.totalPlayers ?? 0) : (attrs.totalPlayers ?? 0),
        kills:        stats.kills         ?? 0,
        damage:       Math.round(stats.damageDealt ?? 0),
        assists:      stats.assists        ?? 0,
        survived:     Math.round(stats.timeSurvived ?? 0),
        headshots:    stats.headshotKills  ?? 0,
        walkDistance: Math.round((stats.walkDistance ?? 0) / 1000 * 100) / 100,
        rideDistance: Math.round((stats.rideDistance ?? 0) / 1000 * 100) / 100,
      });
    }
  }

  return results;
}

function mapName(raw: string): string {
  const map: Record<string, string> = {
    'Baltic_Main':     'Erangel',
    'Savage_Main':     'Sanhok',
    'Desert_Main':     'Miramar',
    'DihorOtok_Main':  'Vikendi',
    'Summerland_Main': 'Karakin',
    'Tiger_Main':      'Taego',
    'Kiki_Main':       'Deston',
    'Neon_Main':       'Rondo',
    'Heaven_Main':     'Airangel',
  };
  return map[raw] ?? raw ?? 'Unknown';
}

export async function getFullPlayerData(name: string, apiKey: string): Promise<PlayerData> {
  const { id } = await getPlayerByName(name, apiKey);
  const seasonId = await getCurrentSeason(apiKey);
  const [seasonStats, recentMatches] = await Promise.all([
    getSeasonStats(id, seasonId, apiKey),
    getRecentMatches(id, name, apiKey, 20),
  ]);
  return { name, id, recentMatches, seasonStats, currentSeason: seasonId };
}
