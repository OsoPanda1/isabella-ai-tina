import http from 'node:http';
import { runHypercore, decideAcceleration, demoAdapter } from './hypercore.mjs';
const port = Number(process.env.PORT || 8787);
const apiKey = process.env.HYPERCORE_API_KEY;
if (!apiKey || apiKey.length < 12) { console.error('Set HYPERCORE_API_KEY to a value of at least 12 characters.'); process.exit(1); }
const server = http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'isabella-hypercore-prototype', mode: 'demo-adapter' });
  if (req.method !== 'POST') return send(404, { error: 'not_found' });
  if (req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: 'unauthorized' });
  let raw = ''; req.on('data', chunk => { raw += chunk; if (raw.length > 30000) req.destroy(); });
  req.on('end', async () => {
    let body; try { body = JSON.parse(raw); } catch { return send(400, { error: 'invalid_json' }); }
    if (req.url === '/v1/hypercore/decide') {
      try {
        const decision = decideAcceleration(body);
        return send(200, { ok: true, schema: decision.schema, decision });
      } catch (error) { return send(400, { error: error instanceof TypeError ? error.message : 'invalid_request' }); }
    }
    if (req.url !== '/v1/hypercore/run') return send(404, { error: 'not_found' });
    try {
      const result = await runHypercore(body, demoAdapter(), { emit: event => { if (process.env.HYPERCORE_LOG_EVENTS === '1') console.log(JSON.stringify(event)); } });
      send(result.ok ? 200 : result.reason === 'deadline_exceeded' ? 504 : 422, result);
    } catch (error) { send(400, { error: error instanceof TypeError ? error.message : 'invalid_request' }); }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Hypercore demo listening on http://127.0.0.1:${port}`));
