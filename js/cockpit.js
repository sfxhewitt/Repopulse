/* RepoPulse cockpit: what needs you, what you shipped, health, compare, cards, ask. */
(() => {
  'use strict';

  const RP = window.RP;
  const S = RP.state;
  const h = RP.escapeHtml;
  const DAY = 86400000;
  const $ = (id) => document.getElementById(id);
  const icons = () => window.lucide && window.lucide.createIcons();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / DAY : Infinity);

  const VIEWS = ['pulse', 'attention', 'shipped', 'repos', 'compare', 'ask'];
  const VIEW_LABELS = { pulse: 'Pulse', attention: 'Needs you', shipped: 'Shipped', repos: 'Repos', compare: 'Compare', ask: 'Ask' };
  const KEYS = { COCKPIT: 'repopulse_cockpit_v1', DIGEST: 'repopulse_digest_v1', RANGE: 'repopulse_ship_range', ANTHROPIC: 'repopulse_anthropic_key', MODEL: 'repopulse_anthropic_model' };
  const Digest = window.RPDigest;
  const RANGES = [1, 7, 30]; // 1 is the 24-hour digest
  const savedRange = () => {
    try { return Number(localStorage.getItem(KEYS.RANGE)); } catch { return 0; }
  };

  // status: demo | locked (no token) | loading | ready | error | unsupported (organisation)
  const C = { view: 'pulse', data: null, status: 'loading', error: '', run: 0, shipRange: RANGES.includes(savedRange()) ? savedRange() : 7, digest: { raw: null, status: 'idle', error: '', run: 0, owner: null }, compare: null, ask: { busy: false, error: '', pending: '', turns: [] } };

  /* =====================================================================
   * 1. Data: one GraphQL query per 20 repos
   * ===================================================================== */
  const QUERY = /* gql:start */ `
query Cockpit($login: String!, $cursor: String, $since: GitTimestamp!, $first: Boolean!) {
  viewer { login }
  user(login: $login) {
    contributionsCollection @include(if: $first) {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
    repositories(first: 20, after: $cursor, ownerAffiliations: OWNER, orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner isArchived isFork viewerPermission
        mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
        readmeUpper: object(expression: "HEAD:README.md") { __typename }
        readmeLower: object(expression: "HEAD:readme.md") { __typename }
        vulnerabilityAlerts(states: OPEN) { totalCount }
        languages(first: 8, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
        pullRequests(states: OPEN, first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) {
          totalCount
          nodes {
            number title url isDraft createdAt updatedAt mergeable reviewDecision headRefName
            author { login }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
          }
        }
        refs(refPrefix: "refs/heads/", first: 30) {
          totalCount
          nodes { name target { ... on Commit { committedDate } } }
        }
        defaultBranchRef {
          name
          target {
            ... on Commit {
              statusCheckRollup { state }
              history(first: 40, since: $since) {
                totalCount
                nodes { oid messageHeadline committedDate url author { name user { login } } }
              }
            }
          }
        }
      }
    }
  }
}` /* gql:end */;

  function normaliseRepo(n) {
    const head = n.defaultBranchRef;
    const commit = head && head.target ? head.target : null;
    const canPush = ['ADMIN', 'MAINTAIN', 'WRITE'].includes(n.viewerPermission);
    const languages = {};
    ((n.languages && n.languages.edges) || []).forEach((e) => (languages[e.node.name] = e.size));
    return {
      nwo: n.nameWithOwner,
      canPush,
      canAdmin: n.viewerPermission === 'ADMIN',
      mergeMethod: n.squashMergeAllowed ? 'squash' : n.mergeCommitAllowed ? 'merge' : 'rebase',
      hasReadme: Boolean(n.readmeUpper || n.readmeLower),
      alerts: n.vulnerabilityAlerts ? n.vulnerabilityAlerts.totalCount : null,
      languages,
      prCount: n.pullRequests ? n.pullRequests.totalCount : 0,
      prs: ((n.pullRequests && n.pullRequests.nodes) || []).map((p) => {
        const last = p.commits && p.commits.nodes[0];
        const roll = last && last.commit.statusCheckRollup;
        return {
          number: p.number, title: p.title, url: p.url, draft: p.isDraft, createdAt: p.createdAt, updatedAt: p.updatedAt,
          mergeable: p.mergeable, review: p.reviewDecision, author: p.author ? p.author.login : 'ghost', branch: p.headRefName,
          checks: roll ? roll.state : null,
        };
      }),
      defaultBranch: head ? head.name : null,
      branchCount: n.refs ? n.refs.totalCount : 0,
      branches: ((n.refs && n.refs.nodes) || [])
        .filter((b) => !head || b.name !== head.name)
        .map((b) => ({ name: b.name, date: b.target ? b.target.committedDate : null })),
      ci: commit && commit.statusCheckRollup ? commit.statusCheckRollup.state : null,
      commitCount: commit && commit.history ? commit.history.totalCount : 0,
      commits: ((commit && commit.history && commit.history.nodes) || []).map((c) => ({
        sha: c.oid, message: c.messageHeadline, date: c.committedDate, url: c.url,
        author: (c.author && ((c.author.user && c.author.user.login) || c.author.name)) || 'unknown',
      })),
    };
  }

  async function fetchCockpit(login) {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const out = { login, fetchedAt: Date.now(), viewer: null, calendar: null, repos: {}, warnings: [] };
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${S.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { login, cursor, since, first: page === 0 } }),
      });
      if (res.status === 401) throw new Error('GitHub rejected the token. Update it under "Add token".');
      if (!res.ok) throw new Error(`GitHub returned ${res.status} for the activity query.`);
      const json = await res.json();
      (json.errors || []).forEach((e) => {
        const msg = /vulnerabilityAlerts/.test((e.path || []).join('.')) ? 'alerts' : e.message;
        if (!out.warnings.includes(msg)) out.warnings.push(msg);
      });
      const user = json.data && json.data.user;
      if (!user) {
        if ((json.errors || []).some((e) => e.type === 'NOT_FOUND')) {
          const err = new Error('unsupported');
          err.unsupported = true;
          throw err;
        }
        throw new Error((json.errors && json.errors[0] && json.errors[0].message) || 'GitHub returned no data.');
      }
      out.viewer = json.data.viewer ? json.data.viewer.login : null;
      if (user.contributionsCollection) {
        const cal = user.contributionsCollection.contributionCalendar;
        out.calendar = {
          total: cal.totalContributions,
          days: cal.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
        };
      }
      (user.repositories.nodes || []).filter(Boolean).forEach((n) => (out.repos[n.nameWithOwner.toLowerCase()] = normaliseRepo(n)));
      if (!user.repositories.pageInfo.hasNextPage) break;
      cursor = user.repositories.pageInfo.endCursor;
    }
    return out;
  }

  const extraFor = (repo) => (C.data && repo && repo.full_name ? C.data.repos[repo.full_name.toLowerCase()] : null) || null;

  function saveCockpit() {
    if (S.mode !== 'live' || !C.data) return;
    try {
      localStorage.setItem(`${KEYS.COCKPIT}:${C.data.login.toLowerCase()}`, JSON.stringify(C.data));
    } catch (err) {
      console.warn('Could not save cockpit data:', err);
    }
  }

  function loadSavedCockpit(login) {
    try {
      return JSON.parse(localStorage.getItem(`${KEYS.COCKPIT}:${login.toLowerCase()}`) || 'null');
    } catch {
      return null;
    }
  }

  /* ---- sample data, so every view has something to show before sign-in -- */
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildDemoCockpit() {
    const rand = rng(42);
    const iso = (d) => new Date(Date.now() - d * DAY).toISOString();
    const days = [];
    for (let i = 370; i >= 0; i--) {
      const date = new Date(Date.now() - i * DAY);
      const weekend = [0, 6].includes(date.getDay());
      const quiet = i > 150 && i < 172; // a holiday
      const r = rand();
      const count = quiet ? 0 : r < (weekend ? 0.6 : 0.18) ? 0 : Math.ceil(Math.pow(rand(), 2) * (weekend ? 5 : 14));
      days.push({ date: date.toISOString().slice(0, 10), count });
    }
    const prs = {
      'vortex-sync': [
        { number: 212, title: 'Add delta compression for vector clock snapshots', mergeable: 'MERGEABLE', checks: 'SUCCESS', review: 'APPROVED', age: 2, author: 'mayalin' },
        { number: 209, title: 'Batch IndexedDB writes in a microtask', mergeable: 'MERGEABLE', checks: 'FAILURE', review: null, age: 6, author: 'alexrivera-dev' },
      ],
      'cmdk-studio': [{ number: 88, title: 'Nested action panel recipe', mergeable: 'CONFLICTING', checks: 'SUCCESS', review: null, age: 19, author: 'samirp' }],
      'prompt-eval-kit': [{ number: 54, title: 'Export side-by-side HTML diff for eval runs', mergeable: 'MERGEABLE', checks: null, review: null, age: 1, author: 'alexrivera-dev' }],
      'edge-kv-proxy': [{ number: 31, title: 'Bump Go toolchain to 1.24', mergeable: 'MERGEABLE', checks: 'PENDING', review: null, age: 0.2, author: 'dependabot' }],
    };
    const repos = {};
    S.repos.forEach((r) => {
      const age = daysSince(r.pushed_at);
      const commits = [];
      if (age < 30) {
        const n = 2 + Math.floor(rand() * 9);
        const base = (r._demoCommits || []).map((c) => c.message);
        for (let i = 0; i < n; i++) {
          commits.push({
            sha: Math.floor(rand() * 0xfffffff).toString(16).padStart(7, '0'),
            message: base[i % Math.max(base.length, 1)] || 'chore: tidy up',
            date: iso(age + rand() * (29 - age)), url: r.html_url, author: rand() < 0.8 ? 'alexrivera-dev' : 'mayalin',
          });
        }
        commits.sort((a, b) => new Date(b.date) - new Date(a.date));
      }
      repos[r.full_name.toLowerCase()] = {
        nwo: r.full_name, canPush: true, canAdmin: true, mergeMethod: 'squash',
        hasReadme: r.name !== 'shader-grid-canvas',
        alerts: { 'pg-index-advisor': 2, 'wasm-audio-dsp': 1 }[r.name] || 0,
        languages: r._demoLanguages || {},
        prs: (prs[r.name] || []).map((p) => ({
          number: p.number, title: p.title, url: `${r.html_url}/pull/${p.number}`, draft: false, createdAt: iso(p.age), updatedAt: iso(p.age / 2),
          mergeable: p.mergeable, review: p.review, author: p.author, branch: 'feature', checks: p.checks,
        })),
        prCount: (prs[r.name] || []).length,
        defaultBranch: r.default_branch, branchCount: 3,
        branches: r.name === 'edge-kv-proxy' ? ['spike/quic', 'old-metrics', 'wip-ttl'].map((name, i) => ({ name, date: iso(120 + i * 40) })) : [],
        ci: r.name === 'hypertrace-rs' ? 'FAILURE' : age < 200 ? 'SUCCESS' : null,
        commitCount: commits.length, commits,
      };
    });
    return { login: S.username, fetchedAt: Date.now(), viewer: S.username, calendar: { total: days.reduce((a, d) => a + d.count, 0), days }, repos, warnings: [] };
  }

  /* =====================================================================
   * 2. Derived: health, attention, ship log, momentum, streaks
   * ===================================================================== */
  function health(repo) {
    if (!repo || repo.archived) return null;
    const ex = extraFor(repo);
    const reasons = [];
    const take = (points, text) => reasons.push({ points, text });
    if (!repo.description) take(5, 'No description');
    if (ex && !ex.hasReadme) take(15, 'No README');
    if (!repo.private && !repo.fork && !(repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION')) take(5, 'No licence');
    if (ex && (ex.ci === 'FAILURE' || ex.ci === 'ERROR')) take(25, `CI is failing on ${ex.defaultBranch || 'the default branch'}`);
    if (ex && ex.alerts > 0) take(Math.min(30, ex.alerts * 10), plural(ex.alerts, 'open security alert'));
    const age = daysSince(repo.pushed_at);
    if (age > 365) take(25, 'No pushes for over a year');
    else if (age > 180) take(15, 'No pushes for 6+ months');
    if (ex) {
      const oldPrs = ex.prs.filter((p) => !p.draft && daysSince(p.createdAt) > 14).length;
      if (oldPrs) take(Math.min(15, oldPrs * 5), `${plural(oldPrs, 'pull request')} open for 2+ weeks`);
      const stale = staleBranches(ex).length;
      if (stale) take(Math.min(10, stale * 2), `${plural(stale, 'branch', 'branches')} untouched for 3+ months`);
    }
    const score = Math.max(0, 100 - reasons.reduce((a, r) => a + r.points, 0));
    return { score, reasons, partial: !ex, tone: score >= 85 ? 'good' : score >= 60 ? 'fair' : 'poor' };
  }

  const TONE = {
    good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
    fair: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25',
    poor: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25',
  };

  const staleBranches = (ex) => ex.branches.filter((b) => daysSince(b.date) > 90);

  function prState(p) {
    if (p.checks === 'FAILURE' || p.checks === 'ERROR') return { group: 'blocked', note: 'Checks failing' };
    if (p.mergeable === 'CONFLICTING') return { group: 'blocked', note: 'Has conflicts' };
    if (p.review === 'CHANGES_REQUESTED') return { group: 'blocked', note: 'Changes requested' };
    if (p.checks === 'PENDING' || p.checks === 'EXPECTED') return { group: 'blocked', note: 'Checks running' };
    if (p.mergeable !== 'MERGEABLE') return { group: 'blocked', note: 'GitHub is still working out if it can merge' };
    return { group: 'ready', note: p.checks === 'SUCCESS' ? 'Checks passed' : 'No checks' };
  }

  function buildAttention() {
    const g = { ready: [], blocked: [], ci: [], alerts: [], stale: [], quiet: [] };
    if (!C.data) return g;
    S.repos.forEach((repo) => {
      const ex = extraFor(repo);
      if (!ex || repo.archived) return;
      ex.prs.filter((p) => !p.draft).forEach((p) => {
        const st = prState(p);
        g[st.group].push({ repo, ex, pr: p, note: st.note });
      });
      if (ex.ci === 'FAILURE' || ex.ci === 'ERROR') g.ci.push({ repo, ex });
      if (ex.alerts > 0) g.alerts.push({ repo, ex });
      const stale = staleBranches(ex);
      if (stale.length) g.stale.push({ repo, ex, stale });
      if (!repo.fork && daysSince(repo.pushed_at) > 365) g.quiet.push({ repo, ex });
    });
    g.ready.sort((a, b) => new Date(a.pr.createdAt) - new Date(b.pr.createdAt));
    return g;
  }

  const urgentCount = (g) => g.ready.length + g.blocked.length + g.ci.length + g.alerts.length;

  function allCommits(days) {
    if (!C.data) return [];
    const cutoff = Date.now() - days * DAY;
    const out = [];
    S.repos.forEach((repo) => {
      const ex = extraFor(repo);
      if (!ex) return;
      ex.commits.forEach((c) => {
        if (new Date(c.date).getTime() >= cutoff) out.push({ ...c, repo });
      });
    });
    return out.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function momentum() {
    const heating = [];
    const cooling = [];
    if (!C.data) return { heating, cooling };
    S.repos.forEach((repo) => {
      const ex = extraFor(repo);
      if (!ex || repo.archived) return;
      const recent = ex.commits.filter((c) => daysSince(c.date) <= 14).length;
      const before = ex.commits.filter((c) => daysSince(c.date) > 14).length;
      if (recent >= 3 && recent > before) heating.push({ repo, recent, before });
      else if (before >= 3 && recent * 2 < before) cooling.push({ repo, recent, before });
    });
    heating.sort((a, b) => b.recent - b.before - (a.recent - a.before));
    cooling.sort((a, b) => b.before - b.recent - (a.before - a.recent));
    return { heating, cooling };
  }

  function streaks(days) {
    let longest = 0, run = 0, best = { count: 0, date: null };
    days.forEach((d) => {
      run = d.count > 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
      if (d.count > best.count) best = d;
    });
    let current = 0;
    let i = days.length - 1;
    if (i >= 0 && days[i].count === 0) i--; // today may not have happened yet
    for (; i >= 0 && days[i].count > 0; i--) current++;
    return { current, longest, best };
  }

  /* =====================================================================
   * 3. Views
   * ===================================================================== */
  function showView(view, opts = {}) {
    if (!VIEWS.includes(view)) view = 'pulse';
    C.view = view;
    document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('hidden', el.getAttribute('data-view') !== view));
    document.querySelectorAll('[data-nav]').forEach((el) => {
      if (el.getAttribute('data-nav') === view) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    if (!opts.keepScroll) window.scrollTo(0, 0);
    if (view === 'shipped' && C.shipRange === 1) ensureDigest();
    syncUrl();
  }

  function setShipRange(n) {
    C.shipRange = RANGES.includes(n) ? n : 7;
    try { localStorage.setItem(KEYS.RANGE, String(C.shipRange)); } catch { /* private mode */ }
    if (C.shipRange === 1) ensureDigest();
    renderShipped();
    icons();
    syncUrl();
  }

  function openDigest() {
    C.shipRange = 1;
    try { localStorage.setItem(KEYS.RANGE, '1'); } catch { /* private mode */ }
    showView('shipped');
    renderShipped();
    icons();
  }

  function syncUrl() {
    if (!C.booted) return; // app.js still needs to read ?user= from the address
    const p = new URLSearchParams();
    if (S.mode === 'live' && S.username) p.set('user', S.username);
    if (C.view !== 'pulse') p.set('view', C.view);
    if (C.view === 'shipped' && C.shipRange === 1) p.set('range', '24h');
    if (C.view === 'compare' && C.compare && C.compare.a && C.compare.b) p.set('compare', `${C.compare.a},${C.compare.b}`);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  }

  function lockedPanel(what) {
    if (C.status === 'loading') return `<div class="panel p-8 text-sm text-zinc-500 dark:text-zinc-400">Reading pull requests, checks and commits from GitHub…</div>`;
    if (C.status === 'error') {
      return `<div class="panel p-6"><p class="text-sm font-medium text-rose-600 dark:text-rose-300">Couldn't load this.</p><p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">${h(C.error)}</p></div>`;
    }
    if (C.status === 'unsupported') {
      return `<div class="panel p-6 text-sm text-zinc-600 dark:text-zinc-400">${h(what)} is available for personal accounts. @${h(S.username)} is an organisation.</div>`;
    }
    return `<div class="panel p-6 sm:p-8 max-w-xl">
      <h2 class="font-display font-bold text-2xl tracking-tight">${h(what)} needs a GitHub token</h2>
      <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-2">Pull requests, check results, alerts and your activity come from a part of GitHub's API that only answers signed-in requests. The token stays in this browser and is sent only to GitHub.</p>
      <button type="button" data-act="token" class="btn btn-accent mt-4">Add token</button>
    </div>`;
  }

  /* ---- Pulse ------------------------------------------------------------ */
  function tracePath(days) {
    const step = 8, base = 68, max = Math.max(1, ...days.map((d) => d.count));
    let d = `M0 ${base}`;
    days.forEach((day, i) => {
      const x = i * step;
      if (!day.count) return void (d += ` L${x + step} ${base}`);
      const amp = 10 + 46 * Math.min(1, day.count / max);
      d += ` L${x + 2} ${base} L${x + 3} ${base + 4} L${x + 4.2} ${(base - amp).toFixed(1)} L${x + 5.4} ${base + 7} L${x + 6.4} ${base} L${x + step} ${base}`;
    });
    return { d, width: days.length * step, base };
  }

  function renderPulse() {
    const hero = $('pulseHero');
    const extras = $('pulseExtras');
    const g = buildAttention();
    const urgent = urgentCount(g);
    document.querySelectorAll('[data-attention-count]').forEach((el) => {
      el.textContent = urgent;
      el.classList.toggle('hidden', !urgent || !C.data);
    });

    let headline, sub, cta = '';
    if (C.data) {
      const week = allCommits(7);
      const repoCount = new Set(week.map((c) => c.repo.full_name)).size;
      headline = urgent ? `${plural(urgent, 'thing')} ${urgent === 1 ? 'needs' : 'need'} you.` : 'Nothing needs you right now.';
      const st = C.data.calendar ? streaks(C.data.calendar.days) : null;
      sub = week.length ? `${plural(week.length, 'commit')} across ${plural(repoCount, 'repo')} this week.` : 'No commits on a default branch this week.';
      if (st && st.current > 1) sub += ` ${st.current}-day streak.`;
      cta = urgent ? `<button type="button" data-nav-go="attention" class="btn btn-accent h-9 px-4 text-sm">See what needs you</button>` : `<button type="button" data-nav-go="shipped" class="btn btn-quiet h-9 px-4 text-sm">See what you shipped</button>`;
      cta += `<button type="button" data-act="digest-open" class="btn btn-quiet h-9 px-4 text-sm"><i data-lucide="sunrise" class="w-3.5 h-3.5"></i>Last 24 hours</button>`;
    } else if (C.status === 'loading') {
      headline = 'Reading your repos…';
      sub = 'Pull requests, checks and commits are on their way.';
    } else if (C.status === 'error') {
      headline = "Couldn't read your activity.";
      sub = C.error;
    } else if (C.status === 'unsupported') {
      headline = `@${S.username} is an organisation.`;
      sub = 'Its repos are listed under Repos. Activity, pull requests and checks are shown for personal accounts.';
    } else {
      headline = 'Add a token to see what needs you.';
      sub = 'Pull requests, failing checks, alerts and your commit activity appear here. The token stays in this browser.';
      cta = `<button type="button" data-act="token" class="btn btn-accent h-9 px-4 text-sm">Add token</button>`;
    }

    const days = C.data && C.data.calendar ? C.data.calendar.days.slice(-180) : [];
    const t = tracePath(days.length ? days : Array.from({ length: 180 }, () => ({ count: 0 })));
    hero.innerHTML = `
      <div class="pulse-paper relative overflow-hidden rounded-xl border border-zinc-200 dark:border-white/[0.08]">
        <div class="relative h-24 sm:h-28" aria-hidden="true">
          <svg class="absolute right-6 top-0 h-full" width="${t.width}" viewBox="0 0 ${t.width} 96" preserveAspectRatio="xMaxYMid meet" fill="none">
            <path id="pulseTracePath" class="pulse-trace" d="${t.d}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
            <circle class="pulse-head" cx="${t.width}" cy="${t.base}" r="3.5"/>
          </svg>
        </div>
        <div class="relative px-5 sm:px-7 pb-6 -mt-1">
          <h1 class="font-display font-bold tracking-tight text-[2rem] leading-[1.05] sm:text-5xl text-zinc-900 dark:text-zinc-50">${h(headline)}</h1>
          <p class="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 mt-2 max-w-2xl">${h(sub)}</p>
          ${cta ? `<div class="mt-4 flex flex-wrap gap-2">${cta}</div>` : ''}
          ${days.length ? `<p class="text-xs text-zinc-500 dark:text-zinc-400 mt-4">The trace is your last ${Math.round(days.length / 30)} months on GitHub, one beat per active day.</p>` : ''}
        </div>
      </div>`;
    const path = $('pulseTracePath');
    if (path && path.getTotalLength) path.style.setProperty('--len', Math.ceil(path.getTotalLength()));

    // year grid + momentum
    if (!C.data || !C.data.calendar) {
      extras.innerHTML = '';
      return;
    }
    const all = C.data.calendar.days;
    const st = streaks(all);
    const max = Math.max(1, ...all.map((d) => d.count));
    const level = (c) => (c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / max) * 3.999)));
    const pad = new Date(all[0].date + 'T00:00:00').getDay();
    const cells = all
      .map((d, i) => {
        const idx = i + pad;
        return `<rect class="heat-${level(d.count)}" x="${Math.floor(idx / 7) * 12}" y="${(idx % 7) * 12}" width="10" height="10" rx="2"><title>${d.date}: ${d.count}</title></rect>`;
      })
      .join('');
    const cols = Math.ceil((all.length + pad) / 7);
    const mo = momentum();
    const moRow = (m, up) => `
      <button type="button" data-open-repo="${h(m.repo.full_name)}" class="w-full flex items-center justify-between gap-3 py-2 text-left border-b border-zinc-100 dark:border-white/[0.05] last:border-0 hover:text-indigo-600 dark:hover:text-indigo-300">
        <span class="text-sm font-medium truncate">${h(m.repo.name)}</span>
        <span class="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">${m.before} → ${m.recent} ${up ? '▲' : '▼'}</span>
      </button>`;
    extras.innerHTML = `
      <div class="panel p-5">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="font-display font-bold text-lg tracking-tight">The last year</h2>
          <span class="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">${RP.formatNumber(C.data.calendar.total)} contributions</span>
        </div>
        <div id="heatScroll" class="overflow-x-auto mt-3 pb-1">
          <svg width="${cols * 12}" height="84" viewBox="0 0 ${cols * 12} 84" role="img" aria-label="Contributions per day over the last year">${cells}</svg>
        </div>
        <dl class="grid grid-cols-3 gap-3 mt-4 text-sm">
          <div><dt class="text-xs text-zinc-500 dark:text-zinc-400">Current streak</dt><dd class="font-display font-bold text-2xl tabular-nums">${st.current}<span class="text-sm font-sans font-normal text-zinc-500"> days</span></dd></div>
          <div><dt class="text-xs text-zinc-500 dark:text-zinc-400">Longest streak</dt><dd class="font-display font-bold text-2xl tabular-nums">${st.longest}<span class="text-sm font-sans font-normal text-zinc-500"> days</span></dd></div>
          <div><dt class="text-xs text-zinc-500 dark:text-zinc-400">Busiest day</dt><dd class="font-display font-bold text-2xl tabular-nums">${st.best.count}</dd><dd class="text-xs text-zinc-500">${st.best.date ? RP.formatShortDate(st.best.date) : ''}</dd></div>
        </dl>
      </div>
      <div class="panel p-5">
        <h2 class="font-display font-bold text-lg tracking-tight">Momentum</h2>
        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Commits in the last two weeks against the two before.</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mt-3">
          <div>
            <h3 class="text-xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5"><i data-lucide="flame" class="w-3.5 h-3.5"></i>Heating up</h3>
            ${mo.heating.slice(0, 5).map((m) => moRow(m, true)).join('') || '<p class="text-sm text-zinc-500 py-2">Nothing picking up speed.</p>'}
          </div>
          <div>
            <h3 class="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><i data-lucide="snowflake" class="w-3.5 h-3.5"></i>Cooling off</h3>
            ${mo.cooling.slice(0, 5).map((m) => moRow(m, false)).join('') || '<p class="text-sm text-zinc-500 py-2">Nothing slowing down.</p>'}
          </div>
        </div>
      </div>`;
    const sc = $('heatScroll');
    if (sc) sc.scrollLeft = sc.scrollWidth;
  }

  /* ---- Needs you -------------------------------------------------------- */
  const repoLink = (repo) => `<button type="button" data-open-repo="${h(repo.full_name)}" class="font-mono text-xs text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-300">${h(repo.name)}</button>`;
  const row = (main, actions) => `<li class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3">${main}<div class="flex items-center gap-2 shrink-0">${actions}</div></li>`;
  const ext = (url, label) => `<a href="${h(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-quiet">${label}</a>`;

  function renderAttention() {
    const el = $('view-attention');
    if (!C.data) return void (el.innerHTML = lockedPanel('This view'));
    const g = buildAttention();
    const urgent = urgentCount(g);
    const prRow = (it, ready) =>
      row(
        `<div class="min-w-0">
          <a href="${h(it.pr.url)}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium hover:underline">${h(it.pr.title)}</a>
          <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${repoLink(it.repo)} #${it.pr.number} by ${h(it.pr.author)}, opened ${RP.formatRelativeTime(it.pr.createdAt)}. ${h(it.note)}.</p>
        </div>`,
        (ready && it.ex.canPush ? `<button type="button" data-act="merge" data-repo="${h(it.repo.full_name)}" data-num="${it.pr.number}" class="btn btn-accent"><i data-lucide="git-merge" class="w-3.5 h-3.5"></i>Merge</button>` : '') + ext(it.pr.url, 'Open')
      );
    const section = (title, hint, items) =>
      items.length
        ? `<section class="panel overflow-hidden">
            <header class="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.08] flex items-baseline justify-between gap-3">
              <h2 class="font-display font-bold text-lg tracking-tight">${title} <span class="font-mono text-sm font-normal text-zinc-500">${items.length}</span></h2>
              <p class="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400">${hint}</p>
            </header>
            <ul class="divide-y divide-zinc-100 dark:divide-white/[0.05]">${items.join('')}</ul>
          </section>`
        : '';

    const parts = [
      section('Ready to merge', 'Mergeable, with no failing checks', g.ready.map((it) => prRow(it, true))),
      section('Pull requests held up', 'Something stands between these and a merge', g.blocked.map((it) => prRow(it, false))),
      section('CI failing', 'The latest commit on the default branch is red', g.ci.map((it) =>
        row(
          `<div class="min-w-0"><p class="text-sm font-medium">${h(it.repo.name)}</p><p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Checks failed on ${h(it.ex.defaultBranch || 'the default branch')}. Last push ${RP.formatRelativeTime(it.repo.pushed_at)}.</p></div>`,
          (it.ex.canPush ? `<button type="button" data-act="rerun" data-repo="${h(it.repo.full_name)}" class="btn btn-accent"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i>Re-run failed jobs</button>` : '') + ext(`${it.repo.html_url}/actions`, 'Open')
        ))),
      section('Security alerts', 'Open Dependabot alerts', g.alerts.map((it) =>
        row(
          `<div class="min-w-0"><p class="text-sm font-medium">${h(it.repo.name)}</p><p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${plural(it.ex.alerts, 'open alert')} on its dependencies.</p></div>`,
          ext(`${it.repo.html_url}/security/dependabot`, 'Review')
        ))),
      section('Stale branches', 'Not touched for three months or more', g.stale.map((it) =>
        row(
          `<div class="min-w-0"><p class="text-sm font-medium">${h(it.repo.name)}</p><p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">${it.stale.slice(0, 4).map((b) => h(b.name)).join(', ')}${it.stale.length > 4 ? ` and ${it.stale.length - 4} more` : ''}</p></div>`,
          ext(`${it.repo.html_url}/branches/stale`, 'Open')
        ))),
      section('Gone quiet', 'No pushes for over a year', g.quiet.map((it) =>
        row(
          `<div class="min-w-0"><p class="text-sm font-medium">${h(it.repo.name)}</p><p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Last push ${RP.formatRelativeTime(it.repo.pushed_at)}.</p></div>`,
          (it.ex.canAdmin ? `<button type="button" data-act="archive" data-repo="${h(it.repo.full_name)}" class="btn btn-quiet"><i data-lucide="archive" class="w-3.5 h-3.5"></i>Archive</button>` : '') + ext(it.repo.html_url, 'Open')
        ))),
    ].join('');

    const notes = [];
    if (C.data.warnings.includes('alerts')) notes.push("This token can't read security alerts, so that section is left out.");
    if (S.mode === 'live' && C.data.viewer && C.data.viewer.toLowerCase() !== S.username.toLowerCase()) notes.push(`You're signed in as @${C.data.viewer}, so only @${S.username}'s public activity is shown.`);
    if (S.mode === 'demo') notes.push('Sample data. Buttons here change nothing.');

    el.innerHTML = `
      <div>
        <h1 class="font-display font-bold tracking-tight text-3xl sm:text-4xl">${urgent ? `${plural(urgent, 'thing')} to deal with` : 'All clear'}</h1>
        <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">${urgent ? 'Pull requests, failing checks and alerts across every repo.' : 'No open pull requests, failing checks or alerts.'} Checked ${RP.formatRelativeTime(new Date(C.data.fetchedAt).toISOString())}.</p>
        ${notes.map((n) => `<p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">${h(n)}</p>`).join('')}
      </div>
      ${parts || ''}`;
  }

  /* ---- Shipped ---------------------------------------------------------- */
  function dayLabel(iso) {
    const d = new Date(iso);
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(new Date()) - start(d)) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
  }

  function rangeButtons() {
    const range = (n, label) => `<button type="button" data-ship-range="${n}" aria-pressed="${C.shipRange === n}" class="btn ${C.shipRange === n ? 'btn-accent' : 'btn-quiet'}">${label}</button>`;
    return `<div class="flex items-center gap-2">${range(1, '24 hours')}${range(7, '7 days')}${range(30, '30 days')}</div>`;
  }

  function renderShipped() {
    const el = $('view-shipped');
    if (!C.data) return void (el.innerHTML = lockedPanel('The ship log'));
    if (C.shipRange === 1) return void renderDigest(el);
    const commits = allCommits(C.shipRange);
    const repoCount = new Set(commits.map((c) => c.repo.full_name)).size;
    const groups = [];
    commits.forEach((c) => {
      const label = dayLabel(c.date);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(c);
    });
    const perRepo = {};
    commits.forEach((c) => (perRepo[c.repo.name] = (perRepo[c.repo.name] || 0) + 1));
    const top = Object.entries(perRepo).sort((a, b) => b[1] - a[1]).slice(0, 6);
    el.innerHTML = `
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold tracking-tight text-3xl sm:text-4xl">${commits.length ? `${plural(commits.length, 'commit')} across ${plural(repoCount, 'repo')}` : 'Nothing shipped'}</h1>
          <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">Commits that reached a default branch in the last ${C.shipRange} days${top.length ? `: ${top.map(([n, c]) => `${h(n)} ${c}`).join(', ')}` : ''}.</p>
        </div>
        ${rangeButtons()}
      </div>
      ${groups
        .map(
          (gr) => `
        <section class="panel overflow-hidden">
          <header class="px-4 py-2.5 border-b border-zinc-200 dark:border-white/[0.08] flex items-baseline justify-between"><h2 class="font-display font-bold text-base">${h(gr.label)}</h2><span class="text-xs font-mono text-zinc-500">${gr.items.length}</span></header>
          <ul class="divide-y divide-zinc-100 dark:divide-white/[0.05]">
            ${gr.items
              .map(
                (c) => `
              <li class="px-4 py-2.5 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <a href="${h(c.url)}" target="_blank" rel="noopener noreferrer" class="text-sm hover:underline break-words">${h(c.message)}</a>
                  <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${repoLink(c.repo)} by ${h(c.author)}</p>
                </div>
                <span class="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">${new Date(c.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </li>`
              )
              .join('')}
          </ul>
        </section>`
        )
        .join('')}`;
  }

  /* ---- What shipped: the last 24 hours ---------------------------------- */
  const DIGEST_FRESH = 5 * 60000;

  function loadSavedDigest(login) {
    try {
      return JSON.parse(localStorage.getItem(`${KEYS.DIGEST}:${login.toLowerCase()}`) || 'null');
    } catch {
      return null;
    }
  }

  function buildDemoDigest() {
    const now = Date.now();
    const ago = (hours) => new Date(now - hours * 3600000).toISOString();
    const named = ['vortex-sync', 'cmdk-studio', 'prompt-eval-kit', 'hypertrace-rs'];
    const pick = (i) => S.repos.find((r) => r.name === named[i]) || S.repos[i % Math.max(1, S.repos.length)] || { full_name: 'demo/repo', html_url: '#' };
    const broken = pick(3);
    const pr = (i, number, title, hours) => ({ repo: pick(i).full_name, number, title, url: `${pick(i).html_url}/pull/${number}`, at: ago(hours), author: 'alexrivera-dev' });
    const run = (repo, id, name, conclusion, hours) => ({ repo: repo.full_name, id, workflowId: name, name, branch: repo.default_branch || 'main', event: 'push', status: 'completed', conclusion, url: `${repo.html_url}/actions`, at: ago(hours), title: '' });
    return {
      login: S.username, hours: 24, fetchedAt: now, since: ago(24), checked: S.repos.length, skipped: 0, rateLimited: false, rateLimitedUntil: null, mergedMore: 0, open: null,
      merged: [pr(0, 214, 'Resume sync after a dropped connection', 3), pr(0, 213, 'Trim snapshot size by a third', 9), pr(1, 90, 'Keyboard hints in the action panel', 5), pr(2, 55, 'Cache eval runs between sessions', 14)],
      deploys: [
        { repo: pick(0).full_name, environment: 'github-pages', at: ago(2.9), outcome: 'ok', url: pick(0).html_url },
        { repo: pick(0).full_name, environment: 'github-pages', at: ago(8.9), outcome: 'ok', url: pick(0).html_url },
        { repo: pick(1).full_name, environment: 'production', at: ago(4.8), outcome: 'ok', url: pick(1).html_url },
      ],
      runs: [run(broken, 1, 'CI', 'failure', 6), run(pick(2), 2, 'tests', 'failure', 15), run(pick(2), 3, 'tests', 'success', 13.5)],
      unchecked: { merged: '', open: '', deploys: [], runs: [] },
    };
  }

  function digestOpenPrs() {
    const g = buildAttention();
    const item = (ready) => (it) => ({
      repo: it.repo.full_name, number: it.pr.number, title: it.pr.title, url: it.pr.url, createdAt: it.pr.createdAt, author: it.pr.author,
      note: it.note, ready, canPush: it.ex.canPush,
    });
    return [...g.ready.map(item(true)), ...g.blocked.map(item(false))];
  }

  const digestModel = () => (C.digest.raw ? Digest.summarise(C.digest.raw, digestOpenPrs(), { now: Date.now() }) : null);
  const digestShowing = () => C.view === 'shipped' && C.shipRange === 1;

  function ensureDigest(force) {
    const D = C.digest;
    if (!C.data) return; // locked, loading or failed: the view already says so
    if (S.mode === 'demo') {
      D.run++;
      D.raw = buildDemoDigest();
      D.owner = 'demo';
      D.status = 'ready';
      D.error = '';
      return;
    }
    const login = S.username;
    if (D.owner !== login.toLowerCase()) {
      D.run++;
      D.raw = loadSavedDigest(login);
      D.owner = login.toLowerCase();
      D.status = D.raw ? 'ready' : 'idle';
      D.error = '';
    }
    const fresh = D.raw && Date.now() - D.raw.fetchedAt < DIGEST_FRESH;
    if (D.status === 'loading' || (fresh && !force) || !S.token) return;
    const run = ++D.run;
    D.status = 'loading';
    D.error = '';
    Digest.fetchDigest({
      login,
      repos: S.repos,
      rest: RP.githubFetch,
      graphql: (query, variables) =>
        fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${S.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
        }),
    })
      .then((raw) => {
        if (run !== D.run) return;
        D.raw = raw;
        try {
          localStorage.setItem(`${KEYS.DIGEST}:${login.toLowerCase()}`, JSON.stringify(raw));
        } catch (err) {
          console.warn('Could not save the digest:', err);
        }
      })
      .catch((err) => {
        if (run !== D.run) return;
        D.error = err.message === 'Failed to fetch' ? "The request didn't reach GitHub. Check your connection." : err.message;
      })
      .finally(() => {
        if (run !== D.run) return;
        D.status = D.raw ? 'ready' : 'error';
        if (digestShowing()) {
          renderShipped();
          icons();
        }
      });
  }

  async function copyDigest() {
    const model = digestModel();
    if (!model) return void RP.showToast('Nothing to copy yet', 'error');
    try {
      await navigator.clipboard.writeText(model.text);
      RP.showToast('Summary copied', 'success');
    } catch {
      RP.copyToClipboard(model.text, 'Summary copied'); // older browsers, or no clipboard permission
    }
  }

  function renderDigest(el) {
    const D = C.digest;
    const model = digestModel();
    const head = (title, sub) => `
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <h1 class="font-display font-bold tracking-tight text-3xl sm:text-4xl">${h(title)}</h1>
          <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">${sub}</p>
        </div>
        ${rangeButtons()}
      </div>`;
    el.setAttribute('data-digest-status', model ? (D.status === 'loading' ? 'refreshing' : 'ready') : D.status);
    if (!model) {
      const body = D.status === 'error'
        ? `<div class="panel p-6"><p class="text-sm font-medium text-rose-600 dark:text-rose-300">Couldn't load the last 24 hours.</p><p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">${h(D.error)}</p><button type="button" data-act="digest-refresh" class="btn btn-quiet h-10 sm:h-9 px-4 mt-4"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>Try again</button></div>`
        : `<div class="panel p-8 text-sm text-zinc-500 dark:text-zinc-400">Reading merges, deploys and workflow runs from GitHub…</div>`;
      el.innerHTML = head('What shipped', 'Merged pull requests, deploys and failed runs from the last 24 hours.') + body;
      return;
    }

    const clock = (iso) => {
      const t = new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return dayLabel(iso) === 'Today' ? t : `${dayLabel(iso) === 'Yesterday' ? 'Yesterday' : RP.formatShortDate(iso)} ${t}`;
    };
    const at = (iso) => `<span class="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0 whitespace-nowrap">${h(clock(iso))}</span>`;
    const mark = (icon, tone) => `<i data-lucide="${icon}" class="w-4 h-4 mt-0.5 shrink-0 ${tone}"></i>`;
    const RED = 'text-rose-600 dark:text-rose-400', AMBER = 'text-amber-600 dark:text-amber-400', BLUE = 'text-indigo-600 dark:text-indigo-300', GREEN = 'text-emerald-600 dark:text-emerald-400';
    const name = (nwo) => {
      const repo = findRepo(nwo);
      return repo ? repoLink(repo) : `<span class="font-mono text-xs text-zinc-500 dark:text-zinc-400">${h(Digest.shortName(nwo))}</span>`;
    };
    const sub = (html) => `<p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">${html}</p>`;
    const open = (url, label = 'Open') => `<a href="${h(url)}" target="_blank" rel="noopener noreferrer" class="btn btn-quiet h-10 sm:h-8 px-4 sm:px-3">${label}</a>`;
    const needRow = (it) => {
      if (it.kind === 'run') {
        return row(
          `<div class="flex gap-2.5 min-w-0">${mark('circle-x', RED)}<div class="min-w-0"><p class="text-sm font-medium break-words">${h(it.name)} failed</p>${sub(`${name(it.repo)}${it.branch ? ` on ${h(it.branch)}` : ''}, ${h(clock(it.at))}${it.count > 1 ? `, ${it.count} times` : ''}${it.retrying ? '. Running again now' : ''}.`)}</div></div>`,
          open(it.url, 'Open run')
        );
      }
      if (it.kind === 'deploy') {
        return row(
          `<div class="flex gap-2.5 min-w-0">${mark('cloud-off', RED)}<div class="min-w-0"><p class="text-sm font-medium break-words">${it.pages ? 'Pages build' : `Deploy to ${h(it.environment)}`} failed</p>${sub(`${name(it.repo)}, ${h(clock(it.at))}.`)}</div></div>`,
          open(it.url)
        );
      }
      return row(
        `<div class="flex gap-2.5 min-w-0">${mark('git-pull-request', AMBER)}<div class="min-w-0"><a href="${h(it.url)}" target="_blank" rel="noopener noreferrer" class="text-sm font-medium hover:underline break-words">${h(it.title)}</a>${sub(`${name(it.repo)} #${it.number} by ${h(it.author)}, opened ${RP.formatRelativeTime(it.createdAt)}.${it.note ? ` ${h(it.note)}.` : ''}`)}</div></div>`,
        (it.ready && it.canPush ? `<button type="button" data-act="merge" data-repo="${h(it.repo)}" data-num="${it.number}" class="btn btn-accent h-10 sm:h-8 px-4 sm:px-3"><i data-lucide="git-merge" class="w-3.5 h-3.5"></i>Merge</button>` : '') + open(it.url)
      );
    };
    const line = (icon, tone, main, when) => `<li class="px-4 py-2.5 flex items-start justify-between gap-3"><div class="flex gap-2.5 min-w-0">${mark(icon, tone)}<div class="min-w-0">${main}</div></div>${at(when)}</li>`;
    const repoPanel = (g) => {
      const tally = [g.merged.length ? `${g.merged.length} merged` : '', g.deploys.length ? plural(g.deploys.reduce((n, d) => n + d.count, 0), 'deploy') : ''].filter(Boolean).join(' · ');
      const repo = findRepo(g.repo);
      return `
        <section class="panel overflow-hidden">
          <header class="px-4 py-2.5 border-b border-zinc-200 dark:border-white/[0.08] flex items-baseline justify-between gap-3">
            <h2 class="font-display font-bold text-base truncate">${repo ? `<button type="button" data-open-repo="${h(repo.full_name)}" class="hover:text-indigo-600 dark:hover:text-indigo-300">${h(g.name)}</button>` : h(g.name)}</h2>
            <span class="text-xs font-mono text-zinc-500 shrink-0">${tally}</span>
          </header>
          <ul class="divide-y divide-zinc-100 dark:divide-white/[0.05]">
            ${g.merged.map((m) => line('git-merge', BLUE, `<a href="${h(m.url)}" target="_blank" rel="noopener noreferrer" class="text-sm hover:underline break-words">${h(m.title)}</a>${sub(`#${m.number} by ${h(m.author)}`)}`, m.at)).join('')}
            ${g.deploys.map((d) => line(d.pages ? 'globe' : 'rocket', d.outcome === 'running' ? AMBER : GREEN, `<a href="${h(d.url)}" target="_blank" rel="noopener noreferrer" class="text-sm hover:underline break-words">${d.pages ? 'Pages build' : `Deployed to ${h(d.environment)}`}${d.count > 1 ? ` <span class="font-mono text-xs text-zinc-500">×${d.count}</span>` : ''}</a>${sub(d.outcome === 'running' ? 'Still in progress' : d.pages ? 'Published to GitHub Pages' : 'Went out cleanly')}`, d.at)).join('')}
            ${g.recovered.map((r) => line('circle-check', GREEN, `<a href="${h(r.url)}" target="_blank" rel="noopener noreferrer" class="text-sm hover:underline break-words">${h(r.name)} failed, then passed</a>${sub(`${r.branch ? `On ${h(r.branch)}. ` : ''}Nothing to do.`)}`, r.at)).join('')}
          </ul>
        </section>`;
    };

    const notes = model.gaps.slice();
    if (D.error) notes.unshift(`Couldn't refresh: ${D.error}`);
    if (S.mode === 'demo') notes.push('Sample data. Buttons here change nothing.');
    const checked = model.fetchedAt ? ` Checked ${RP.formatRelativeTime(new Date(model.fetchedAt).toISOString())}.` : '';
    const busy = D.status === 'loading';

    el.innerHTML = `
      ${head(model.headline, `Merged pull requests, deploys and failed runs since ${h(clock(new Date(model.from).toISOString()).replace(/^Yesterday/, 'yesterday'))}.${checked}`)}
      <section class="panel p-4" aria-label="Summary">
        <pre id="digestSummary" class="font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words">${h(model.text)}</pre>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <button type="button" data-act="digest-copy" class="btn btn-accent h-10 sm:h-9 px-4"><i data-lucide="copy" class="w-3.5 h-3.5"></i>Copy summary</button>
          <button type="button" data-act="digest-refresh" class="btn btn-quiet h-10 sm:h-9 px-4" ${busy ? 'disabled' : ''}><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>${busy ? 'Checking…' : 'Refresh'}</button>
        </div>
        ${notes.map((n) => `<p class="text-xs text-zinc-500 dark:text-zinc-400 mt-2">${h(n)}</p>`).join('')}
      </section>
      ${model.needsYou.length ? `
      <section class="panel overflow-hidden" id="digestNeeds">
        <header class="px-4 py-3 border-b border-zinc-200 dark:border-white/[0.08] flex items-baseline justify-between gap-3">
          <h2 class="font-display font-bold text-lg tracking-tight">Needs you <span class="font-mono text-sm font-normal text-zinc-500">${model.needsYou.length}</span></h2>
          <p class="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400">Failed runs first, then pull requests still open</p>
        </header>
        <ul class="divide-y divide-zinc-100 dark:divide-white/[0.05]">${model.needsYou.map(needRow).join('')}</ul>
      </section>` : ''}
      ${model.repos.map(repoPanel).join('')}
      ${model.quiet ? `<div class="panel p-6 text-sm text-zinc-600 dark:text-zinc-400">Nothing was merged or deployed, no runs failed and no pull requests are waiting.</div>` : !model.repos.length ? `<div class="panel p-6 text-sm text-zinc-600 dark:text-zinc-400">Nothing was merged or deployed in the last 24 hours.</div>` : ''}`;
  }

  /* ---- Compare ---------------------------------------------------------- */
  async function fetchSummary(login) {
    const clean = login.trim().replace(/^@/, '');
    let profile, repos;
    if (S.mode === 'live' && S.username.toLowerCase() === clean.toLowerCase()) {
      profile = S.profile;
      repos = S.repos;
    } else {
      const pr = await RP.githubFetch(`https://api.github.com/users/${encodeURIComponent(clean)}`);
      if (pr.status === 404) throw new Error(`@${clean} doesn't exist on GitHub.`);
      if (pr.status === 403 || pr.status === 429) throw new Error('GitHub rate limit reached. Add a token to raise it.');
      if (!pr.ok) throw new Error(`GitHub returned ${pr.status} for @${clean}.`);
      profile = await pr.json();
      repos = [];
      for (let page = 1; page <= 3; page++) {
        const rr = await RP.githubFetch(`https://api.github.com/users/${encodeURIComponent(profile.login)}/repos?per_page=100&page=${page}&type=owner&sort=pushed`);
        if (!rr.ok) break;
        const batch = await rr.json();
        repos.push(...batch);
        if (batch.length < 100) break;
      }
    }
    const pub = repos.filter((r) => !r.private);
    const langs = {};
    pub.forEach((r) => r.language && (langs[r.language] = (langs[r.language] || 0) + 1));
    const top = pub.slice().sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))[0];
    return {
      login: profile.login, name: profile.name || profile.login, avatar: profile.avatar_url,
      repos: pub.length,
      stars: pub.reduce((a, r) => a + (r.stargazers_count || 0), 0),
      forks: pub.reduce((a, r) => a + (r.forks_count || 0), 0),
      followers: profile.followers || 0,
      active: pub.filter((r) => daysSince(r.pushed_at) <= 30).length,
      language: (Object.entries(langs).sort((a, b) => b[1] - a[1])[0] || ['None'])[0],
      topRepo: top && top.stargazers_count ? `${top.name} (${RP.formatNumber(top.stargazers_count)})` : 'None',
      since: profile.created_at ? new Date(profile.created_at).getFullYear() : '',
      capped: repos.length >= 300,
    };
  }

  async function runCompare(a, b) {
    C.compare = { a, b, busy: true, error: '', result: null };
    renderCompare();
    syncUrl();
    try {
      const A = await fetchSummary(a);
      const B = await fetchSummary(b);
      C.compare = { a: A.login, b: B.login, busy: false, error: '', result: [A, B] };
    } catch (err) {
      C.compare = { a, b, busy: false, error: err.message, result: null };
    }
    renderCompare();
    syncUrl();
  }

  function renderCompare() {
    const el = $('view-compare');
    const c = C.compare || { a: $('compareA') ? $('compareA').value : S.mode === 'live' ? S.username : '', b: $('compareB') ? $('compareB').value : '' };
    let body = '';
    if (c.error) body = `<div class="panel p-5 text-sm text-rose-600 dark:text-rose-300">${h(c.error)}</div>`;
    else if (c.busy) body = `<div class="panel p-5 text-sm text-zinc-500">Loading both accounts…</div>`;
    else if (c.result) {
      const [A, B] = c.result;
      const num = (label, key) => {
        const max = Math.max(A[key], B[key], 1);
        const bar = (v, win) => `<div class="h-2 rounded-full bg-zinc-100 dark:bg-white/[0.06] overflow-hidden"><div class="h-full ${win ? 'bg-indigo-600 dark:bg-indigo-400' : 'bg-zinc-400 dark:bg-zinc-600'}" style="width:${Math.max(2, (v / max) * 100)}%"></div></div>`;
        return `<tr class="border-t border-zinc-100 dark:border-white/[0.05]">
          <th scope="row" class="py-3 pr-3 text-left text-xs font-normal text-zinc-500 dark:text-zinc-400 w-28 sm:w-40">${label}</th>
          <td class="py-3 pr-3"><div class="font-display font-bold text-xl tabular-nums">${RP.formatNumber(A[key])}</div>${bar(A[key], A[key] >= B[key])}</td>
          <td class="py-3"><div class="font-display font-bold text-xl tabular-nums">${RP.formatNumber(B[key])}</div>${bar(B[key], B[key] >= A[key])}</td>
        </tr>`;
      };
      const text = (label, key) => `<tr class="border-t border-zinc-100 dark:border-white/[0.05]">
          <th scope="row" class="py-3 pr-3 text-left text-xs font-normal text-zinc-500 dark:text-zinc-400">${label}</th>
          <td class="py-3 pr-3 text-sm font-medium">${h(A[key])}</td><td class="py-3 text-sm font-medium">${h(B[key])}</td></tr>`;
      const head = (X) => `<th scope="col" class="pb-3 pr-3 text-left"><span class="block font-display font-bold text-lg leading-tight truncate">${h(X.name)}</span><span class="block text-xs font-mono font-normal text-zinc-500">@${h(X.login)}</span></th>`;
      body = `<div class="panel p-4 sm:p-6 overflow-x-auto">
        <table class="w-full table-fixed"><thead><tr><td class="w-28 sm:w-40"></td>${head(A)}${head(B)}</tr></thead>
        <tbody>${num('Public repos', 'repos')}${num('Stars', 'stars')}${num('Forks', 'forks')}${num('Followers', 'followers')}${num('Pushed in last 30 days', 'active')}${text('Top language', 'language')}${text('Most starred', 'topRepo')}${text('On GitHub since', 'since')}</tbody></table>
        ${A.capped || B.capped ? '<p class="text-xs text-zinc-500 mt-3">Counts cover the 300 most recently pushed repos of each account.</p>' : ''}
        <button type="button" data-act="copy-compare" class="btn btn-quiet mt-4"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>Copy link to this comparison</button>
      </div>`;
    }
    el.innerHTML = `
      <div>
        <h1 class="font-display font-bold tracking-tight text-3xl sm:text-4xl">Compare two accounts</h1>
        <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1">Public repos only, side by side.</p>
      </div>
      <form id="compareForm" class="panel p-4 flex flex-col sm:flex-row gap-2.5">
        <input id="compareA" class="field font-mono" placeholder="First username" value="${h(c.a || '')}" autocomplete="off" spellcheck="false" aria-label="First username" />
        <input id="compareB" class="field font-mono" placeholder="Second username" value="${h(c.b || '')}" autocomplete="off" spellcheck="false" aria-label="Second username" />
        <button type="submit" class="btn btn-accent h-9 px-4 shrink-0">Compare</button>
      </form>
      ${body}`;
  }

  /* ---- Ask -------------------------------------------------------------- */
  const ASK_SUGGESTIONS = ['Which projects have I neglected?', 'What should I work on next?', 'Which repos could I archive?', 'Summarise what I shipped this week.'];

  function askContext() {
    const lines = S.repos.slice(0, 80).map((r) => {
      const ex = extraFor(r);
      const hl = health(r);
      return JSON.stringify({
        name: r.name, private: Boolean(r.private), fork: Boolean(r.fork), archived: Boolean(r.archived), language: r.language || null,
        description: (r.description || '').slice(0, 140), stars: r.stargazers_count || 0, lastPush: (r.pushed_at || '').slice(0, 10),
        health: hl ? hl.score : null, issues: hl ? hl.reasons.map((x) => x.text) : [],
        openPRs: ex ? ex.prs.length : undefined, ci: ex ? ex.ci : undefined, alerts: ex ? ex.alerts : undefined,
        commits30d: ex ? ex.commitCount : undefined, recent: ex ? ex.commits.slice(0, 4).map((c) => c.message) : undefined,
      });
    });
    return `Account: @${S.username}. Today: ${new Date().toISOString().slice(0, 10)}. One JSON object per repo:\n${lines.join('\n')}`;
  }

  async function runAsk(question) {
    const key = ($('askKey').value || '').trim();
    const model = ($('askModel').value || '').trim() || 'claude-sonnet-5-5';
    if (!key) return void RP.showToast('Paste an Anthropic API key first', 'error');
    if (!question.trim()) return void RP.showToast('Type a question first', 'error');
    const keep = $('askKeep').checked;
    try {
      (keep ? localStorage : sessionStorage).setItem(KEYS.ANTHROPIC, key);
      (keep ? sessionStorage : localStorage).removeItem(KEYS.ANTHROPIC);
      localStorage.setItem(KEYS.MODEL, model);
    } catch { /* storage unavailable: the key lives for this page only */ }
    // Earlier turns go back with each request, so follow-ups know what was said.
    const turns = C.ask.turns;
    const messages = [];
    turns.forEach((t, i) => {
      messages.push({ role: 'user', content: i === 0 ? `${t.context}\n\nQuestion: ${t.q}` : t.q });
      messages.push({ role: 'assistant', content: t.a });
    });
    const context = turns.length ? '' : askContext();
    messages.push({ role: 'user', content: turns.length ? question : `${context}\n\nQuestion: ${question}` });
    C.ask = { busy: true, error: '', pending: question, turns };
    if ($('askQuestion')) $('askQuestion').value = '';
    renderAsk();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model, max_tokens: 1200,
          system: "You answer questions about one developer's GitHub repositories using only the data provided. Be specific: name repos and give the evidence. Keep it short. Use Markdown.",
          messages,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json.error && json.error.message) || `The API returned ${res.status}.`);
      const a = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      C.ask = { busy: false, error: '', pending: '', turns: [...turns, { q: question, a, context }] };
    } catch (err) {
      // Keep the question in the box so it can be sent again.
      C.ask = { busy: false, pending: '', turns, error: err.message === 'Failed to fetch' ? "The request didn't reach Anthropic. Check your connection." : err.message };
      renderAsk();
      if ($('askQuestion')) $('askQuestion').value = question;
      return;
    }
    renderAsk();
    const last = document.querySelector('#askThread > :last-child');
    if (last) last.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function renderAsk() {
    const el = $('view-ask');
    const stored = sessionStorage.getItem(KEYS.ANTHROPIC) || localStorage.getItem(KEYS.ANTHROPIC) || '';
    const current = $('askKey') ? $('askKey').value : stored;
    const model = $('askModel') ? $('askModel').value : localStorage.getItem(KEYS.MODEL) || 'claude-sonnet-5-5';
    const keep = $('askKeep') ? $('askKeep').checked : Boolean(localStorage.getItem(KEYS.ANTHROPIC));
    const q = $('askQuestion') ? $('askQuestion').value : '';
    const started = C.ask.turns.length > 0;
    const md = (text) => {
      const raw = window.marked ? window.marked.parse(text) : `<pre>${h(text)}</pre>`;
      return window.DOMPurify ? window.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } }) : h(text);
    };
    const asked = (text) => `<p class="font-display font-bold text-lg tracking-tight">${h(text)}</p>`;
    let thread = C.ask.turns.map((t) => `<div class="panel p-5">${asked(t.q)}<div class="readme-prose mt-2">${md(t.a)}</div></div>`).join('');
    if (C.ask.busy) thread += `<div class="panel p-5">${asked(C.ask.pending)}<p class="text-sm text-zinc-500 mt-2">Thinking…</p></div>`;
    if (C.ask.error) thread += `<div class="panel p-5 text-sm text-rose-600 dark:text-rose-300">${h(C.ask.error)}</div>`;
    el.innerHTML = `
      <div>
        <h1 class="font-display font-bold tracking-tight text-3xl sm:text-4xl">Ask about your repos</h1>
        <p class="text-sm text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl">Claude answers from the data on this page. Asking sends a summary of ${S.mode === 'demo' ? 'the sample repos' : `@${h(S.username)}'s repos${S.includesPrivate ? ', private ones included,' : ''}`} to Anthropic using your own API key.</p>
      </div>
      <div id="askThread" class="space-y-3">${thread}</div>
      <form id="askForm" class="panel p-4 space-y-3">
        <textarea id="askQuestion" rows="2" class="field h-auto py-2" placeholder="${started ? 'Ask a follow-up' : 'Which projects have I neglected?'}" aria-label="Your question">${h(q)}</textarea>
        ${started ? '' : `<div class="flex flex-wrap gap-1.5">${ASK_SUGGESTIONS.map((s) => `<button type="button" data-ask-suggest="${h(s)}" class="btn btn-quiet">${h(s)}</button>`).join('')}</div>`}
        <div class="grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-2.5 pt-2 border-t border-zinc-200 dark:border-white/[0.08]">
          <label class="block text-xs text-zinc-600 dark:text-zinc-400">Anthropic API key
            <input id="askKey" type="password" class="field font-mono mt-1" placeholder="sk-ant-…" autocomplete="off" value="${h(current)}" /></label>
          <label class="block text-xs text-zinc-600 dark:text-zinc-400">Model
            <input id="askModel" type="text" class="field font-mono mt-1" value="${h(model)}" spellcheck="false" /></label>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"><input id="askKeep" type="checkbox" ${keep ? 'checked' : ''} /> Keep the key on this device</label>
          <div class="flex items-center gap-2">
            ${started ? '<button type="button" data-act="ask-reset" class="btn btn-quiet h-9 px-4">Start over</button>' : ''}
            <button type="submit" class="btn btn-accent h-9 px-4" ${C.ask.busy ? 'disabled' : ''}><i data-lucide="send" class="w-3.5 h-3.5"></i>${started ? 'Send' : 'Ask'}</button>
          </div>
        </div>
      </form>`;
    icons();
  }

  function renderViews() {
    renderPulse();
    renderAttention();
    renderShipped();
    renderCompare();
    renderAsk();
    icons();
  }

  /* =====================================================================
   * 4. Actions on GitHub
   * ===================================================================== */
  async function gh(method, path, body) {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { ...RP.getApiHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, json };
  }

  const failText = (r) => (r.json && r.json.message) || (r.status === 403 ? "This token isn't allowed to do that." : `GitHub returned ${r.status}.`);
  const findRepo = (nwo) => S.repos.find((r) => r.full_name === nwo);

  function afterChange() {
    saveCockpit();
    RP.applyFiltersAndRender();
    renderViews();
  }

  async function mergePR(nwo, number) {
    const repo = findRepo(nwo);
    const ex = extraFor(repo);
    const pr = ex && ex.prs.find((p) => p.number === number);
    if (!pr) return;
    const how = { squash: 'squashed and merged', merge: 'merged', rebase: 'rebased and merged' }[ex.mergeMethod];
    const yes = await confirmDialog({ title: `Merge #${number}?`, body: `"${pr.title}" will be ${how} into ${ex.defaultBranch} of ${nwo}.`, confirm: 'Merge' });
    if (!yes) return;
    if (S.mode === 'demo') return void RP.showToast('Sample data: nothing was merged', 'info');
    const r = await gh('PUT', `/repos/${nwo}/pulls/${number}/merge`, { merge_method: ex.mergeMethod });
    if (!r.ok) return void RP.showToast(`Not merged: ${failText(r)}`, 'error');
    ex.prs = ex.prs.filter((p) => p.number !== number);
    RP.showToast(`Merged #${number} in ${repo.name}`, 'success');
    afterChange();
  }

  async function rerunCI(nwo) {
    const repo = findRepo(nwo);
    const ex = extraFor(repo);
    const yes = await confirmDialog({ title: 'Re-run the failed jobs?', body: `The failed jobs from the latest run on ${ex.defaultBranch} of ${nwo} will start again.`, confirm: 'Re-run' });
    if (!yes) return;
    if (S.mode === 'demo') return void RP.showToast('Sample data: nothing was re-run', 'info');
    const runs = await gh('GET', `/repos/${nwo}/actions/runs?branch=${encodeURIComponent(ex.defaultBranch)}&per_page=20`);
    if (!runs.ok) return void RP.showToast(`Couldn't list runs: ${failText(runs)}`, 'error');
    const failed = (runs.json.workflow_runs || []).find((w) => ['failure', 'timed_out', 'startup_failure'].includes(w.conclusion));
    if (!failed) return void RP.showToast('No failed GitHub Actions run found. The failing check may come from another service.', 'error');
    const r = await gh('POST', `/repos/${nwo}/actions/runs/${failed.id}/rerun-failed-jobs`);
    if (!r.ok) return void RP.showToast(`Not re-run: ${failText(r)}`, 'error');
    ex.ci = 'PENDING';
    RP.showToast(`Re-running "${failed.name}" in ${repo.name}`, 'success');
    afterChange();
  }

  async function archiveRepo(nwo) {
    const repo = findRepo(nwo);
    const yes = await confirmDialog({ title: `Archive ${repo.name}?`, body: `${nwo} becomes read-only: no pushes, issues or pull requests. You can unarchive it from the repo's settings on GitHub.`, confirm: 'Archive', danger: true });
    if (!yes) return;
    if (S.mode === 'demo') return void RP.showToast('Sample data: nothing was archived', 'info');
    const r = await gh('PATCH', `/repos/${nwo}`, { archived: true });
    if (!r.ok) return void RP.showToast(`Not archived: ${failText(r)}`, 'error');
    repo.archived = true;
    RP.showToast(`Archived ${repo.name}`, 'success');
    RP.closeInspectorDrawer();
    afterChange();
  }

  /* =====================================================================
   * 5. Dialogs: confirm, command palette, share card
   * ===================================================================== */
  let confirmResolve = null;
  function confirmDialog({ title, body, confirm, danger }) {
    let root = $('confirmRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'confirmRoot';
      root.className = 'fixed inset-0 z-[70] hidden items-center justify-center p-4';
      root.innerHTML = `<div data-confirm-no class="fixed inset-0 bg-black/60"></div>
        <div role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" class="relative w-full max-w-sm panel p-5 shadow-2xl">
          <h2 id="confirmTitle" class="font-display font-bold text-xl tracking-tight"></h2>
          <p id="confirmBody" class="text-sm text-zinc-600 dark:text-zinc-400 mt-2"></p>
          <div class="flex justify-end gap-2 mt-5"><button type="button" data-confirm-no class="btn btn-quiet h-9 px-4">Cancel</button><button type="button" id="confirmYes" class="btn h-9 px-4"></button></div>
        </div>`;
      document.body.appendChild(root);
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-confirm-no]')) closeConfirm(false);
        else if (e.target.closest('#confirmYes')) closeConfirm(true);
      });
    }
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent = body;
    const yes = $('confirmYes');
    yes.textContent = confirm;
    yes.className = `btn h-9 px-4 ${danger ? 'btn-danger' : 'btn-accent'}`;
    root.classList.replace('hidden', 'flex');
    yes.focus();
    return new Promise((resolve) => (confirmResolve = resolve));
  }
  function closeConfirm(value) {
    const root = $('confirmRoot');
    if (!root || root.classList.contains('hidden')) return false;
    root.classList.replace('flex', 'hidden');
    if (confirmResolve) confirmResolve(value);
    confirmResolve = null;
    return true;
  }

  /* ---- command palette -------------------------------------------------- */
  const P = { items: [], shown: [], index: 0 };

  function paletteItems() {
    const items = VIEWS.map((v, i) => ({ label: `Go to ${VIEW_LABELS[v]}`, hint: String(i + 1), icon: 'arrow-right', run: () => showView(v) }));
    const cmd = (label, icon, run) => items.push({ label, icon, hint: '', run });
    cmd('What shipped in the last 24 hours', 'sunrise', openDigest);
    cmd('Copy the 24-hour summary', 'copy', () => { ensureDigest(); copyDigest(); });
    cmd('Load another username', 'user', () => { const i = $('usernameInput'); i.focus(); i.select(); });
    cmd(S.token ? 'Change or remove GitHub token' : 'Add GitHub token', 'key-round', RP.openAuthModal);
    cmd('Refresh from GitHub', 'refresh-cw', () => $('refreshDataBtn').click());
    cmd('Switch light / dark theme', 'sun', RP.toggleTheme);
    cmd('Make a shareable card', 'image', openCard);
    cmd('Export repo list as CSV', 'download', RP.exportFilteredAsCSV);
    cmd('Export repo list as JSON', 'download', RP.exportFilteredAsJSON);
    cmd('Show sample data', 'sparkles', () => RP.loadDemoMode(true));
    S.repos.forEach((r) => items.push({ label: r.name, hint: r.language || '', icon: r.private ? 'lock' : 'folder-git-2', sub: r.description || '', run: () => RP.openInspectorDrawer(r) }));
    return items;
  }

  function openPalette() {
    let root = $('paletteRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'paletteRoot';
      root.className = 'fixed inset-0 z-[65] hidden items-start justify-center p-3 pt-[10vh]';
      root.innerHTML = `<div data-palette-close class="fixed inset-0 bg-black/60"></div>
        <div role="dialog" aria-modal="true" aria-label="Search and commands" class="relative w-full max-w-xl panel shadow-2xl overflow-hidden">
          <input id="paletteInput" type="text" class="w-full h-12 px-4 text-base bg-transparent border-b border-zinc-200 dark:border-white/[0.08] focus:outline-none" placeholder="Search repos and commands" autocomplete="off" spellcheck="false" />
          <ul id="paletteList" class="max-h-[50vh] overflow-y-auto p-1.5"></ul>
          <p class="hidden sm:block px-4 py-2 text-xs text-zinc-500 border-t border-zinc-200 dark:border-white/[0.08]">Elsewhere: 1 to 6 switch views, / filters repos, j and k move through them, Enter opens one.</p>
        </div>`;
      document.body.appendChild(root);
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-palette-close]')) return closePalette();
        const li = e.target.closest('[data-palette-index]');
        if (li) runPalette(Number(li.getAttribute('data-palette-index')));
      });
      $('paletteInput').addEventListener('input', filterPalette);
    }
    P.items = paletteItems();
    root.classList.replace('hidden', 'flex');
    const input = $('paletteInput');
    input.value = '';
    filterPalette();
    input.focus();
  }

  function filterPalette() {
    const words = $('paletteInput').value.toLowerCase().split(/\s+/).filter(Boolean);
    P.shown = P.items
      .map((it) => {
        const hay = `${it.label} ${it.sub || ''} ${it.hint}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const label = it.label.toLowerCase();
        return { it, score: words.length && label.startsWith(words[0]) ? 0 : words.length && label.includes(words[0]) ? 1 : 2 };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((x) => x.it);
    P.index = 0;
    drawPalette();
  }

  function drawPalette() {
    $('paletteList').innerHTML =
      P.shown
        .map(
          (it, i) => `<li data-palette-index="${i}" class="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${i === P.index ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-white/[0.06]'}">
            <i data-lucide="${it.icon}" class="w-4 h-4 shrink-0 opacity-70"></i>
            <span class="min-w-0 flex-1"><span class="block text-sm font-medium truncate">${h(it.label)}</span>${it.sub ? `<span class="block text-xs truncate opacity-70">${h(it.sub)}</span>` : ''}</span>
            <span class="text-xs font-mono opacity-70 shrink-0">${h(it.hint)}</span></li>`
        )
        .join('') || '<li class="px-3 py-6 text-sm text-center text-zinc-500">Nothing matches.</li>';
    icons();
    const active = $('paletteList').querySelector(`[data-palette-index="${P.index}"]`);
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function runPalette(i) {
    const it = P.shown[i];
    closePalette();
    if (it) it.run();
  }
  const paletteOpen = () => $('paletteRoot') && !$('paletteRoot').classList.contains('hidden');
  function closePalette() {
    if ($('paletteRoot')) $('paletteRoot').classList.replace('flex', 'hidden');
  }

  /* ---- share card ------------------------------------------------------- */
  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function drawCard(canvas) {
    const W = 1200, H = 630;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const display = '"Bricolage Grotesque", "IBM Plex Sans", sans-serif';
    const sans = '"IBM Plex Sans", sans-serif';
    const mono = '"IBM Plex Mono", monospace';
    const p = S.profile;
    const pub = S.repos.filter((r) => !r.private);

    // graph paper
    ctx.fillStyle = '#FFFDFB';
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x <= W; x += 10) { ctx.fillStyle = x % 50 === 0 ? '#F1CFCF' : 'rgba(241,207,207,0.45)'; ctx.fillRect(x, 0, 1, H); }
    for (let y = 0; y <= H; y += 10) { ctx.fillStyle = y % 50 === 0 ? '#F1CFCF' : 'rgba(241,207,207,0.45)'; ctx.fillRect(0, y, W, 1); }

    // the trace along the bottom
    const days = C.data && C.data.calendar ? C.data.calendar.days.slice(-140) : [];
    if (days.length) {
      const t = tracePath(days);
      ctx.save();
      ctx.translate(W - 60 - t.width, H - 172);
      ctx.strokeStyle = '#1B1722';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(t.d));
      ctx.fillStyle = '#E11D48';
      ctx.beginPath();
      ctx.arc(t.width, t.base, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // identity
    const avatar = await loadImage(p.avatar_url);
    const ax = 60, ay = 60, as = 132;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(ax, ay, as, as, 14);
    ctx.clip();
    if (avatar) ctx.drawImage(avatar, ax, ay, as, as);
    else { ctx.fillStyle = '#1B1722'; ctx.fillRect(ax, ay, as, as); }
    ctx.restore();
    ctx.fillStyle = '#1B1722';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 68px ${display}`;
    let name = p.name || p.login;
    while (ctx.measureText(name).width > W - 290 && name.length > 4) name = name.slice(0, -2).trimEnd() + '…';
    ctx.fillText(name, 222, 128);
    ctx.fillStyle = '#57505C';
    ctx.font = `400 30px ${mono}`;
    ctx.fillText(`@${p.login}`, 224, 176);

    // four figures
    const stats = [
      ['public repos', pub.length],
      ['stars', pub.reduce((a, r) => a + (r.stargazers_count || 0), 0)],
      ['pushed this month', pub.filter((r) => daysSince(r.pushed_at) <= 30).length],
      C.data && C.data.calendar ? ['contributions this year', C.data.calendar.total] : ['followers', p.followers || 0],
    ];
    stats.forEach(([label, value], i) => {
      const x = 60 + i * 275;
      ctx.fillStyle = '#1B1722';
      ctx.font = `700 76px ${display}`;
      ctx.fillText(RP.formatNumber(value), x, 322);
      ctx.fillStyle = '#57505C';
      ctx.font = `400 24px ${sans}`;
      ctx.fillText(label, x, 358);
    });

    // languages
    const langs = {};
    pub.forEach((r) => r.language && (langs[r.language] = (langs[r.language] || 0) + 1));
    const top = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = top.reduce((a, [, c]) => a + c, 0) || 1;
    let x = 60;
    top.forEach(([lang, count]) => {
      const w = Math.max(14, ((W - 120) * count) / total - 4);
      ctx.fillStyle = RP.getLangColor(lang);
      ctx.beginPath();
      ctx.roundRect(x, 396, w, 16, 4);
      ctx.fill();
      x += w + 4;
    });
    ctx.font = `500 22px ${sans}`;
    ctx.fillStyle = '#3D3745';
    ctx.fillText(top.map(([l]) => l).join('   '), 60, 446);

    // mark
    ctx.strokeStyle = '#2F43EE';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.save();
    ctx.translate(60, H - 78);
    ctx.scale(1.5, 1.5);
    ctx.stroke(new Path2D('M1 18h8l3-6 4 16 5-24 4 14h10'));
    ctx.restore();
    ctx.fillStyle = '#1B1722';
    ctx.font = `700 30px ${display}`;
    ctx.fillText('RepoPulse', 126, H - 44);
  }

  async function openCard() {
    if (!S.profile) return;
    let root = $('cardRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'cardRoot';
      root.className = 'fixed inset-0 z-[65] hidden items-center justify-center p-4';
      root.innerHTML = `<div data-card-close class="fixed inset-0 bg-black/60"></div>
        <div role="dialog" aria-modal="true" aria-label="Shareable card" class="relative w-full max-w-2xl panel p-4 shadow-2xl">
          <canvas id="cardCanvas" class="w-full h-auto rounded-lg border border-zinc-200 dark:border-white/[0.08]"></canvas>
          <div class="flex flex-wrap justify-end gap-2 mt-3">
            <button type="button" data-card-close class="btn btn-quiet h-9 px-4">Close</button>
            <button type="button" id="cardShare" class="btn btn-quiet h-9 px-4 hidden"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>Share</button>
            <button type="button" id="cardDownload" class="btn btn-accent h-9 px-4"><i data-lucide="download" class="w-3.5 h-3.5"></i>Download PNG</button>
          </div>
        </div>`;
      document.body.appendChild(root);
      const blob = () => new Promise((res) => $('cardCanvas').toBlob(res, 'image/png'));
      const name = () => `${S.profile.login}-repopulse.png`;
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-card-close]')) return closeCard();
        try {
          if (e.target.closest('#cardDownload')) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(await blob());
            a.download = name();
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          } else if (e.target.closest('#cardShare')) {
            await navigator.share({ files: [new File([await blob()], name(), { type: 'image/png' })], title: `${S.profile.login} on RepoPulse` });
          }
        } catch (err) {
          if (err.name !== 'AbortError') RP.showToast("Couldn't export the card", 'error');
        }
      });
      if (navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] })) $('cardShare').classList.remove('hidden');
    }
    root.classList.replace('hidden', 'flex');
    icons();
    await drawCard($('cardCanvas'));
  }
  const cardOpen = () => $('cardRoot') && !$('cardRoot').classList.contains('hidden');
  function closeCard() {
    if ($('cardRoot')) $('cardRoot').classList.replace('flex', 'hidden');
  }

  /* =====================================================================
   * 6. Hooks called by app.js
   * ===================================================================== */
  let kbIndex = -1;

  function moveSelection(delta) {
    const items = Array.from(document.querySelectorAll('.repo-item')).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    items.forEach((el) => el.classList.remove('kb-selected'));
    kbIndex = Math.max(0, Math.min(items.length - 1, kbIndex + delta));
    items[kbIndex].classList.add('kb-selected');
    items[kbIndex].scrollIntoView({ block: 'nearest' });
  }

  window.RPHooks = {
    showView,
    healthScore: (repo) => { const x = health(repo); return x ? x.score : undefined; },
    cardBadge(repo) {
      const x = health(repo);
      if (!x) return '';
      const why = x.reasons.length ? x.reasons.map((r) => r.text).join(', ') : 'Nothing to fix';
      return `<span title="Health ${x.score}: ${h(why)}" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${TONE[x.tone]}"><i data-lucide="heart-pulse" class="w-2.5 h-2.5"></i>${x.score}</span>`;
    },
    prefill(repo) {
      const ex = S.mode === 'live' ? extraFor(repo) : null;
      if (!ex) return null;
      return {
        languages: ex.languages,
        commits: ex.commits.slice(0, 5).map((c) => ({ sha: c.sha, html_url: c.url, commit: { message: c.message, author: { name: c.author, date: c.date } } })),
      };
    },
    onDrawer(repo) {
      const x = health(repo);
      const ex = extraFor(repo);
      const el = $('drawerHealth');
      if (!x) return void (el.innerHTML = '');
      el.innerHTML = `<div class="rounded-xl border border-zinc-200 dark:border-white/[0.08] p-4">
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-display font-bold text-base">Health</h3>
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-sm font-mono font-medium ${TONE[x.tone]}">${x.score} / 100</span>
        </div>
        ${x.reasons.length ? `<ul class="mt-2 space-y-1">${x.reasons.map((r) => `<li class="flex justify-between gap-3 text-sm"><span>${h(r.text)}</span><span class="font-mono text-xs text-zinc-500 tabular-nums">−${r.points}</span></li>`).join('')}</ul>` : '<p class="text-sm text-zinc-600 dark:text-zinc-400 mt-2">Nothing to fix.</p>'}
        ${x.partial ? '<p class="text-xs text-zinc-500 mt-2">Add a token to include CI, alerts, pull requests and branches in the score.</p>' : ''}
        ${ex && ex.canAdmin ? `<button type="button" data-act="archive" data-repo="${h(repo.full_name)}" class="btn btn-quiet mt-3"><i data-lucide="archive" class="w-3.5 h-3.5"></i>Archive this repo</button>` : ''}
      </div>`;
      icons();
    },
    onBoot() {
      const params = new URLSearchParams(location.search);
      const view = params.get('view');
      const cmp = (params.get('compare') || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (view === 'digest' || params.get('range') === '24h') C.shipRange = 1; // ?view=digest is shorthand for the 24-hour ship log
      else if (view === 'shipped' && params.get('range')) C.shipRange = RANGES.includes(parseInt(params.get('range'), 10)) ? parseInt(params.get('range'), 10) : C.shipRange;
      showView(cmp.length === 2 ? 'compare' : view === 'digest' ? 'shipped' : view || 'pulse', { keepScroll: true });
      if (cmp.length === 2) runCompare(cmp[0], cmp[1]);
    },
    onUserChange(login) {
      if (C.askFor && C.askFor !== login) C.ask = { busy: false, error: '', pending: '', turns: [] };
      C.askFor = login;
    },
    onData() {
      C.booted = true;
      const run = ++C.run;
      const login = S.username;
      if (S.mode === 'demo') {
        C.data = buildDemoCockpit();
        C.status = 'demo';
      } else if (!S.token) {
        C.data = null;
        C.status = 'locked';
      } else {
        if (!C.data || C.data.login.toLowerCase() !== login.toLowerCase()) C.data = loadSavedCockpit(login);
        C.status = C.data ? 'ready' : 'loading';
        fetchCockpit(login)
          .then((data) => {
            if (run !== C.run) return;
            C.data = data;
            C.status = 'ready';
            saveCockpit();
          })
          .catch((err) => {
            if (run !== C.run) return;
            if (C.data && !err.unsupported) return void RP.showToast("Couldn't refresh pull requests and activity", 'error');
            C.data = null;
            C.status = err.unsupported ? 'unsupported' : 'error';
            C.error = err.message === 'Failed to fetch' ? "The request didn't reach GitHub. Check your connection." : err.message;
          })
          .finally(() => {
            if (run !== C.run) return;
            if (digestShowing()) ensureDigest();
            RP.applyFiltersAndRender();
            renderViews();
          });
      }
      if (C.data) RP.applyFiltersAndRender(); // health badges need the cockpit data
      if (digestShowing()) ensureDigest(true);
      renderViews();
      syncUrl();
    },
    onKey(e) {
      if (confirmResolve) {
        if (e.key === 'Escape') closeConfirm(false);
        return true;
      }
      if (paletteOpen()) {
        if (e.key === 'Escape') closePalette();
        else if (e.key === 'ArrowDown') { P.index = Math.min(P.shown.length - 1, P.index + 1); drawPalette(); }
        else if (e.key === 'ArrowUp') { P.index = Math.max(0, P.index - 1); drawPalette(); }
        else if (e.key === 'Enter') runPalette(P.index);
        else return true; // typing stays in the palette
        e.preventDefault();
        return true;
      }
      if (cardOpen() && e.key === 'Escape') return closeCard(), true;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
        return true;
      }
      const tag = document.activeElement.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return false;
      const drawerUp = !$('inspectorDrawerRoot').classList.contains('hidden');
      const modalUp = !$('authModalRoot').classList.contains('hidden');
      if (drawerUp || modalUp) return false;
      if (/^[1-6]$/.test(e.key)) return showView(VIEWS[Number(e.key) - 1]), true;
      if (e.key === '?') return openPalette(), true;
      if (C.view === 'repos') {
        if (e.key === 'j') return moveSelection(1), true;
        if (e.key === 'k') return moveSelection(-1), true;
        if (e.key === 'Enter' || e.key === 'o') {
          const sel = document.querySelector('.repo-item.kb-selected');
          if (sel) return sel.click(), true;
        }
      }
      return false;
    },
  };

  /* =====================================================================
   * 7. Wiring
   * ===================================================================== */
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav], [data-nav-go]');
    if (nav) return showView(nav.getAttribute('data-nav') || nav.getAttribute('data-nav-go'));
    const open = e.target.closest('[data-open-repo]');
    if (open) {
      const repo = findRepo(open.getAttribute('data-open-repo'));
      if (repo) RP.openInspectorDrawer(repo);
      return;
    }
    const range = e.target.closest('[data-ship-range]');
    if (range) return void setShipRange(Number(range.getAttribute('data-ship-range')));
    const suggest = e.target.closest('[data-ask-suggest]');
    if (suggest) {
      $('askQuestion').value = suggest.getAttribute('data-ask-suggest');
      return void runAsk($('askQuestion').value);
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const kind = act.getAttribute('data-act');
    const nwo = act.getAttribute('data-repo');
    if (kind === 'token') RP.openAuthModal();
    else if (kind === 'merge') mergePR(nwo, Number(act.getAttribute('data-num')));
    else if (kind === 'rerun') rerunCI(nwo);
    else if (kind === 'archive') archiveRepo(nwo);
    else if (kind === 'ask-reset') { C.ask = { busy: false, error: '', pending: '', turns: [] }; renderAsk(); }
    else if (kind === 'digest-open') openDigest();
    else if (kind === 'digest-copy') copyDigest();
    else if (kind === 'digest-refresh') { ensureDigest(true); renderShipped(); icons(); }
    else if (kind === 'copy-compare') RP.copyToClipboard(location.href, 'Link copied');
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'compareForm') {
      e.preventDefault();
      const a = $('compareA').value.trim();
      const b = $('compareB').value.trim();
      if (a && b) runCompare(a, b);
      else RP.showToast('Enter two usernames', 'error');
    } else if (e.target.id === 'askForm') {
      e.preventDefault();
      runAsk($('askQuestion').value);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('openPaletteBtn').addEventListener('click', openPalette);
    $('shareCardBtn').addEventListener('click', openCard);
  });
})();
