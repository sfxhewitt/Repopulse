/* Unit tests for js/digest.js. Run with: npm test */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/digest.js');

const NOW = Date.parse('2026-11-26T08:00:00Z');
const ago = (hours) => new Date(NOW - hours * 3600000).toISOString();
const pr = (repo, number, hours, extra = {}) => ({ repo: `me/${repo}`, number, title: `PR ${number}`, url: `https://github.com/me/${repo}/pull/${number}`, at: ago(hours), author: 'me', ...extra });
const run = (repo, name, conclusion, hours, extra = {}) => ({ repo: `me/${repo}`, id: Math.round(hours * 1000), workflowId: name, name, branch: 'main', event: 'push', status: conclusion ? 'completed' : 'in_progress', conclusion, url: `https://github.com/me/${repo}/actions/runs/1`, at: ago(hours), title: '', ...extra });
const deploy = (repo, environment, outcome, hours) => ({ repo: `me/${repo}`, environment, outcome, at: ago(hours), url: `https://me.github.io/${repo}/` });
const open = (repo, number, hours) => ({ repo: `me/${repo}`, number, title: `Open ${number}`, url: '#', createdAt: ago(hours), author: 'claude', note: 'Checks passed' });
const base = (over = {}) => ({ login: 'me', hours: 24, fetchedAt: NOW, checked: 5, skipped: 0, merged: [], mergedMore: 0, deploys: [], runs: [], unchecked: { merged: '', open: '', deploys: [], runs: [] }, rateLimited: false, rateLimitedUntil: null, ...over });
const sum = (raw, prs = []) => D.summarise(raw, prs, { now: NOW });

/* ---------- summarise: the three lines ---------- */
test('the example from the brief: merges, one failed run, two PRs waiting', () => {
  const raw = base({
    merged: [pr('hq', 1, 2), pr('hq', 2, 3), pr('hq', 3, 4), pr('lumen', 9, 5), pr('lumen', 10, 6), pr('plexodus', 4, 7), pr('stock-watch', 8, 20)],
    runs: [run('lumen', 'CI', 'failure', 1)],
  });
  const m = sum(raw, [open('hq', 5, 30), open('plexodus', 40, 300)]);
  assert.deepEqual(m.lines, ['7 merges across 4 repos', '1 failed run: lumen CI', '2 PRs waiting on you']);
  assert.equal(m.text, '7 merges across 4 repos\n1 failed run: lumen CI\n2 PRs waiting on you');
  assert.equal(m.text.split('\n').length, 3);
});

test('an empty night still gives three calm lines', () => {
  const m = sum(base());
  assert.deepEqual(m.lines, ['Nothing merged or deployed in the last 24 hours', 'No failed runs', 'No PRs waiting on you']);
  assert.equal(m.quiet, true);
  assert.equal(m.headline, 'All quiet');
  assert.deepEqual(m.needsYou, []);
  assert.deepEqual(m.repos, []);
  assert.deepEqual(m.gaps, []);
});

test('missing or empty input does not throw', () => {
  for (const raw of [undefined, null, {}, { merged: null }]) {
    const m = D.summarise(raw, null, { now: NOW });
    assert.equal(m.lines.length, 3);
    assert.equal(m.lines[0], 'Merges not checked');
    assert.equal(m.lines[2], 'Open PRs not checked');
  }
});

test('singular and plural wording', () => {
  const m = sum(base({ merged: [pr('hq', 1, 2)], deploys: [deploy('hq', 'github-pages', 'ok', 1)] }), [open('hq', 5, 3)]);
  assert.deepEqual(m.lines, ['1 merge across 1 repo, 1 deploy', 'No failed runs', '1 PR waiting on you']);
});

test('deploys without merges', () => {
  const m = sum(base({ deploys: [deploy('hq', 'github-pages', 'ok', 1), deploy('hq', 'github-pages', 'ok', 5), deploy('lumen', 'production', 'ok', 2)] }));
  assert.equal(m.lines[0], 'No merges, 3 deploys across 2 repos');
  assert.equal(m.headline, '3 deploys across 2 repos');
});

/* ---------- summarise: the window ---------- */
test('only the last 24 hours count', () => {
  const raw = base({
    merged: [pr('hq', 1, 23.9), pr('hq', 2, 24.1), pr('hq', 3, 72)],
    deploys: [deploy('hq', 'github-pages', 'ok', 25)],
    runs: [run('hq', 'CI', 'failure', 30)],
  });
  const m = sum(raw);
  assert.equal(m.counts.merges, 1);
  assert.equal(m.counts.deploys, 0);
  assert.equal(m.counts.failedRuns, 0);
});

