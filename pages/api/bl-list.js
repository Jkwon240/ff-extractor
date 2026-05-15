export default async function handler(req, res) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(200).json({ list: [], statusMap: {} });

  try {
    const r = await fetch(`${url}/get/bl_list`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await r.json();
    let list = [];
    if (data.result) {
      list = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    }

    // Fetch status for each BL (batch via mget)
    let statusMap = {};
    if (list.length > 0) {
      const keys = list.map(bl => `job:${bl}`);
      const mgetRes = await fetch(`${url}/mget/${keys.map(k => encodeURIComponent(k)).join('/')}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const mgetData = await mgetRes.json();
      const results = mgetData.result || [];
      list.forEach((bl, i) => {
        try {
          const job = results[i] ? JSON.parse(results[i]) : null;
          if (job?.status) statusMap[bl] = job.status;
        } catch {}
      });
    }

    res.status(200).json({ list, statusMap });
  } catch (e) {
    console.error('bl-list error:', e.message);
    res.status(200).json({ list: [], statusMap: {} });
  }
}
