/* RepoPulse digest: what shipped in the last 24 hours.
 * No DOM in here. The browser loads it as window.RPDigest; Node (tests, scripts/digest.js) requires it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RPDigest = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOUR = 3600000;
  const MAX_REPOS = 40;
  const FAILED = ['failure', 'timed_out', 'startup_failure'];
  const PAGES_ENV = 'github-pages';

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const shortName = (nwo) => String(nwo || '').split('/').pop();
  const time = (iso) => (iso ? new Date(iso).getTime() : NaN);
  // GitHub's search wants whole seconds.
  const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

  /** Which repos get a deploy and workflow-run check: live ones, most recently pushed first, capped. */
  function candidates(repos, max = MAX_REPOS) {
    const live = (repos || [])
      .filter((r) => r && r.full_name && !r.archived)
      .sort((a, b) => (time(b.pushed_at) || 0) - (time(a.pushed_at) || 0));
    return { nwos: live.slice(0, max).map((r) => r.full_name), skipped: Math.max(0, live.length - max) };
  }

  /** One GraphQL request: merged pull requests by search, deployments per repo under aliases so one refusal stays local. */
  function buildQuery(nwos, { openPrs = false } = {}) {
    const repoParts = nwos.map((nwo, i) => {
      const [owner, name] = nwo.split('/');
      return `  d${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    deployments(first: 15, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { createdAt environment state latestStatus { state logUrl environmentUrl } }
    }
  }`;
    });
    return `query Digest($merged: String!${openPrs ? ', $open: String!' : ''}) {
  merged: search(query: $merged, type: ISSUE, first: 100) {
    issueCount
    nodes { ... on PullRequest { number title url mergedAt author { login } repository { nameWithOwner } } }
  }
${openPrs ? `  open: search(query: $open, type: ISSUE, first: 100) {
    issueCount
    nodes { ... on PullRequest { number title url createdAt author { login } repository { nameWithOwner } } }
  }
` : ''}${repoParts.join('\n')}
}`;
  }

  function deployOutcome(d) {
    const s = (d.latestStatus && d.latestStatus.state) || d.state || '';
    if (['SUCCESS', 'INACTIVE', 'ACTIVE'].includes(s)) return 'ok';
    if (['FAILURE', 'ERROR'].includes(s)) return 'failed';
    if (['DESTROYED', 'ABANDONED'].includes(s)) return 'gone';
    return 'running';
  }

  const isRateLimited = (res) =>
    res.status === 429 || (res.status === 403 && res.headers && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after') !== null));
  const resetOf = (res) => {
    const at = res.headers && Number(res.headers.get('x-ratelimit-reset'));
    return at ? at * 1000 : null;
  };

  /**
   * Fetch the raw material. Never throws for a partial failure: whatever could not be read is listed in `unchecked`.
   *   graphql(query, variables) -> fetch Response      rest(url) -> fetch Response
   * Throws only when nothing at all could be read (bad token, offline).
   */
  async function fetchDigest({ graphql, rest, login, repos, now = Date.now(), hours = 24, maxRepos = MAX_REPOS, openPrs = false, concurrency = 6 }) {
    const since = stamp(now - hours * HOUR);
    const { nwos, skipped } = candidates(repos, maxRepos);
    const raw = {
      login, hours, fetchedAt: now, since,
      merged: null, mergedMore: 0, open: null, deploys: [], runs: [],
      unchecked: { merged: '', open: '', deploys: [], runs: [] },
      checked: nwos.length, skipped, rateLimitedUntil: null, rateLimited: false,
    };
    const limited = (res) => {
      raw.rateLimited = true;
      raw.rateLimitedUntil = resetOf(res) || raw.rateLimitedUntil;
    };

    /* ---- merged pull requests and deployments: one GraphQL call ---- */
    let fatal = null;
    try {
      const res = await graphql(buildQuery(nwos, { openPrs }), {
        merged: `is:pr is:merged user:${login} merged:>=${since}`,
        ...(openPrs ? { open: `is:pr is:open draft:false user:${login}` } : {}),
      });
      if (res.status === 401) {
        fatal = new Error('GitHub rejected the token. Update it under "Add token".');
        throw fatal;
      }
      if (isRateLimited(res)) {
        limited(res);
        throw new Error("GitHub's rate limit has run out");
      }
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const json = await res.json();
      const errors = json.errors || [];
      if (errors.some((e) => e.type === 'RATE_LIMITED')) raw.rateLimited = true;
      const data = json.data || {};
      const failedAt = (key) => errors.find((e) => (e.path || [])[0] === key);
      if (!json.data && errors.length) throw new Error(errors[0].message || 'GitHub returned no data');

      if (data.merged) {
        raw.merged = (data.merged.nodes || []).filter((n) => n && n.mergedAt).map((n) => ({
          repo: n.repository.nameWithOwner, number: n.number, title: n.title, url: n.url, at: n.mergedAt, author: n.author ? n.author.login : 'ghost',
        }));
        raw.mergedMore = Math.max(0, (data.merged.issueCount || 0) - raw.merged.length);
      } else {
        raw.unchecked.merged = (failedAt('merged') || {}).message || 'GitHub returned no merged pull requests';
      }
      if (openPrs) {
        if (data.open) {
          raw.open = (data.open.nodes || []).filter((n) => n && n.number).map((n) => ({
            repo: n.repository.nameWithOwner, number: n.number, title: n.title, url: n.url, createdAt: n.createdAt, author: n.author ? n.author.login : 'ghost',
          }));
        } else {
          raw.unchecked.open = (failedAt('open') || {}).message || 'GitHub returned no open pull requests';
        }
      }
      nwos.forEach((nwo, i) => {
        const node = data[`d${i}`];
        if (!node || !node.deployments) return void raw.unchecked.deploys.push(nwo);
        (node.deployments.nodes || []).filter(Boolean).forEach((d) => {
          raw.deploys.push({
            repo: nwo, environment: d.environment || 'deployment', at: d.createdAt, outcome: deployOutcome(d),
            url: (d.latestStatus && (d.latestStatus.environmentUrl || d.latestStatus.logUrl)) || `https://github.com/${nwo}/deployments`,
          });
        });
      });
    } catch (err) {
      if (err === fatal) throw err;
      const why = err && err.message === 'Failed to fetch' ? "the request didn't reach GitHub" : (err && err.message) || 'unknown error';
      raw.unchecked.merged = why;
      if (openPrs) raw.unchecked.open = why;
      raw.unchecked.deploys = nwos.slice();
      raw.offline = Boolean(err && (err.message === 'Failed to fetch' || err.name === 'TypeError'));
    }

    /* ---- workflow runs: one REST call per repo, a few at a time ---- */
    const queue = nwos.slice();
    let stop = raw.offline === true;
    async function worker() {
      while (queue.length) {
        const nwo = queue.shift();
        if (stop) {
          raw.unchecked.runs.push(nwo);
          continue;
        }
        try {
          const res = await rest(`https://api.github.com/repos/${nwo}/actions/runs?created=${encodeURIComponent('>=' + since)}&per_page=50&exclude_pull_requests=true`);
          if (isRateLimited(res)) {
            limited(res);
            stop = true;
            raw.unchecked.runs.push(nwo);
            continue;
          }
          if (res.status === 404) continue; // Actions is off for this repo, or it has gone
          if (!res.ok) {
            raw.unchecked.runs.push(nwo);
            continue;
          }
          const json = await res.json();
          (json.workflow_runs || []).forEach((w) => {
            raw.runs.push({
              repo: nwo, id: w.id, workflowId: w.workflow_id, name: w.name || 'workflow', branch: w.head_branch || '',
              event: w.event || '', status: w.status, conclusion: w.conclusion, url: w.html_url, at: w.created_at, title: w.display_title || '',
            });
          });
        } catch {
          raw.unchecked.runs.push(nwo);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, nwos.length)) }, worker));

    const nothing = raw.merged === null && raw.unchecked.deploys.length === nwos.length && raw.unchecked.runs.length === nwos.length;
    if (nothing) {
      const err = new Error(raw.rateLimited ? rateText(raw.rateLimitedUntil) : raw.offline ? "The request didn't reach GitHub. Check your connection." : `GitHub couldn't be read: ${raw.unchecked.merged}.`);
      err.rateLimited = raw.rateLimited;
      throw err;
    }
    delete raw.offline;
    return raw;
  }

  function rateText(until) {
    const at = until ? ` It resets at ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '';
    return `GitHub's rate limit has run out.${at}`;
  }

  /**
   * Pure: turn the raw material into what the view and the three-line summary need.
   *   raw      what fetchDigest returned (or a saved copy of it)
   *   openPrs  [{ repo, number, title, url, createdAt, author, note }] or null when they could not be read
   *   now      epoch ms; the window is the `hours` before it
   */
  function summarise(raw, openPrs, { now = Date.now(), hours } = {}) {
    raw = raw || {};
    const span = hours || raw.hours || 24;
    const from = now - span * HOUR;
    const inWindow = (iso) => {
      const t = time(iso);
      return t >= from && t <= now + 5 * 60000; // a little slack for clocks that disagree
    };
    const newest = (a, b) => time(b.at) - time(a.at);
    const unchecked = { merged: '', open: '', deploys: [], runs: [], ...(raw.unchecked || {}) };

    /* merged pull requests */
    const mergedKnown = Array.isArray(raw.merged);
    const merged = (raw.merged || []).filter((m) => inWindow(m.at)).sort(newest);

    /* deploys: one line per repo and environment */
    const envs = new Map();
    (raw.deploys || []).filter((d) => inWindow(d.at) && d.outcome !== 'gone').sort(newest).forEach((d) => {
      const key = `${d.repo}\n${d.environment}`;
      const g = envs.get(key);
      if (g) g.count++;
      else envs.set(key, { repo: d.repo, environment: d.environment, pages: d.environment === PAGES_ENV, count: 1, at: d.at, outcome: d.outcome, url: d.url });
    });
    const deployGroups = Array.from(envs.values());
    const failedDeploys = deployGroups.filter((d) => d.outcome === 'failed');
    const goodDeploys = deployGroups.filter((d) => d.outcome !== 'failed');
    const deployCount = goodDeploys.reduce((n, d) => n + d.count, 0);

    /* workflow runs: per repo, workflow and branch, the latest finished run decides */
    const flows = new Map();
    (raw.runs || []).filter((r) => inWindow(r.at)).sort(newest).forEach((r) => {
      const key = `${r.repo}\n${r.workflowId || r.name}\n${r.branch}`;
      if (!flows.has(key)) flows.set(key, []);
      flows.get(key).push(r);
    });
    const failedRuns = [];
    const recoveredRuns = [];
    flows.forEach((runs) => {
      const failures = runs.filter((r) => FAILED.includes(r.conclusion));
      if (!failures.length) return;
      const finished = runs.filter((r) => r.status === 'completed' || r.conclusion);
      const last = failures[0];
      const entry = { repo: last.repo, name: last.name, branch: last.branch, event: last.event, count: failures.length, at: last.at, url: last.url, title: last.title, retrying: runs[0] !== finished[0] };
      if (finished[0] && finished[0].conclusion === 'success') recoveredRuns.push(entry);
      else failedRuns.push(entry);
    });
    failedRuns.sort(newest);
    recoveredRuns.sort(newest);

    /* open pull requests */
    const prsKnown = Array.isArray(openPrs);
    const prs = (openPrs || []).map((p) => ({ ...p, fresh: inWindow(p.createdAt) })).sort((a, b) => time(a.createdAt) - time(b.createdAt));

    /* needs you: failures first, then pull requests; within each, keep a repo's items together */
    const byRepo = (list) => list.slice().sort((a, b) => (a.repo === b.repo ? 0 : a.repo < b.repo ? -1 : 1));
    const needsYou = [
      ...byRepo(failedRuns).map((r) => ({ kind: 'run', ...r })),
      ...byRepo(failedDeploys).map((d) => ({ kind: 'deploy', ...d })),
      ...byRepo(prs).map((p) => ({ kind: 'pr', ...p })),
    ];

    /* what shipped, by repo, busiest and most recent first */
    const groups = new Map();
    const group = (nwo) => {
      if (!groups.has(nwo)) groups.set(nwo, { repo: nwo, name: shortName(nwo), merged: [], deploys: [], recovered: [], latest: 0 });
      return groups.get(nwo);
    };
    const touch = (g, iso) => (g.latest = Math.max(g.latest, time(iso) || 0));
    merged.forEach((m) => { const g = group(m.repo); g.merged.push(m); touch(g, m.at); });
    goodDeploys.forEach((d) => { const g = group(d.repo); g.deploys.push(d); touch(g, d.at); });
    recoveredRuns.forEach((r) => { const g = group(r.repo); g.recovered.push(r); touch(g, r.at); });
    const repos = Array.from(groups.values()).sort((a, b) => b.latest - a.latest);

    const mergeRepos = new Set(merged.map((m) => m.repo)).size;
    const mergeCount = merged.length + (mergedKnown ? raw.mergedMore || 0 : 0);
    const counts = {
      merges: mergeCount, mergeRepos, deploys: deployCount, deployRepos: new Set(goodDeploys.map((d) => d.repo)).size,
      failedRuns: failedRuns.length, recoveredRuns: recoveredRuns.length, failedDeploys: failedDeploys.length,
      openPrs: prs.length, needsYou: needsYou.length,
    };

    /* ---- the three lines ---- */
    const period = span === 24 ? 'the last 24 hours' : `the last ${plural(span, 'hour')}`;
    const deployText = deployCount ? plural(deployCount, 'deploy') : '';
    let line1;
    if (!mergedKnown) line1 = `Merges not checked${deployText ? `, ${deployText}` : ''}`;
    else if (mergeCount) line1 = `${plural(mergeCount, 'merge')} across ${plural(mergeRepos, 'repo')}${deployText ? `, ${deployText}` : ''}`;
    else if (deployCount) line1 = `No merges, ${deployText} across ${plural(counts.deployRepos, 'repo')}`;
    else line1 = `Nothing merged or deployed in ${period}`;

    const names = (list, label) => {
      const shown = list.slice(0, 3).map(label).join(', ');
      return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
    };
    const runGaps = unchecked.runs.length;
    const bits = [];
    if (failedRuns.length) bits.push(`${plural(failedRuns.length, 'failed run')}: ${names(failedRuns, (r) => `${shortName(r.repo)} ${r.name}`)}`);
    if (failedDeploys.length) bits.push(`${plural(failedDeploys.length, 'failed deploy')}: ${names(failedDeploys, (d) => `${shortName(d.repo)} ${d.environment}`)}`);
    const noneChecked = runGaps > 0 && runGaps >= (raw.checked || runGaps);
    let line2 = bits.length ? bits.join('; ') : noneChecked ? 'Failed runs not checked' : 'No failed runs';
    if (runGaps && !(noneChecked && !bits.length)) line2 += ` (${plural(runGaps, 'repo')} not checked)`;

    const line3 = !prsKnown ? 'Open PRs not checked' : prs.length ? `${plural(prs.length, 'PR')} waiting on you` : 'No PRs waiting on you';

    /* ---- plain-English notes about anything missing ---- */
    const gaps = [];
    if (raw.rateLimited) gaps.push(`${rateText(raw.rateLimitedUntil)} Some of this may be missing.`);
    if (!mergedKnown) gaps.push(`Merged pull requests couldn't be read${unchecked.merged ? ` (${unchecked.merged})` : ''}.`);
    if (mergedKnown && raw.mergedMore) gaps.push(`${plural(raw.mergedMore, 'more merge')} counted but not listed.`);
    if (unchecked.deploys.length) gaps.push(`Deploys couldn't be read for ${names(unchecked.deploys, shortName)}. A fine-grained token needs read access to Deployments.`);
    if (runGaps) gaps.push(`Workflow runs couldn't be read for ${names(unchecked.runs, shortName)}.`);
    if (raw.skipped) gaps.push(`Deploys and runs were checked for the ${MAX_REPOS} most recently pushed repos; ${plural(raw.skipped, 'older repo')} skipped.`);

    const lines = [line1, line2, line3];
    return {
      hours: span, from, now, fetchedAt: raw.fetchedAt || null,
      counts, needsYou, repos, gaps, lines, text: lines.join('\n'),
      headline: repos.length ? line1.replace(/^No merges, /, '') : counts.needsYou ? 'Nothing shipped' : 'All quiet',
      quiet: !counts.needsYou && !repos.length,
    };
  }

  return { HOUR, MAX_REPOS, candidates, buildQuery, deployOutcome, fetchDigest, summarise, rateText, shortName, plural };
});
