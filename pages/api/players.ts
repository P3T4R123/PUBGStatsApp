// pages/api/players.ts
// Server-side API route — PUBG API key never exposed to client

import type { NextApiRequest, NextApiResponse } from 'next';
import { getFullPlayerData } from '@/lib/pubg';

const PLAYERS = ['P3T4R', 'LukaJebemImMater', 'Jole1212', 'zeljonat0r'];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.PUBG_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PUBG_API_KEY environment variable not set. Add it in Vercel → Settings → Environment Variables.' });
  }

  try {
    // Fetch sequentially with 1.5s delay between players to avoid 429 rate limit
    const players = [];
    for (let i = 0; i < PLAYERS.length; i++) {
      if (i > 0) await sleep(1500);
      try {
        const data = await getFullPlayerData(PLAYERS[i], apiKey);
        players.push({ ok: true, data });
      } catch (err: any) {
        players.push({ ok: false, name: PLAYERS[i], error: err.message });
      }
    }

    // Cache 5 minutes on Vercel edge to reduce API calls
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ players, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
