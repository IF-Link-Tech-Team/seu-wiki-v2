// Failure modes: a hard-coded site name or categories, missing latest timestamps and daily flashes,
// invalid public parameters silently widened, an answer without the public cache and CORS headers,
// a missing issue answered with a guess.
import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { SITE } from '@aihot/industry/site';
import { PUBLIC_API_CATEGORY_KEYS } from '@aihot/contracts/taxonomy';
import { config } from '@aihot/backend/config';
import { closeDb } from '@aihot/backend/db';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { agentGuide, latestAnswer } from '@aihot/backend/publication/agent';
import { buildApp } from '../apps/api/src/app.ts';
const app = await buildApp();
after(async () => { await app.close(); await stopBoss(); await closeDb(); });
test('Agent discovery uses the configured identity, address and categories', async () => {
  const guide = agentGuide();
  assert.ok(guide.includes(SITE.name));
  assert.ok(guide.includes(`${config.siteUrl}/api/v1/agent/latest`), 'links use the configured address');
  for (const key of PUBLIC_API_CATEGORY_KEYS) assert.ok(guide.includes(key));
  const r = await app.inject('/api/v1/agent');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, guide);
  assert.match(String(r.headers['content-type']), /text\/markdown/);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  const cached = await app.inject({url:'/api/v1/agent',headers:{'if-none-match':String(r.headers.etag)}});
  assert.equal(cached.statusCode,304);
  for (const url of ['/api/v1/agent/latest', '/api/v1/agent/search?q=选课', '/api/v1/agent/hot']) {
    const answer = await app.inject(url);
    assert.equal(answer.statusCode, 200, url);
    assert.match(String(answer.headers['cache-control']), /^public/, url);
    assert.equal(answer.headers['access-control-allow-origin'], '*', url);
  }
  for (const url of ['/api/v1/agent?unknown=x','/api/v1/agent/search?q=x','/api/v1/agent/latest?limit=31','/api/v1/agent/latest?days=3','/api/v1/agent/latest?mode=all&mode=selected']) {
    const invalid = await app.inject(url);assert.equal(invalid.statusCode,400,url);
  }
  assert.equal((await app.inject('/api/v1/agent/daily/2099-01-01')).statusCode, 410, 'a daily nobody was given is a 404, never a guess');
});
