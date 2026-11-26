# RepoPulse

A cockpit for your GitHub repos. It runs entirely in the browser; there is no backend.

Live: https://sfxhewitt.github.io/Repopulse/

## What it shows

- **Pulse**: how many things need you, what you shipped this week, your contribution year, streaks, and which projects are heating up or cooling off.
- **Needs you**: pull requests ready to merge or held up, failing CI on default branches, Dependabot alerts, stale branches and repos gone quiet. You can merge, re-run failed jobs and archive from here; each asks first.
- **Shipped**: commits that reached a default branch in the last 7 or 30 days. Its **24 hours** setting is the "what shipped" digest: merged pull requests, deploys and Pages builds, and failed workflow runs, grouped by repo, with failed runs and open pull requests at the top and a three-line summary you can copy.
- **Repos**: every repo with a health score and the reasons behind it, filters, export, and an inspector.
- **Compare**: two accounts side by side (public repos).
- **Ask**: questions about your repos answered by Claude, using your own Anthropic API key.

A shareable card (PNG) is under the Card button. `Ctrl K` opens search and commands.

## Tokens

Without a token you get the public repo list. A GitHub personal access token unlocks everything else, because pull requests, checks and activity come from GitHub's GraphQL API, which only answers signed-in requests.

- Read-only use: a fine-grained token with read access to Contents, Metadata, Pull requests, Actions and Dependabot alerts. Add Deployments if you want deploys in the 24-hour digest; without it the digest says which repos it couldn't read.
- To merge, re-run jobs or archive from the page: add write access to Pull requests, Contents and Actions, and Administration for archiving.

Tokens and the Anthropic key stay in your browser's storage and are sent only to `api.github.com` and `api.anthropic.com`. The last loaded data is also saved in the browser so the page opens instantly and works offline.

## Develop

```
npm install
npm run build        # compiles src/app.css to assets/app.css
python3 -m http.server
```

`tests/e2e.py <site dir> <screenshot dir>` drives the app in Chromium (Playwright for Python) with GitHub and Anthropic stubbed. `node tests/gqlcheck.js js/cockpit.js <schema.graphql>` validates the query against GitHub's schema from `@octokit/graphql-schema`.

`npm test` runs the unit tests for the digest logic in `js/digest.js` (Node's built-in test runner, no extra packages).

## The 24-hour digest from a script

`?view=shipped&range=24h` (or `?view=digest`) opens the digest directly. For a scheduled job, the same code runs under Node 18 or later and prints the three lines:

```
GITHUB_TOKEN=... node scripts/digest.js            # the token's own account
GITHUB_TOKEN=... node scripts/digest.js --json     # the full digest as JSON
```

It exits with 1 and a message on stderr if GitHub couldn't be read. In the page, the same text sits in `#digestSummary`, and `#view-shipped` carries `data-digest-status="ready"` once it has loaded.

GitHub Pages serves the `gh-pages` branch; push `main` to both.
