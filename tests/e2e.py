"""Drive RepoPulse in Chromium with GitHub and Anthropic stubbed. Usage: e2e.py <site dir> <shots dir>"""
import sys, json, asyncio, threading, functools, http.server, socketserver, datetime, os
from playwright.async_api import async_playwright

SITE, SHOTS = sys.argv[1], sys.argv[2]
os.makedirs(SHOTS, exist_ok=True)
NOW = datetime.datetime.now(datetime.timezone.utc)
iso = lambda d: (NOW - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=SITE))
PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}/'

NAMES = [('hq', 0.2, True), ('plexodus', 1, False), ('stock-watch', 3, True), ('old-thing', 500, False), ('tabbeth', 40, True)]
def rest_repo(i, name, age, private):
    return {"id": i, "name": name, "full_name": f"sfxhewitt/{name}", "private": private, "fork": False, "archived": False,
            "description": "" if name == 'old-thing' else f"{name} project", "language": ["Python", "TypeScript", "HTML"][i % 3],
            "stargazers_count": i, "watchers_count": i, "forks_count": 0, "open_issues_count": 1, "size": 100, "default_branch": "main",
            "license": None, "topics": ["demo"], "homepage": "", "html_url": f"https://github.com/sfxhewitt/{name}",
            "clone_url": f"https://github.com/sfxhewitt/{name}.git", "ssh_url": "", "created_at": iso(900), "pushed_at": iso(age)}
REPOS = [rest_repo(i, *n) for i, n in enumerate(NAMES)]
PROFILE = {"login": "sfxhewitt", "name": "Danny Hewitt", "avatar_url": "", "bio": None, "location": "Liverpool", "followers": 3, "following": 4,
           "created_at": "2014-01-01T00:00:00Z", "html_url": "https://github.com/sfxhewitt"}
OTHER = {**PROFILE, "login": "octocat", "name": "The Octocat", "followers": 9000}

def gql_repo(name, age, private):
    def pr(n, title, mergeable, checks, days):
        return {"number": n, "title": title, "url": f"https://github.com/sfxhewitt/{name}/pull/{n}", "isDraft": False, "createdAt": iso(days), "updatedAt": iso(days / 2),
                "mergeable": mergeable, "reviewDecision": None, "headRefName": "feat", "author": {"login": "claude"},
                "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": checks} if checks else None}}]}}
    prs = {'hq': [pr(5, 'Adopt shared code standards', 'MERGEABLE', 'SUCCESS', 6)], 'plexodus': [pr(40, 'Design critique fixes', 'CONFLICTING', 'SUCCESS', 14)]}.get(name, [])
    commits = [{"oid": f"{i:040x}", "messageHeadline": f"{name}: change {i}", "committedDate": iso(age + i * 1.3), "url": f"https://github.com/sfxhewitt/{name}/commit/{i}",
                "author": {"name": "Danny", "user": {"login": "sfxhewitt"}}} for i in range(0 if age > 29 else 6)]
    return {"nameWithOwner": f"sfxhewitt/{name}", "isArchived": False, "isFork": False, "viewerPermission": "ADMIN",
            "mergeCommitAllowed": True, "squashMergeAllowed": True, "rebaseMergeAllowed": True,
            "readmeUpper": None if name == 'old-thing' else {"__typename": "Blob"}, "readmeLower": None,
            "vulnerabilityAlerts": {"totalCount": 2 if name == 'tabbeth' else 0},
            "languages": {"edges": [{"size": 9000, "node": {"name": "Python"}}, {"size": 1000, "node": {"name": "HTML"}}]},
            "pullRequests": {"totalCount": len(prs), "nodes": prs},
            "refs": {"totalCount": 3, "nodes": [{"name": "main", "target": {"committedDate": iso(age)}}, {"name": "old-spike", "target": {"committedDate": iso(200)}}] if name == 'stock-watch' else [{"name": "main", "target": {"committedDate": iso(age)}}]},
            "defaultBranchRef": {"name": "main", "target": {"statusCheckRollup": {"state": "FAILURE"} if name == 'stock-watch' else {"state": "SUCCESS"},
                                 "history": {"totalCount": len(commits), "nodes": commits}}}}
