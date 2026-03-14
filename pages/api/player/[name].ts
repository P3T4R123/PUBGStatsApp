// pages/api/player/[name].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getFullPlayerData } from '@/lib/pubg';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { name } = req.query;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name' });

  const apiKey = process.env.PUBG_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'PUBG_API_KEY not set' });

  try {
    const data = await getFullPlayerData(name, apiKey);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({ ok: true, data, fetchedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