test('a saved digest ages out when read later', () => {
  const raw = base({ merged: [pr('hq', 1, 2)] });
  assert.equal(D.summarise(raw, [], { now: NOW }).counts.merges, 1);
  assert.equal(D.summarise(raw, [], { now: NOW + 30 * 3600000 }).counts.merges, 0);
});

test('items with a bad date are ignored, not counted', () => {
  const m = sum(base({ merged: [{ ...pr('hq', 1, 1), at: 'not a date' }], runs: [{ ...run('hq', 'CI', 'failure', 1), at: undefined }] }));
  assert.equal(m.counts.merges, 0);
  assert.equal(m.counts.failedRuns, 0);
});

/* ---------- summarise: workflow runs ---------- */
test('a failure followed by a pass on the same workflow and branch needs nothing', () => {
  const m = sum(base({ runs: [run('hq', 'CI', 'failure', 5), run('hq', 'CI', 'success', 2)] }));
  assert.equal(m.counts.failedRuns, 0);
  assert.equal(m.counts.recoveredRuns, 1);
  assert.equal(m.lines[1], 'No failed runs');
  assert.equal(m.repos[0].recovered[0].name, 'CI');
  assert.deepEqual(m.needsYou, []);
});

test('a pass followed by a failure does need you', () => {
  const m = sum(base({ runs: [run('hq', 'CI', 'success', 5), run('hq', 'CI', 'failure', 2)] }));
  assert.equal(m.counts.failedRuns, 1);
  assert.equal(m.needsYou[0].kind, 'run');
});

test('repeat failures of one workflow collapse into one item with a count', () => {
  const m = sum(base({ runs: [run('hq', 'CI', 'failure', 5), run('hq', 'CI', 'failure', 3), run('hq', 'CI', 'failure', 1)] }));
  assert.equal(m.counts.failedRuns, 1);
  assert.equal(m.needsYou[0].count, 3);
  assert.equal(m.needsYou[0].at, ago(1));
});

test('a pass on another branch does not clear a failure', () => {
  const m = sum(base({ runs: [run('hq', 'CI', 'failure', 5), run('hq', 'CI', 'success', 2, { branch: 'feature' })] }));
  assert.equal(m.counts.failedRuns, 1);
});

test('timed-out and startup failures count; cancelled and skipped do not', () => {
  const m = sum(base({ runs: [run('a', 'x', 'timed_out', 1), run('b', 'x', 'startup_failure', 1), run('c', 'x', 'cancelled', 1), run('d', 'x', 'skipped', 1)] }));
  assert.equal(m.counts.failedRuns, 2);
});

test('a re-run still in progress is flagged, and the failure still stands', () => {
  const m = sum(base({ runs: [run('hq', 'CI', 'failure', 3), run('hq', 'CI', null, 0.1)] }));
  assert.equal(m.counts.failedRuns, 1);
  assert.equal(m.needsYou[0].retrying, true);
});

test('more than three failures are named up to three, then counted', () => {
  const m = sum(base({ runs: ['a', 'b', 'c', 'd', 'e'].map((r, i) => run(r, 'CI', 'failure', i + 1)) }));
  assert.equal(m.lines[1], '5 failed runs: a CI, b CI, c CI +2 more');
});

/* ---------- summarise: deploys ---------- */
test('deploys group by repo and environment, and Pages builds are marked', () => {
  const m = sum(base({ deploys: [deploy('hq', 'github-pages', 'ok', 1), deploy('hq', 'github-pages', 'ok', 4), deploy('hq', 'preview', 'running', 2)] }));
  assert.equal(m.counts.deploys, 3);
  const [pages, preview] = m.repos[0].deploys;
  assert.deepEqual([pages.environment, pages.count, pages.pages, pages.at], ['github-pages', 2, true, ago(1)]);
  assert.deepEqual([preview.environment, preview.count, preview.pages, preview.outcome], ['preview', 1, false, 'running']);
});

test('a failed deploy needs you and joins line two; an older failure since replaced does not', () => {
  const failed = sum(base({ deploys: [deploy('hq', 'github-pages', 'failed', 1)], runs: [run('lumen', 'CI', 'failure', 2)] }));
  assert.equal(failed.lines[1], '1 failed run: lumen CI; 1 failed deploy: hq github-pages');
  assert.deepEqual(failed.needsYou.map((n) => n.kind), ['run', 'deploy']);
  assert.equal(failed.counts.deploys, 0);
  const fixed = sum(base({ deploys: [deploy('hq', 'github-pages', 'failed', 3), deploy('hq', 'github-pages', 'ok', 1)] }));
  assert.equal(fixed.counts.failedDeploys, 0);
  assert.equal(fixed.counts.deploys, 2);
});

