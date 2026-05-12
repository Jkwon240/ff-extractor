export default async function handler(req, res) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) return res.status(200).json({ list: [] });

  try {
    const r = await fetch(`${url}/get/bl_list`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await r.json();

    let list = [];
    if (data.result) {
      // result가 문자열이면 파싱, 이미 배열이면 그대로
      if (typeof data.result === 'string') {
        list = JSON.parse(data.result);
      } else if (Array.isArray(data.result)) {
        list = data.result;
      }
    }

    res.status(200).json({ list });
  } catch (e) {
    console.error('bl-list error:', e.message);
    res.status(200).json({ list: [] });
  }
}