def gql_response():
    days = [{"date": (NOW - datetime.timedelta(days=d)).strftime('%Y-%m-%d'), "contributionCount": (d * 7) % 5 if d % 6 else 0} for d in range(370, -1, -1)]
    weeks = [{"contributionDays": days[i:i + 7]} for i in range(0, len(days), 7)]
    return {"data": {"viewer": {"login": "sfxhewitt"}, "user": {
        "contributionsCollection": {"contributionCalendar": {"totalContributions": sum(d["contributionCount"] for d in days), "weeks": weeks}},
        "repositories": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": [gql_repo(*n) for n in NAMES]}}}}

CALLS = []
ASKS = []
async def handle(route):
    req = route.request
    u = req.url
    hdr = {"access-control-allow-origin": "*", "access-control-expose-headers": "*", "x-ratelimit-remaining": "4990", "x-ratelimit-limit": "5000", "x-ratelimit-reset": "1795300000"}
    if u.startswith(BASE):
        return await route.continue_()
    if req.method == 'OPTIONS':
        return await route.fulfill(status=204, headers={**hdr, "access-control-allow-headers": "*", "access-control-allow-methods": "*"})
    if 'api.github.com' in u or 'api.anthropic.com' in u:
        CALLS.append(f"{req.method} {u.split('.com')[1].split('?')[0]}")
    if u == 'https://api.github.com/graphql':
        return await route.fulfill(json=gql_response(), headers=hdr)
    if u == 'https://api.github.com/user':
        return await route.fulfill(json=PROFILE, headers=hdr)
    if 'api.github.com/user/repos' in u or 'api.github.com/users/sfxhewitt/repos' in u:
        return await route.fulfill(json=REPOS if 'user/repos' in u else [r for r in REPOS if not r['private']], headers=hdr)
    if 'api.github.com/users/octocat/repos' in u:
        return await route.fulfill(json=[{**REPOS[1], "name": "Hello-World", "stargazers_count": 2500, "language": "Ruby"}], headers=hdr)
    if 'api.github.com/users/octocat' in u:
        return await route.fulfill(json=OTHER, headers=hdr)
    if 'api.github.com/users/sfxhewitt' in u:
        return await route.fulfill(json=PROFILE, headers=hdr)
    if '/actions/runs' in u and req.method == 'GET':
        return await route.fulfill(json={"workflow_runs": [{"id": 77, "name": "tests", "conclusion": "failure"}]}, headers=hdr)
    if 'api.github.com/repos/' in u and req.method in ('PUT', 'POST', 'PATCH'):
        return await route.fulfill(json={"merged": True}, status=201 if req.method == 'POST' else 200, headers=hdr)
    if 'api.github.com/repos/' in u:
        return await route.fulfill(status=404, json={"message": "Not Found"}, headers=hdr)
    if 'api.anthropic.com' in u:
        body = json.loads(req.post_data)
        assert req.headers.get('anthropic-dangerous-direct-browser-access') == 'true'
        assert 'hq' in body['messages'][0]['content']
        ASKS.append([m['role'] for m in body['messages']])
        return await route.fulfill(json={"content": [{"type": "text", "text": "**old-thing** has had no pushes for over a year."}]}, headers=hdr)
    await route.abort()

FAIL = []
def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail and not cond else ''))
    if not cond: FAIL.append(name)

async def new_page(browser, w, h, storage=None, path=''):
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < 500 else 1)
    pg = await ctx.new_page()
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('console', lambda m: pg.errs.append('console: ' + m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text and 'Failed to load resource' not in m.text else None)
    await pg.route('**/*', handle)
    if storage:
        await pg.add_init_script(f"for (const [k,v] of Object.entries({json.dumps(storage)})) if (!localStorage.getItem(k)) localStorage.setItem(k, v);")
    await pg.goto(BASE + path)
    await pg.wait_for_timeout(1200)
    return pg

txt = lambda pg, sel: pg.evaluate(f"(document.querySelector({json.dumps(sel)})||{{}}).textContent||''")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # ---- sample data on a phone ----
        pg = await new_page(b, 390, 844)
        check('demo: hero headline counts things', 'need you' in await txt(pg, '#pulseHero h1') or 'needs you' in await txt(pg, '#pulseHero h1'), await txt(pg, '#pulseHero h1'))
        check('demo: heatmap drawn', await pg.locator('#pulseExtras rect').count() > 300)
        await pg.screenshot(path=f'{SHOTS}/phone-pulse.png')
        await pg.screenshot(path=f'{SHOTS}/phone-pulse-full.png', full_page=True)
        for v in ['attention', 'shipped', 'repos', 'compare', 'ask']:
            await pg.click(f'.nav-bottom[data-nav="{v}"]')
            await pg.wait_for_timeout(250)
            await pg.screenshot(path=f'{SHOTS}/phone-{v}.png')
        check('demo: repo cards carry a health badge', await pg.locator('#repoGridContainer [title^="Health"]').count() >= 15)
        await pg.click('.nav-bottom[data-nav="attention"]')
        await pg.click('[data-act="merge"]')
        check('demo: merge asks first', 'Merge #' in await txt(pg, '#confirmTitle'))
        await pg.screenshot(path=f'{SHOTS}/phone-confirm.png')
        await pg.click('#confirmYes')
        check('demo: merge changes nothing', not any('pulls' in c for c in CALLS))
        check('demo: no page errors', not pg.errs, pg.errs)
        await pg.context.close()

        # ---- live, with a token, desktop ----
        CALLS.clear()
        pg = await new_page(b, 1280, 900, {'repopulse_github_pat': 'ghp_test', 'repopulse_last_username': 'sfxhewitt'})
        check('live: profile loaded', await txt(pg, '#profileHandle') == '@sfxhewitt', await txt(pg, '#profileHandle'))
        head = await txt(pg, '#pulseHero h1')
        check('live: hero says 4 things need you', head.startswith('4 things'), head)
        check('live: one GraphQL call', CALLS.count('POST /graphql') == 1, CALLS)
        check('live: nav badge shows 4', await txt(pg, '.nav-tab [data-attention-count]') == '4')
        await pg.screenshot(path=f'{SHOTS}/desk-pulse.png', full_page=True)
        await pg.keyboard.press('2')
        att = await txt(pg, '#view-attention')
        for needle in ['Ready to merge', 'Pull requests held up', 'CI failing', 'Security alerts', 'Stale branches', 'Gone quiet', 'old-spike']:
            check(f'live: attention shows "{needle}"', needle in att)
        await pg.screenshot(path=f'{SHOTS}/desk-attention.png', full_page=True)
        await pg.click('[data-act="merge"]'); await pg.click('#confirmYes'); await pg.wait_for_timeout(400)
        check('live: merge calls GitHub', 'PUT /repos/sfxhewitt/hq/pulls/5/merge' in CALLS, CALLS)
        check('live: merged PR leaves the list', 'Adopt shared code standards' not in await txt(pg, '#view-attention'))
        await pg.click('[data-act="rerun"]'); await pg.click('#confirmYes'); await pg.wait_for_timeout(500)
        check('live: re-run calls GitHub', 'POST /repos/sfxhewitt/stock-watch/actions/runs/77/rerun-failed-jobs' in CALLS, CALLS)
        await pg.click('[data-act="archive"]')
        check('live: archive warns', 'read-only' in await txt(pg, '#confirmBody'))
        await pg.keyboard.press('Escape')
        check('live: Escape cancels archive', not any(c.startswith('PATCH') for c in CALLS))
        await pg.click('[data-act="archive"]'); await pg.click('#confirmYes'); await pg.wait_for_timeout(400)
        check('live: archive calls GitHub', 'PATCH /repos/sfxhewitt/old-thing' in CALLS, CALLS)
        await pg.keyboard.press('3')
        check('live: ship log lists commits', 'commits across' in await txt(pg, '#view-shipped h1'), await txt(pg, '#view-shipped h1'))
        await pg.screenshot(path=f'{SHOTS}/desk-shipped.png')
        await pg.keyboard.press('4'); await pg.keyboard.press('j'); await pg.keyboard.press('j'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
        check('live: j/j/Enter opens the second repo', await txt(pg, '#drawerRepoName') == 'plexodus', await txt(pg, '#drawerRepoName'))
        check('live: drawer shows health', 'Health' in await txt(pg, '#drawerHealth'))
        check('live: drawer reuses GraphQL languages and commits', not any(c.endswith('/languages') or c.endswith('/commits') for c in CALLS), CALLS)
        await pg.screenshot(path=f'{SHOTS}/desk-drawer.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        await pg.keyboard.press('Control+k'); await pg.keyboard.type('tabb'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=f'{SHOTS}/desk-palette.png')
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(500)
        check('live: palette opens a repo', await txt(pg, '#drawerRepoName') == 'tabbeth', await txt(pg, '#drawerRepoName'))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
        await pg.keyboard.press('5'); await pg.fill('#compareB', 'octocat'); await pg.click('#compareForm button[type=submit]'); await pg.wait_for_timeout(600)
        check('live: compare renders both', 'The Octocat' in await txt(pg, '#view-compare') and 'Danny Hewitt' in await txt(pg, '#view-compare'))
        check('live: compare is in the address', 'compare=sfxhewitt%2Coctocat' in pg.url or 'compare=sfxhewitt,octocat' in pg.url, pg.url)
        await pg.screenshot(path=f'{SHOTS}/desk-compare.png')
        await pg.keyboard.press('Escape'); await pg.evaluate('document.activeElement.blur()'); await pg.keyboard.press('6')
        await pg.fill('#askKey', 'sk-ant-test'); await pg.fill('#askQuestion', 'Which projects have I neglected?'); await pg.click('#askForm button[type=submit]'); await pg.wait_for_timeout(500)
        check('live: ask shows the answer', 'no pushes for over a year' in await txt(pg, '#view-ask'), await txt(pg, '#view-ask'))
        await pg.fill('#askQuestion', 'Should I archive it?'); await pg.click('#askForm button[type=submit]'); await pg.wait_for_timeout(500)
        check('live: follow-up sends the earlier turn too', ASKS[-1] == ['user', 'assistant', 'user'], ASKS)
        check('live: thread shows both questions', 'Which projects have I neglected?' in await txt(pg, '#askThread') and 'Should I archive it?' in await txt(pg, '#askThread'))
        await pg.click('[data-act="ask-reset"]')
        check('live: start over clears the thread', await txt(pg, '#askThread') == '')
        await pg.screenshot(path=f'{SHOTS}/desk-ask.png')
        await pg.evaluate('document.activeElement.blur()'); await pg.keyboard.press('1')
        await pg.click('#shareCardBtn'); await pg.wait_for_timeout(900)
        painted = await pg.evaluate("(() => { const c = document.getElementById('cardCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 400) if (d[i] < 80) dark++; return dark; })()")
        check('live: share card has ink on it', painted > 50, painted)
        await pg.locator('#cardCanvas').screenshot(path=f'{SHOTS}/card.png')
        check('live: no page errors', not pg.errs, pg.errs)
        snap = await pg.evaluate("Boolean(localStorage.getItem('repopulse_snapshot_v1:sfxhewitt') && localStorage.getItem('repopulse_cockpit_v1:sfxhewitt'))")
        check('live: snapshots saved for instant start', snap)
        await pg.context.close()

        # ---- live, no token, phone, deep link ----
        pg = await new_page(b, 390, 844, None, '?user=sfxhewitt&view=attention')
        check('link: ?user= loads the account', await txt(pg, '#profileHandle') == '@sfxhewitt')
        check('link: ?view= opens Needs you, locked without a token', 'needs a GitHub token' in await txt(pg, '#view-attention'), await txt(pg, '#view-attention'))
        await pg.screenshot(path=f'{SHOTS}/phone-locked.png')
        hh = await pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--header-h')")
        await pg.click('.nav-bottom[data-nav="repos"]'); await pg.mouse.wheel(0, 900); await pg.wait_for_timeout(300)
        overlap = await pg.evaluate("(() => { const h = document.querySelector('header').getBoundingClientRect(); const t = document.querySelector('[data-view=repos] .sticky').getBoundingClientRect(); return t.top - h.bottom; })()")
        check('phone: filter bar sits below the header when stuck', abs(overlap) < 2, f'{overlap} / {hh}')
        await pg.screenshot(path=f'{SHOTS}/phone-repos-scrolled.png')
        check('link: no page errors', not pg.errs, pg.errs)
        await pg.context.close()
        await b.close()
    print('\nFAILED: ' + ', '.join(FAIL) if FAIL else '\nALL PASSED')
    sys.exit(1 if FAIL else 0)

asyncio.run(main())