test('deployOutcome reads the latest status first, then the deployment state', () => {
  assert.equal(D.deployOutcome({ state: 'ACTIVE', latestStatus: { state: 'SUCCESS' } }), 'ok');
  assert.equal(D.deployOutcome({ state: 'INACTIVE', latestStatus: null }), 'ok');
  assert.equal(D.deployOutcome({ state: 'ACTIVE', latestStatus: { state: 'FAILURE' } }), 'failed');
  assert.equal(D.deployOutcome({ state: 'ERROR' }), 'failed');
  assert.equal(D.deployOutcome({ state: 'IN_PROGRESS' }), 'running');
  assert.equal(D.deployOutcome({ state: 'DESTROYED' }), 'gone');
  assert.equal(D.deployOutcome({}), 'running');
});

/* ---------- summarise: ordering ---------- */
test('needs-you puts failed runs first, then failed deploys, then open PRs, oldest PR first within a repo', () => {
  const raw = base({ runs: [run('zeta', 'CI', 'failure', 1), run('alpha', 'CI', 'failure', 2)], deploys: [deploy('hq', 'production', 'failed', 1)] });
  const m = sum(raw, [open('hq', 7, 2), open('hq', 5, 50), open('alpha', 1, 1)]);
  assert.deepEqual(m.needsYou.map((n) => `${n.kind}:${D.shortName(n.repo)}${n.number ? '#' + n.number : ''}`), ['run:alpha', 'run:zeta', 'deploy:hq', 'pr:alpha#1', 'pr:hq#5', 'pr:hq#7']);
  assert.equal(m.counts.needsYou, 6);
  assert.equal(m.needsYou.find((n) => n.number === 7).fresh, true);
  assert.equal(m.needsYou.find((n) => n.number === 5).fresh, false);
});

test('shipped work groups by repo, most recent activity first, newest item first', () => {
  const m = sum(base({ merged: [pr('old', 1, 20), pr('new', 2, 1), pr('new', 3, 0.5), pr('mid', 4, 10)], deploys: [deploy('old', 'github-pages', 'ok', 19)] }));
  assert.deepEqual(m.repos.map((g) => g.name), ['new', 'mid', 'old']);
  assert.deepEqual(m.repos[0].merged.map((x) => x.number), [3, 2]);
  assert.equal(m.repos[2].deploys.length, 1);
});

test('summarise does not change what it is given', () => {
  const raw = base({ merged: [pr('b', 1, 5), pr('a', 2, 1)], runs: [run('a', 'CI', 'failure', 5), run('a', 'CI', 'success', 1)] });
  const prs = [open('b', 2, 1), open('a', 1, 9)];
  const before = JSON.stringify([raw, prs]);
  sum(raw, prs);
  assert.equal(JSON.stringify([raw, prs]), before);
});

