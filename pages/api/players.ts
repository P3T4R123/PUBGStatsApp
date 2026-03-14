// pages/api/players.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAllPlayersData } from '@/lib/pubg';

const PLAYERS = ['P3T4R', 'LukaJebemImMater', 'Jole1212', 'zeljonat0r'];

export const config = {
  maxDuration: 120, // Vercel: allow up to 2 min for this function
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.PUBG_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'PUBG_API_KEY nije postavljen. Idi na Vercel → Settings → Environment Variables i dodaj ga.',
    });
  }

  try {
    const playersData = await getAllPlayersData(PLAYERS, apiKey);
    const players = playersData.map(data => ({ ok: true, data }));

    // Cache 10 minutes on Vercel CDN — reduces API calls drastically
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
    return res.status(200).json({ players, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
