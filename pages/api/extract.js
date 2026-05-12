export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

const SYSTEM_PROMPT = `You are a freight forwarding data extraction specialist.
You will receive one or more shipping documents. For EACH distinct document:
1. Identify what type it is (MBL, HBL, CI, PL, Invoice, 수출면장, Booking Sheet, or 기타)
2. Extract all available shipping information

Return ONLY a valid JSON array. Each element represents one document:
[
  {
    "doc_type": "MBL",
    "doc_label": "optional short identifier e.g. BL no or vessel name",
    "shipper": null,
    "consignee": null,
    "notify_party": null,
    "port_of_loading": null,
    "port_of_discharge": null,
    "vessel": null,
    "etd": null,
    "eta": null,
    "container_no": null,
    "seal_no": null,
    "container_type": null,
    "hs_code": null,
    "description": null,
    "commodity": null,
    "gross_weight": null,
    "measurement": null,
    "package_count": null,
    "invoice_no": null,
    "invoice_value": null,
    "incoterms": null,
    "freight_terms": null,
    "shipper_ref": null,
    "bl_no": null,
    "booking_no": null,
    "carrier": null,
    "cy_code": null,
    "doc_cutoff": null,
    "cargo_cutoff": null,
    "free_time": null
  }
]

CRITICAL RULES:
- shipper/consignee/notify_party: COMPLETE info — company name, full address, phone, fax, email. Do NOT truncate.
- description: FULL description exactly as written. Do NOT summarize or truncate. Every line, item, model, spec.
- container_no: ALL numbers joined with " / "
- seal_no: ALL numbers joined with " / "
- container_type: e.g. "1 x 40HC", "2 x 20GP"
- cy_code: 장치장 코드 or CY/CFS location code
- doc_cutoff: 서류마감일시
- cargo_cutoff: 반입마감일시
- gross_weight/package_count/measurement: include units
- If a field is not found use null
- Return ONLY the JSON array, no markdown, no explanation`;

async function redisCmd(url, token, path) {
  const res = await fetch(`${url}/${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result;
}

async function redisSet(url, token, key, value) {
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

async function redisGet(url, token, key) {
  const raw = await redisCmd(url, token, `get/${encodeURIComponent(key)}`);
  return raw ? JSON.parse(raw) : null;
}

export default async function handler(req, res) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const hasRedis = !!(kvUrl && kvToken);

  // GET — load saved job
  if (req.method === 'GET') {
    const { blNo } = req.query;
    if (!blNo) return res.status(400).json({ error: 'blNo required' });
    if (!hasRedis) return res.status(404).json({ error: 'Redis not configured' });
    try {
      const job = await redisGet(kvUrl, kvToken, `job:${blNo}`);
      if (!job) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(job);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { parts, blNo, existingResults } = req.body;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key missing' });
  if (!blNo) return res.status(400).json({ error: 'blNo required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            ...parts,
            { type: 'text', text: `BL No: ${blNo}\n위 서류들에서 각 서류별로 정보를 추출해서 JSON 배열로 반환해주세요.` }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const text = (data.content || []).map(b => b.text || '').join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const newResults = Array.isArray(parsed) ? parsed : [parsed];
    const allResults = [...(existingResults || []), ...newResults];

    // Save to Redis
    if (hasRedis) {
      try {
        await redisSet(kvUrl, kvToken, `job:${blNo}`, {
          blNo, results: allResults, updatedAt: new Date().toISOString()
        });
        // Update BL list
        const list = await redisGet(kvUrl, kvToken, 'bl_list') || [];
        const newList = [blNo, ...list.filter(b => b !== blNo)].slice(0, 200);
        await redisSet(kvUrl, kvToken, 'bl_list', newList);
      } catch (e) {
        console.error('Redis error:', e.message);
      }
    }

    res.status(200).json({ results: newResults });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