/* ---------- summarise: partial failures ---------- */
test('gaps are spelled out and reach the summary lines', () => {
  const raw = base({
    merged: null, checked: 5,
    unchecked: { merged: 'GitHub returned 502', open: '', deploys: ['me/hq'], runs: ['me/hq', 'me/lumen'] },
    skipped: 3,
  });
  const m = sum(raw);
  assert.equal(m.lines[0], 'Merges not checked');
  assert.equal(m.lines[1], 'No failed runs (2 repos not checked)');
  assert.equal(m.gaps.length, 4);
  assert.match(m.gaps[0], /Merged pull requests couldn't be read \(GitHub returned 502\)/);
  assert.match(m.gaps[1], /Deploys couldn't be read for hq/);
  assert.match(m.gaps[2], /Workflow runs couldn't be read for hq, lumen/);
  assert.match(m.gaps[3], /3 older repos skipped/);
});

test('when no repo could be checked for runs the line says so instead of "No failed runs"', () => {
  const m = sum(base({ checked: 2, rateLimited: true, rateLimitedUntil: NOW + 600000, unchecked: { merged: '', open: '', deploys: [], runs: ['me/a', 'me/b'] } }));
  assert.equal(m.lines[1], 'Failed runs not checked');
  assert.match(m.gaps[0], /rate limit has run out/);
});

test('failures found before a rate limit are still reported, with the gap', () => {
  const m = sum(base({ checked: 3, runs: [run('a', 'CI', 'failure', 1)], unchecked: { merged: '', open: '', deploys: [], runs: ['me/b'] } }));
  assert.equal(m.lines[1], '1 failed run: a CI (1 repo not checked)');
});

test('merges beyond the first page are counted and noted', () => {
  const m = sum(base({ merged: [pr('hq', 1, 1)], mergedMore: 4 }));
  assert.equal(m.counts.merges, 5);
  assert.match(m.gaps[0], /4 more merges counted but not listed/);
});

/* ---------- candidates and query ---------- */
test('candidates drops archived repos, sorts by last push and caps the list', () => {
  const repos = [
    { full_name: 'me/old', pushed_at: ago(900) }, { full_name: 'me/new', pushed_at: ago(1) },
    { full_name: 'me/gone', pushed_at: ago(0.5), archived: true }, { full_name: 'me/mid', pushed_at: ago(48) }, null,
  ];
  assert.deepEqual(D.candidates(repos, 2), { nwos: ['me/new', 'me/mid'], skipped: 1 });
  assert.deepEqual(D.candidates([], 2), { nwos: [], skipped: 0 });
  assert.deepEqual(D.candidates(undefined), { nwos: [], skipped: 0 });
});

test('buildQuery aliases each repo and quotes names safely', () => {
  const q = D.buildQuery(['me/hq', 'me/we"ird']);
  assert.match(q, /d0: repository\(owner: "me", name: "hq"\)/);
  assert.match(q, /d1: repository\(owner: "me", name: "we\\"ird"\)/);
  assert.doesNotMatch(q, /\$open/);
  assert.match(D.buildQuery([], { openPrs: true }), /open: search\(query: \$open/);
});

/* ---------- fetchDigest with GitHub stubbed ---------- */
const headers = (h = {}) => ({ get: (k) => (k.toLowerCase() in h ? h[k.toLowerCase()] : null) });
const reply = (status, body, h) => ({ status, ok: status >= 200 && status < 300, headers: headers(h), json: async () => body });
const REPOS = [{ full_name: 'me/hq', pushed_at: ago(1) }, { full_name: 'me/lumen', pushed_at: ago(2) }, { full_name: 'me/attic', pushed_at: ago(900), archived: true }];
const gqlOk = () => reply(200, {
  data: {
    merged: { issueCount: 1, nodes: [{ number: 12, title: 'Ship it', url: 'u', mergedAt: ago(3), author: { login: 'me' }, repository: { nameWithOwner: 'me/hq' } }] },
    open: { issueCount: 1, nodes: [{ number: 13, title: 'Waiting', url: 'u', createdAt: ago(50), author: null, repository: { nameWithOwner: 'me/lumen' } }] },
    d0: { deployments: { nodes: [{ createdAt: ago(2.9), environment: 'github-pages', state: 'ACTIVE', latestStatus: { state: 'SUCCESS', logUrl: 'log', environmentUrl: 'https://me.github.io/hq/' } }] } },
    d1: { deployments: { nodes: [] } },
  },
});
const runsOk = (url) => reply(200, { workflow_runs: url.includes('/me/lumen/') ? [{ id: 5, workflow_id: 9, name: 'CI', head_branch: 'main', event: 'push', status: 'completed', conclusion: 'failure', html_url: 'run', created_at: ago(1), display_title: 'x' }] : [] });

test('fetchDigest: the happy path asks once per live repo and feeds summarise', async () => {
  const calls = [];
  let sent;
  const raw = await D.fetchDigest({
    login: 'me', repos: REPOS, now: NOW, openPrs: true,
    graphql: async (query, variables) => { sent = { query, variables }; return gqlOk(); },
    rest: async (url) => { calls.push(url); return runsOk(url); },
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((u) => u.includes('created=%3E%3D2026-11-25T08%3A00%3A00Z') && !u.includes('attic')));
  assert.equal(sent.variables.merged, 'is:pr is:merged user:me merged:>=2026-11-25T08:00:00Z');
  assert.equal(sent.variables.open, 'is:pr is:open draft:false user:me');
  assert.deepEqual(raw.unchecked, { merged: '', open: '', deploys: [], runs: [] });
  assert.equal(raw.open[0].author, 'ghost');
  const m = D.summarise(raw, raw.open, { now: NOW });
  assert.deepEqual(m.lines, ['1 merge across 1 repo, 1 deploy', '1 failed run: lumen CI', '1 PR waiting on you']);
  assert.equal(m.repos[0].deploys[0].url, 'https://me.github.io/hq/');
  assert.deepEqual(JSON.parse(JSON.stringify(raw)), raw, 'raw survives being saved as JSON');
});

test('fetchDigest: one repo refusing deployments leaves the rest intact', async () => {
  const body = (await gqlOk().json());
  body.data.d1 = null;
  body.errors = [{ type: 'FORBIDDEN', path: ['d1', 'deployments'], message: 'Resource not accessible by personal access token' }];
  const raw = await D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, graphql: async () => reply(200, body), rest: async (u) => runsOk(u) });
  assert.deepEqual(raw.unchecked.deploys, ['me/lumen']);
  assert.equal(raw.merged.length, 1);
  assert.equal(raw.deploys.length, 1);
});

test('fetchDigest: GraphQL down, runs still read', async () => {
  const raw = await D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, graphql: async () => reply(502, {}), rest: async (u) => runsOk(u) });
  assert.equal(raw.merged, null);
  assert.equal(raw.unchecked.merged, 'GitHub returned 502');
  assert.deepEqual(raw.unchecked.deploys, ['me/hq', 'me/lumen']);
  assert.equal(raw.runs.length, 1);
  assert.equal(D.summarise(raw, [], { now: NOW }).lines[0], 'Merges not checked');
});

test('fetchDigest: a REST rate limit stops further run calls and records the reset time', async () => {
  let n = 0;
  const raw = await D.fetchDigest({
    login: 'me', repos: REPOS, now: NOW, concurrency: 1, graphql: async () => gqlOk(),
    rest: async () => { n++; return reply(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1795300000' }); },
  });
  assert.equal(n, 1, 'no second call once limited');
  assert.equal(raw.rateLimited, true);
  assert.equal(raw.rateLimitedUntil, 1795300000000);
  assert.deepEqual(raw.unchecked.runs.sort(), ['me/hq', 'me/lumen']);
  const m = D.summarise(raw, [], { now: NOW });
  assert.equal(m.lines[1], 'Failed runs not checked');
  assert.equal(m.counts.merges, 1);
});

test('fetchDigest: a secondary rate limit (retry-after) is treated the same way', async () => {
  const raw = await D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, concurrency: 1, graphql: async () => gqlOk(), rest: async () => reply(429, {}, { 'retry-after': '60' }) });
  assert.equal(raw.rateLimited, true);
  assert.equal(raw.unchecked.runs.length, 2);
});

test('fetchDigest: a plain 403 or 500 on one repo marks only that repo; 404 means no Actions', async () => {
  const raw = await D.fetchDigest({
    login: 'me', repos: [...REPOS, { full_name: 'me/quiet', pushed_at: ago(5) }], now: NOW, graphql: async () => gqlOk(),
    rest: async (u) => (u.includes('/me/hq/') ? reply(403, { message: 'Resource not accessible' }, { 'x-ratelimit-remaining': '4000' }) : u.includes('/me/quiet/') ? reply(404, {}) : runsOk(u)),
  });
  assert.deepEqual(raw.unchecked.runs, ['me/hq']);
  assert.equal(raw.rateLimited, false);
  assert.equal(raw.runs.length, 1);
});

test('fetchDigest: a thrown network error on one repo is contained', async () => {
  const raw = await D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, graphql: async () => gqlOk(), rest: async (u) => { if (u.includes('/me/hq/')) throw new Error('socket hang up'); return runsOk(u); } });
  assert.deepEqual(raw.unchecked.runs, ['me/hq']);
});

test('fetchDigest: a rejected token is fatal', async () => {
  await assert.rejects(D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, graphql: async () => reply(401, {}), rest: async (u) => runsOk(u) }), /rejected the token/);
});

test('fetchDigest: offline throws one clear error and makes no run calls', async () => {
  let n = 0;
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, graphql: offline, rest: async () => { n++; return offline(); } }), /didn't reach GitHub/);
  assert.equal(n, 0);
});

test('fetchDigest: everything rate limited throws with the reset time', async () => {
  const limited = async () => reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1795300000' });
  await assert.rejects(D.fetchDigest({ login: 'me', repos: REPOS, now: NOW, graphql: limited, rest: limited }), (err) => err.rateLimited === true && /rate limit has run out/.test(err.message));
});

test('fetchDigest: an account with no repos still reports merges', async () => {
  const raw = await D.fetchDigest({ login: 'me', repos: [], now: NOW, graphql: async () => reply(200, { data: { merged: { issueCount: 0, nodes: [] } } }), rest: async () => { throw new Error('should not be called'); } });
  assert.deepEqual(raw.merged, []);
  assert.deepEqual(D.summarise(raw, [], { now: NOW }).lines, ['Nothing merged or deployed in the last 24 hours', 'No failed runs', 'No PRs waiting on you']);
});
