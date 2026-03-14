// pages/api/players.ts
// Server-side API route — PUBG API key never exposed to client

import type { NextApiRequest, NextApiResponse } from 'next';
import { getFullPlayerData } from '@/lib/pubg';

const PLAYERS = ['P3T4R', 'LukaJebemImMater', 'Jole1212', 'zeljonat0r'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.PUBG_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PUBG_API_KEY environment variable not set. Add it in Vercel → Settings → Environment Variables.' });
  }

  try {
    const results = await Promise.allSettled(
      PLAYERS.map(name => getFullPlayerData(name, apiKey))
    );

    const players = results.map((r, i) => {
      if (r.status === 'fulfilled') return { ok: true, data: r.value };
      return { ok: false, name: PLAYERS[i], error: (r.reason as Error).message };
    });

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    return res.status(200).json({ players, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
