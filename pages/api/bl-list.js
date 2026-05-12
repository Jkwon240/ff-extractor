export default async function handler(req, res) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return res.status(200).json({ list: [] });
  try {
    const r = await fetch(`${url}/get/bl_list`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    const list = data.result ? JSON.parse(data.result) : [];
    res.status(200).json({ list });
  } catch { res.status(200).json({ list: [] }); }
}
