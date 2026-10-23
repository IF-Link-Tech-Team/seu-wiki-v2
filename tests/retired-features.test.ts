import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { buildApp } from '../apps/api/src/app.ts';
import { pickRepresentative } from '@aihot/backend/publication/timeline';
import { closeDb } from '@aihot/backend/db';
import { tierThreshold } from '@aihot/backend/editorial/analyze';
const app = await buildApp();
after(async () => { await app.close(); await closeDb(); });
test('retired reports return 410 across every public transport', async () => {
  for (const url of ['/api/v1/dailies','/api/v1/dailies/latest','/api/v1/dailies/2026-01-01','/api/v1/agent/daily','/api/v1/agent/daily/2026-01-01','/api/site/reports/daily','/api/site/reports/weekly/latest-page','/api/site/reports/monthly/2026-01','/feed/daily.xml','/og/reports/daily/2026-01-01.png']) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 410, url);
  }
});
test('representatives ignore the retired source flag and retain body/score ordering', () => {
  const base = { body_mode: 'full' as const, timeline_at: new Date('2026-01-01') };
  const oldOfficial = { ...base, id: 'old', first_party: true, score: 60 };
  const best = { ...base, id: 'best', first_party: false, score: 90 };
  assert.equal(pickRepresentative([oldOfficial, best]).id, 'best');
});

test('source tiers and thresholds survive while the retired channel is rejected', async () => {
  assert.deepEqual(['T1','T1_5','T2'].map(tierThreshold), [60,65,76]);
  for (const url of ['/api/site/timeline?channel=firstParty','/api/site/pool?channel=firstParty']) {
    assert.equal((await app.inject(url)).statusCode, 400, url);
  }
  for (const url of ['/api/v1/agent','/llms.txt','/openapi-v1.json','/sitemap.xml']) {
    const response=await app.inject(url);
    assert.equal(response.statusCode,200,url);
    assert.doesNotMatch(response.body,/firstParty|officialReports|\/api\/v1\/dailies|\/api\/v1\/agent\/daily|\/feed\/daily\.xml/);
  }
});
