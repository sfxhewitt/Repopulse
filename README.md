# RepoPulse

A single-page dashboard for any GitHub account's repositories: totals, language mix, how recently each repo was pushed, and a per-repo inspector (languages by bytes, recent commits, rendered README).

- Everything runs in the browser against `api.github.com`; there is no backend.
- Opens on a sample workspace. Enter a username to load live data.
- An optional personal access token (stored only in your browser) raises the rate limit to 5,000 requests/hour and shows your private repos.
- The filtered list exports as CSV or JSON.

The whole app is `index.html`. Open it locally or serve it with GitHub Pages.
