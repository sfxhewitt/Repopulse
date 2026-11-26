#!/usr/bin/env node
/* Print the RepoPulse 24-hour digest as three lines of plain text, for a scheduled job.
 *
 *   GITHUB_TOKEN=... node scripts/digest.js [login] [--json] [--hours=24]
 *
 * Uses the same fetching and summarising code as the app (js/digest.js). Needs Node 18 or later.
 * With no login it reports on whoever owns the token. Exit code: 0 on success, 1 if GitHub could not be read. */
'use strict';
const Digest = require('../js/digest.js');

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const hoursArg = args.find((a) => a.startsWith('--hours='));
  const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;
  if (!(hours > 0)) throw new Error('--hours needs a number above zero.');
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('Set GITHUB_TOKEN (or GH_TOKEN) to a token that can read your repos.');

  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
  const rest = (url) => fetch(url, { headers });
  const graphql = (query, variables) =>
    fetch('https://api.github.com/graphql', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });

  const me = await rest('https://api.github.com/user');
  if (me.status === 401) throw new Error('GitHub rejected the token.');
  if (!me.ok) throw new Error(`GitHub returned ${me.status} for the token's account.`);
  const viewer = (await me.json()).login;
  const login = args.find((a) => !a.startsWith('--')) || viewer;
  const own = login.toLowerCase() === viewer.toLowerCase();

  const repos = [];
  for (let page = 1; page <= 5; page++) {
    const url = own
      ? `https://api.github.com/user/repos?affiliation=owner&sort=pushed&per_page=100&page=${page}`
      : `https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=100&page=${page}`;
    const res = await rest(url);
    if (!res.ok) throw new Error(`GitHub returned ${res.status} for the repo list.`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const raw = await Digest.fetchDigest({ graphql, rest, login, repos, hours, openPrs: true });
  const model = Digest.summarise(raw, raw.open, { now: Date.now(), hours });
  if (json) console.log(JSON.stringify({ login, lines: model.lines, counts: model.counts, needsYou: model.needsYou, repos: model.repos, gaps: model.gaps }, null, 2));
  else console.log(model.text);
}

main().catch((err) => {
  console.error(`digest: ${err.message}`);
  process.exit(1);
});
