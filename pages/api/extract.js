export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

const SYSTEM_PROMPT = `You are a freight forwarding data extraction specialist.
You will receive one or more shipping documents. For EACH distinct document:
1. Identify what type it is: MBL, HBL, CI, PL, Invoice, 수출면장, Booking Sheet, or 기타
2. Extract fields according to the rules below

Return ONLY a valid JSON array. Each element = one document:
[{
  "doc_type": "...",
  "doc_label": "...",
  "shipper": null, "consignee": null, "notify_party": null,
  "port_of_loading": null, "port_of_discharge": null,
  "vessel": null, "etd": null, "eta": null,
  "container_no": null, "seal_no": null, "container_type": null,
  "hs_code": null, "description": null, "commodity": null,
  "gross_weight": null, "measurement": null, "package_count": null,
  "invoice_no": null, "invoice_value": null,
  "incoterms": null, "freight_terms": null, "shipper_ref": null, "bl_no": null,
  "booking_no": null, "carrier": null, "cy_code": null,
  "doc_cutoff": null, "cargo_cutoff": null, "free_time": null,
  "place_of_receipt": null, "place_of_delivery": null,
  "place_of_issue": null, "surrender_type": null
}]

DOCUMENT-SPECIFIC RULES:
- Booking Sheet: Extract ONLY: carrier, vessel, port_of_loading, port_of_discharge, etd, eta, booking_no, container_type, cy_code, doc_cutoff, cargo_cutoff, free_time. Set all others null.
- CI (Commercial Invoice): Extract ONLY: shipper, consignee, notify_party, hs_code, description, commodity, package_count, invoice_no, invoice_value, incoterms, shipper_ref, gross_weight, measurement.
- PL (Packing List): Extract ONLY: gross_weight, measurement, package_count, description, container_no, seal_no.
- 수출면장: Extract ONLY: shipper, consignee, hs_code, description, gross_weight, package_count, invoice_no, invoice_value, container_no.
- MBL / HBL: Extract ALL fields available.
- Invoice: Extract ONLY: invoice_no, invoice_value, shipper, consignee, description, hs_code, incoterms, shipper_ref.

CRITICAL RULES:
- shipper/consignee/notify_party: COMPLETE — company name, full address, phone, fax, email. NEVER truncate.
- description: FULL text exactly as written. Every line, item, model, spec. NEVER summarize.
- container_no: ALL numbers joined with " / "
- seal_no: ALL numbers joined with " / "
- container_type: e.g. "2 x 40HC", "1 x 20GP"
- gross_weight/package_count/measurement: include units
- doc_label: short identifier (e.g. invoice number, BL number, booking number)
- null for any field not found
- Return ONLY JSON array, no markdown`;

async function redisGet(url, token, key) {
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(url, token, key, value) {
  await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

function mergeIntoUnified(existing = {}, newDocs = []) {
  const unified = JSON.parse(JSON.stringify(existing));
  const norm = v => v.toString().toLowerCase().replace(/\s+/g, ' ').replace(/,/g, '').trim();
  newDocs.forEach(doc => {
    const src = doc.doc_type + (doc.doc_label ? ` (${doc.doc_label})` : '');
    Object.keys(doc).forEach(key => {
      if (['doc_type', 'doc_label'].includes(key)) return;
      const val = doc[key];
      if (!val) return;
      if (!unified[key]) unified[key] = [];
      const existing_entry = unified[key].find(e => norm(e.value) === norm(val));
      if (existing_entry) {
        if (!existing_entry.sources.includes(src)) existing_entry.sources.push(src);
      } else {
        unified[key].push({ value: val, sources: [src] });
      }
    });
  });
  return unified;
}

export default async function handler(req, res) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const hasRedis = !!(kvUrl && kvToken);

  if (req.method === 'GET') {
    const { blNo } = req.query;
    if (!blNo) return res.status(400).json({ error: 'blNo required' });
    if (!hasRedis) return res.status(200).json({ unified: null });
    try {
      const job = await redisGet(kvUrl, kvToken, `job:${blNo}`);
      return res.status(200).json(job || { unified: null });
    } catch (e) {
      return res.status(200).json({ unified: null });
    }
  }

  // Save metadata (status, memo, manager)
  if (req.method === 'PATCH') {
    const { blNo, status, memo, manager } = req.body;
    if (!blNo || !hasRedis) return res.status(400).json({ error: 'invalid' });
    try {
      const job = await redisGet(kvUrl, kvToken, `job:${blNo}`) || { blNo, unified: {} };
      const updated = { ...job, status, memo, manager, updatedAt: new Date().toISOString() };
      await redisSet(kvUrl, kvToken, `job:${blNo}`, updated);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Save field edit
  if (req.method === 'PUT') {
    const { blNo, fieldKey, value, source, allEntries } = req.body;
    if (!blNo || !hasRedis) return res.status(400).json({ error: 'invalid' });
    try {
      const job = await redisGet(kvUrl, kvToken, `job:${blNo}`) || { blNo, unified: {} };
      if (!job.unified) job.unified = {};
      if (allEntries !== undefined) {
        // Delete entry mode — save all remaining entries
        job.unified[fieldKey] = allEntries;
      } else {
        // Edit mode — replace with single value
        job.unified[fieldKey] = value ? [{ value, sources: [source || '직접입력'] }] : [];
      }
      job.updatedAt = new Date().toISOString();
      await redisSet(kvUrl, kvToken, `job:${blNo}`, job);
      return res.status(200).json({ ok: true, unified: job.unified });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { parts, blNo, existingUnified } = req.body;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key missing' });

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
        messages: [{ role: 'user', content: [...parts, { type: 'text', text: `BL No: ${blNo}\n위 서류들에서 각 서류별로 정보를 추출해서 JSON 배열로 반환해주세요.` }] }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    const text = (data.content || []).map(b => b.text || '').join('');
    const newDocs = JSON.parse(text.replace(/```json|```/g, '').trim());
    const docsArray = Array.isArray(newDocs) ? newDocs : [newDocs];
    const unified = mergeIntoUnified(existingUnified || {}, docsArray);

    if (hasRedis) {
      try {
        const existing = await redisGet(kvUrl, kvToken, `job:${blNo}`) || {};
        await redisSet(kvUrl, kvToken, `job:${blNo}`, {
          ...existing, blNo, unified, updatedAt: new Date().toISOString()
        });
        const list = await redisGet(kvUrl, kvToken, 'bl_list') || [];
        await redisSet(kvUrl, kvToken, 'bl_list', [blNo, ...list.filter(b => b !== blNo)].slice(0, 500));
      } catch (e) { console.error('Redis:', e.message); }
    }
    res.status(200).json({ unified });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
