export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

const SYSTEM_PROMPT = `You are a freight forwarding data extraction specialist.
You will receive one or more shipping documents. For EACH distinct document:
1. Identify what type it is (MBL, HBL, CI, PL, Invoice, 수출면장, or 기타)
2. Extract all available shipping information

Return ONLY a valid JSON array. Each element represents one document:
[
  {
    "doc_type": "MBL",
    "doc_label": "optional short identifier e.g. BL no or vessel name",
    "shipper": "...",
    "consignee": "...",
    "notify_party": "...",
    "port_of_loading": "...",
    "port_of_discharge": "...",
    "vessel": "...",
    "etd": "...",
    "eta": "...",
    "container_no": "...",
    "seal_no": "...",
    "hs_code": "...",
    "description": "...",
    "commodity": "...",
    "gross_weight": "...",
    "measurement": "...",
    "package_count": "...",
    "invoice_no": "...",
    "invoice_value": "...",
    "incoterms": "...",
    "freight_terms": "...",
    "shipper_ref": "...",
    "bl_no": "..."
  }
]

CRITICAL RULES:
- shipper/consignee/notify_party: COMPLETE info including company name, full address, phone, fax, email. Do NOT truncate.
- description: FULL description exactly as written. Do NOT summarize or truncate. Every line, item, model, spec.
- container_no: ALL numbers joined with " / "
- seal_no: ALL numbers joined with " / "
- gross_weight/package_count/measurement: include units
- If a field is not found use null
- Return ONLY the JSON array, no markdown, no explanation`;

// Redis REST API helper
async function redisCmd(cmd, args) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Redis not configured');
  const res = await fetch(`${url}/${cmd}/${args.map(a => encodeURIComponent(typeof a === 'object' ? JSON.stringify(a) : a)).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result;
}

export default async function handler(req, res) {
  // GET — load saved job
  if (req.method === 'GET') {
    const { blNo } = req.query;
    if (!blNo) return res.status(400).json({ error: 'blNo required' });
    try {
      const raw = await redisCmd('get', [`job:${blNo}`]);
      if (!raw) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(JSON.parse(raw));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET all BL list
  if (req.method === 'GET') {
    try {
      const keys = await redisCmd('keys', ['job:*']);
      return res.status(200).json({ keys: keys || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { parts, blNo, existingResults } = req.body;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key missing' });

  // Save only (no extraction)
  if (req.body.saveOnly) {
    try {
      await redisCmd('set', [`job:${blNo}`, JSON.stringify({ blNo, results: existingResults, updatedAt: new Date().toISOString() })]);
      // Update BL list
      const listRaw = await redisCmd('get', ['bl_list']);
      let list = listRaw ? JSON.parse(listRaw) : [];
      list = [blNo, ...list.filter(b => b !== blNo)].slice(0, 100);
      await redisCmd('set', ['bl_list', JSON.stringify(list)]);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

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
    try {
      await redisCmd('set', [`job:${blNo}`, JSON.stringify({ blNo, results: allResults, updatedAt: new Date().toISOString() })]);
      const listRaw = await redisCmd('get', ['bl_list']);
      let list = listRaw ? JSON.parse(listRaw) : [];
      list = [blNo, ...list.filter(b => b !== blNo)].slice(0, 100);
      await redisCmd('set', ['bl_list', JSON.stringify(list)]);
    } catch (e) {
      console.error('Redis save error:', e.message);
    }

    res.status(200).json({ results: newResults });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
