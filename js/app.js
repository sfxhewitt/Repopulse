/* RepoPulse core: profile, repo list, filters, inspector. */
(() => {
  'use strict';

  /* ===================================================================
   * 1. CONSTANTS & GITHUB LINGUIST COLORS
   * =================================================================== */
  const STORAGE_KEYS = {
    THEME: 'repopulse_theme',
    USERNAME: 'repopulse_last_username',
    SNAPSHOT: 'repopulse_snapshot_v1',
    PAT: 'repopulse_github_pat',
    VIEW_MODE: 'repopulse_view_mode',
    DEMO_BANNER_DISMISSED: 'repopulse_demo_banner_dismissed',
  };

  // Accurate GitHub Linguist hex color mapping
  const LANGUAGE_COLORS = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Rust: '#dea584',
    Go: '#00ADD8',
    Swift: '#F05138',
    HTML: '#e34c26',
    CSS: '#563d7c',
    SCSS: '#c6538c',
    Shell: '#89e051',
    'C++': '#f34b7d',
    C: '#555555',
    'C#': '#178600',
    Java: '#b07219',
    Kotlin: '#A97BFF',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Dart: '#00B4AB',
    'Jupyter Notebook': '#DA5B0B',
    Dockerfile: '#384d54',
    Zig: '#ec915c',
    Elixir: '#6e4a7e',
    Nix: '#7e7eff',
    Lua: '#000080',
    Astro: '#ff5a03',
    MDX: '#fcb32c',
    Makefile: '#427819',
    HCL: '#844FBA',
    Solidity: '#AA6746',
    R: '#198CE7',
    Scala: '#c22d40',
    Haskell: '#5e5086',
    'Objective-C': '#438eff',
    PowerShell: '#012456',
  };

  function getLangColor(lang) {
    if (!lang) return '#71717a';
    if (LANGUAGE_COLORS[lang]) return LANGUAGE_COLORS[lang];
    // Deterministic pleasant fallback color for uncommon languages
    let hash = 0;
    for (let i = 0; i < lang.length; i++) {
      hash = lang.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 62%, 56%)`;
  }

  /* ===================================================================
   * 2. APPLICATION STATE
   * =================================================================== */
  const state = {
    mode: 'demo', // 'demo' | 'live'
    username: '',
    profile: null,
    repos: [],
    filteredRepos: [],
    token: '',
    authenticatedUser: null, // login string if PAT verified
    includesPrivate: false,
    rateLimit: {
      remaining: null,
      limit: null,
      reset: null,
    },
    filters: {
      search: '',
      type: 'all', // 'all' | 'original' | 'fork' | 'archived' | 'homepage' | 'private'
      language: 'all',
      health: 'all', // 'all' | 'active' | 'recent' | 'dormant' | 'archived'
      topic: '',
      sort: 'pushed', // 'pushed' | 'stars' | 'forks' | 'issues' | 'name' | 'size'
    },
    viewMode: localStorage.getItem(STORAGE_KEYS.VIEW_MODE) || 'grid',
    activeDrawerRepo: null,
    cloneMode: 'https',
    inspectorCache: new Map(), // repo.full_name -> { languages, commits, readme }
  };

  /* ===================================================================
   * 3. REALISTIC INTERACTIVE DEMO WORKSPACE GENERATOR
   * =================================================================== */
  function daysAgoISO(days) {
    return new Date(Date.now() - days * 86400 * 1000).toISOString();
  }

  function buildDemoWorkspace() {
    const demoProfile = {
      login: 'alexrivera-dev',
      name: 'Alex Rivera',
      avatar_url: 'https://placehold.co/160x160/1e1b4b/c7d2fe?text=AR',
      bio: 'Principal Systems & UI Engineer building developer tools, local-first sync engines, and high-craft web interfaces.',
      location: 'London, UK',
      followers: 1842,
      following: 164,
      created_at: '2017-04-12T09:15:00Z',
      html_url: 'https://github.com',
      public_repos: 16,
    };

    const demoRepos = [
      {
        id: 1001,
        name: 'vortex-sync',
        full_name: 'alexrivera-dev/vortex-sync',
        private: false,
        fork: false,
        archived: false,
        description: 'Zero-latency CRDT sync engine for local-first web and desktop applications with IndexedDB & WebSocket transport.',
        language: 'TypeScript',
        stargazers_count: 2480,
        watchers_count: 2480,
        forks_count: 194,
        open_issues_count: 14,
        size: 14820,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['crdt', 'local-first', 'typescript', 'sync-engine', 'indexeddb'],
        homepage: 'https://vortex-sync.dev',
        html_url: 'https://github.com/alexrivera-dev/vortex-sync',
        clone_url: 'https://github.com/alexrivera-dev/vortex-sync.git',
        ssh_url: 'git@github.com:alexrivera-dev/vortex-sync.git',
        created_at: '2024-02-11T10:00:00Z',
        pushed_at: daysAgoISO(1),
        _demoLanguages: { TypeScript: 412500, Rust: 86400, CSS: 12100, Shell: 4200 },
        _demoCommits: [
          { sha: 'a8f31c9', message: 'feat(engine): add delta compression for vector clock snapshots', author: 'Alex Rivera', date: daysAgoISO(1) },
          { sha: '7d20b4e', message: 'perf(storage): batch IndexedDB writes inside microtask queue', author: 'Alex Rivera', date: daysAgoISO(3) },
          { sha: '3e910fa', message: 'fix(ws): exponential backoff jitter on reconnect handshake', author: 'Maya Lin', date: daysAgoISO(6) },
          { sha: 'c1042bd', message: 'docs: add multi-tab broadcast channel architecture diagram', author: 'Alex Rivera', date: daysAgoISO(9) },
          { sha: '9b77e12', message: 'chore(release): publish v2.8.0 workspace packages', author: 'Alex Rivera', date: daysAgoISO(12) },
        ],
        _demoReadme: `# Vortex Sync\n\n> Zero-latency CRDT sync engine for local-first web & desktop apps.\n\n## Highlights\n- **Sub-millisecond local reads** powered by memory-mapped IndexedDB snapshots\n- **Conflict-free merges** using Hybrid Logical Clocks (HLC)\n- **Tiny footprint** — \`7.8 KB\` gzipped core with zero runtime dependencies\n\n## Quick Start\n\`\`\`bash\nnpm install @vortex-sync/core @vortex-sync/react\n\`\`\`\n\n\`\`\`ts\nimport { createSyncStore } from '@vortex-sync/core';\n\nconst store = createSyncStore({\n  namespace: 'workspace-main',\n  endpoint: 'wss://sync.vortex.dev/v1',\n});\n\`\`\`\n\n## License\nMIT © Alex Rivera`,
      },
      {
        id: 1002,
        name: 'hypertrace-rs',
        full_name: 'alexrivera-dev/hypertrace-rs',
        private: false,
        fork: false,
        archived: false,
        description: 'Ultra-fast distributed OpenTelemetry trace collector & terminal flamegraph visualizer written in Rust.',
        language: 'Rust',
        stargazers_count: 1624,
        watchers_count: 1624,
        forks_count: 112,
        open_issues_count: 9,
        size: 22450,
        default_branch: 'main',
        license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
        topics: ['rust', 'opentelemetry', 'observability', 'tui', 'flamegraph'],
        homepage: 'https://hypertrace.rs',
        html_url: 'https://github.com/alexrivera-dev/hypertrace-rs',
        clone_url: 'https://github.com/alexrivera-dev/hypertrace-rs.git',
        ssh_url: 'git@github.com:alexrivera-dev/hypertrace-rs.git',
        created_at: '2023-09-18T14:22:00Z',
        pushed_at: daysAgoISO(4),
        _demoLanguages: { Rust: 618400, Shell: 19200, Dockerfile: 3400 },
        _demoCommits: [
          { sha: 'f21c8a0', message: 'feat(tui): keyboard zoom and pan inside span flamegraph', author: 'Alex Rivera', date: daysAgoISO(4) },
          { sha: '88e01dc', message: 'perf(ingest): zero-copy protobuf decoding for OTLP gRPC', author: 'Alex Rivera', date: daysAgoISO(8) },
          { sha: '5a71f3b', message: 'fix(ringbuf): prevent tail drop under bursty 50k spans/s load', author: 'Samir Patel', date: daysAgoISO(15) },
          { sha: '19ab40c', message: 'test: add criterion benchmarks for span indexing', author: 'Alex Rivera', date: daysAgoISO(21) },
          { sha: '0d4421e', message: 'chore: bump tokio to 1.42 and ratatui to 0.29', author: 'Alex Rivera', date: daysAgoISO(26) },
        ],
        _demoReadme: `# hypertrace-rs\n\nA single-binary OpenTelemetry trace collector with an embedded interactive TUI flamegraph.\n\n\`\`\`bash\ncargo install hypertrace-rs\nhypertrace --grpc-port 4317 --tui\n\`\`\`\n\n### Performance\nSustains **120,000 spans/sec** on a single M3 core with < 45MB RSS.`,
      },
      {
        id: 1003,
        name: 'cmdk-studio',
        full_name: 'alexrivera-dev/cmdk-studio',
        private: false,
        fork: false,
        archived: false,
        description: 'Accessible, composable command palette primitives with fuzzy scoring, nested pages, and spring animations.',
        language: 'TypeScript',
        stargazers_count: 938,
        watchers_count: 938,
        forks_count: 68,
        open_issues_count: 6,
        size: 5410,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['command-palette', 'ui', 'accessibility', 'design-systems'],
        homepage: 'https://cmdk.studio',
        html_url: 'https://github.com/alexrivera-dev/cmdk-studio',
        clone_url: 'https://github.com/alexrivera-dev/cmdk-studio.git',
        ssh_url: 'git@github.com:alexrivera-dev/cmdk-studio.git',
        created_at: '2024-06-05T11:30:00Z',
        pushed_at: daysAgoISO(9),
        _demoLanguages: { TypeScript: 184200, CSS: 32500, HTML: 4800 },
        _demoCommits: [
          { sha: 'e4109b2', message: 'feat(score): boost consecutive character matches in fuzzy ranker', author: 'Alex Rivera', date: daysAgoISO(9) },
          { sha: '4c29a11', message: 'fix(a11y): preserve aria-activedescendant across async results', author: 'Alex Rivera', date: daysAgoISO(16) },
          { sha: '21f87d9', message: 'docs: add Raycast-style nested action panel recipe', author: 'Alex Rivera', date: daysAgoISO(24) },
        ],
        _demoReadme: `# cmdk-studio\n\nHigh-craft command palette primitives inspired by Linear and Raycast.\n\n- Full WAI-ARIA combobox compliance\n- Built-in fuzzy search with match highlighting\n- Keyboard shortcut sequences (\`G then I\`)`,
      },
      {
        id: 1004,
        name: 'edge-kv-proxy',
        full_name: 'alexrivera-dev/edge-kv-proxy',
        private: false,
        fork: false,
        archived: false,
        description: 'Geo-replicated read-through caching proxy in Go with stale-while-revalidate headers and Prometheus metrics.',
        language: 'Go',
        stargazers_count: 512,
        watchers_count: 512,
        forks_count: 47,
        open_issues_count: 3,
        size: 8920,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['golang', 'caching', 'edge', 'proxy', 'prometheus'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/edge-kv-proxy',
        clone_url: 'https://github.com/alexrivera-dev/edge-kv-proxy.git',
        ssh_url: 'git@github.com:alexrivera-dev/edge-kv-proxy.git',
        created_at: '2023-11-29T16:40:00Z',
        pushed_at: daysAgoISO(17),
        _demoLanguages: { Go: 265000, Dockerfile: 2900, Makefile: 1800 },
        _demoCommits: [
          { sha: 'b9124e7', message: 'feat(cache): add singleflight request coalescing for cold keys', author: 'Alex Rivera', date: daysAgoISO(17) },
          { sha: '67aa109', message: 'chore: update Go toolchain to 1.24', author: 'Alex Rivera', date: daysAgoISO(34) },
        ],
        _demoReadme: `# edge-kv-proxy\n\nLightweight Go reverse proxy implementing RFC 5861 \`stale-while-revalidate\` with request coalescing.`,
      },
      {
        id: 1005,
        name: 'prompt-eval-kit',
        full_name: 'alexrivera-dev/prompt-eval-kit',
        private: false,
        fork: false,
        archived: false,
        description: 'Deterministic regression harness for evaluating LLM structured outputs, latency percentiles, and JSON schema adherence.',
        language: 'Python',
        stargazers_count: 745,
        watchers_count: 745,
        forks_count: 83,
        open_issues_count: 11,
        size: 6780,
        default_branch: 'main',
        license: { spdx_id: 'Apache-2.0', name: 'Apache License 2.0' },
        topics: ['python', 'llm', 'evals', 'testing', 'json-schema'],
        homepage: 'https://promptevalkit.org',
        html_url: 'https://github.com/alexrivera-dev/prompt-eval-kit',
        clone_url: 'https://github.com/alexrivera-dev/prompt-eval-kit.git',
        ssh_url: 'git@github.com:alexrivera-dev/prompt-eval-kit.git',
        created_at: '2024-08-19T08:10:00Z',
        pushed_at: daysAgoISO(6),
        _demoLanguages: { Python: 214500, 'Jupyter Notebook': 48200, Shell: 5400 },
        _demoCommits: [
          { sha: 'd40291c', message: 'feat(report): export side-by-side HTML diff for eval runs', author: 'Alex Rivera', date: daysAgoISO(6) },
          { sha: 'a129c84', message: 'fix(runner): respect semaphore concurrency cap on retries', author: 'Alex Rivera', date: daysAgoISO(14) },
        ],
        _demoReadme: `# prompt-eval-kit\n\nTreat prompt engineering like software engineering with CI-friendly regression suites.\n\n\`\`\`bash\npip install prompt-eval-kit\npek run suites/extraction.yaml --compare baseline.json\n\`\`\``,
      },
      {
        id: 1006,
        name: 'menubar-focus',
        full_name: 'alexrivera-dev/menubar-focus',
        private: false,
        fork: false,
        archived: false,
        description: 'Minimalist native macOS menu bar focus timer and deep-work session logger built with SwiftUI.',
        language: 'Swift',
        stargazers_count: 389,
        watchers_count: 389,
        forks_count: 29,
        open_issues_count: 4,
        size: 11200,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['swiftui', 'macos', 'menubar', 'productivity'],
        homepage: 'https://menubarfocus.app',
        html_url: 'https://github.com/alexrivera-dev/menubar-focus',
        clone_url: 'https://github.com/alexrivera-dev/menubar-focus.git',
        ssh_url: 'git@github.com:alexrivera-dev/menubar-focus.git',
        created_at: '2024-01-08T19:00:00Z',
        pushed_at: daysAgoISO(22),
        _demoLanguages: { Swift: 192300, Shell: 3100 },
        _demoCommits: [
          { sha: '51cb83a', message: 'feat(dnd): trigger macOS Focus mode via Shortcuts intent', author: 'Alex Rivera', date: daysAgoISO(22) },
        ],
        _demoReadme: `# MenuBar Focus\n\nA calm, zero-bloat native SwiftUI focus timer living quietly in your macOS menu bar.`,
      },
      {
        id: 1007,
        name: 'dotfiles',
        full_name: 'alexrivera-dev/dotfiles',
        private: false,
        fork: false,
        archived: false,
        description: 'Reproducible macOS & Linux workstation setup: Neovim, Ghostty, Zsh, Starship, Tmux, and Nix Flakes.',
        language: 'Shell',
        stargazers_count: 274,
        watchers_count: 274,
        forks_count: 41,
        open_issues_count: 1,
        size: 3180,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['dotfiles', 'neovim', 'zsh', 'tmux', 'nix'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/dotfiles',
        clone_url: 'https://github.com/alexrivera-dev/dotfiles.git',
        ssh_url: 'git@github.com:alexrivera-dev/dotfiles.git',
        created_at: '2019-07-02T12:00:00Z',
        pushed_at: daysAgoISO(11),
        _demoLanguages: { Shell: 48200, Lua: 39100, Nix: 24600 },
        _demoCommits: [
          { sha: '7a002ef', message: 'chore(nvim): migrate LSP config to native vim.lsp.config', author: 'Alex Rivera', date: daysAgoISO(11) },
        ],
        _demoReadme: `# dotfiles\n\nManaged with GNU Stow & Nix Flakes for instant macOS and Linux provisioning.`,
      },
      {
        id: 1008,
        name: 'tailwind-tokens-cli',
        full_name: 'alexrivera-dev/tailwind-tokens-cli',
        private: false,
        fork: false,
        archived: false,
        description: 'Bi-directional CLI syncing Figma Design Variables with Tailwind CSS v4 @theme definitions and CSS custom properties.',
        language: 'TypeScript',
        stargazers_count: 418,
        watchers_count: 418,
        forks_count: 33,
        open_issues_count: 5,
        size: 4120,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['tailwindcss', 'design-tokens', 'figma', 'cli'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/tailwind-tokens-cli',
        clone_url: 'https://github.com/alexrivera-dev/tailwind-tokens-cli.git',
        ssh_url: 'git@github.com:alexrivera-dev/tailwind-tokens-cli.git',
        created_at: '2024-04-15T15:20:00Z',
        pushed_at: daysAgoISO(54),
        _demoLanguages: { TypeScript: 121000, CSS: 14500 },
        _demoCommits: [
          { sha: '11d73fa', message: 'feat(oklch): preserve OKLCH gamut values during Figma export', author: 'Alex Rivera', date: daysAgoISO(54) },
        ],
        _demoReadme: `# tailwind-tokens-cli\n\nKeep Figma variables and Tailwind CSS \`@theme\` tokens permanently in sync.`,
      },
      {
        id: 1009,
        name: 'pg-index-advisor',
        full_name: 'alexrivera-dev/pg-index-advisor',
        private: false,
        fork: false,
        archived: false,
        description: 'Static & runtime PostgreSQL query plan analyzer that recommends composite B-Tree and GIN indexes.',
        language: 'Python',
        stargazers_count: 615,
        watchers_count: 615,
        forks_count: 52,
        open_issues_count: 8,
        size: 9450,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['postgresql', 'database', 'performance', 'python'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/pg-index-advisor',
        clone_url: 'https://github.com/alexrivera-dev/pg-index-advisor.git',
        ssh_url: 'git@github.com:alexrivera-dev/pg-index-advisor.git',
        created_at: '2023-05-10T09:00:00Z',
        pushed_at: daysAgoISO(88),
        _demoLanguages: { Python: 198000, Shell: 6400 },
        _demoCommits: [
          { sha: '92ba410', message: 'feat(gin): detect JSONB containment queries missing jsonb_path_ops', author: 'Alex Rivera', date: daysAgoISO(88) },
        ],
        _demoReadme: `# pg-index-advisor\n\nInspect \`EXPLAIN (ANALYZE, FORMAT JSON)\` outputs and surface missing composite indexes automatically.`,
      },
      {
        id: 1010,
        name: 'shader-grid-canvas',
        full_name: 'alexrivera-dev/shader-grid-canvas',
        private: false,
        fork: false,
        archived: false,
        description: 'Interactive WebGL2 ambient mesh gradients and dot-matrix background shaders for landing pages (<4KB).',
        language: 'JavaScript',
        stargazers_count: 329,
        watchers_count: 329,
        forks_count: 26,
        open_issues_count: 2,
        size: 2890,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['webgl', 'shaders', 'glsl', 'creative-coding'],
        homepage: 'https://shader-grid.demo.dev',
        html_url: 'https://github.com/alexrivera-dev/shader-grid-canvas',
        clone_url: 'https://github.com/alexrivera-dev/shader-grid-canvas.git',
        ssh_url: 'git@github.com:alexrivera-dev/shader-grid-canvas.git',
        created_at: '2023-12-01T13:15:00Z',
        pushed_at: daysAgoISO(126),
        _demoLanguages: { JavaScript: 84200, HTML: 12100, CSS: 9400 },
        _demoCommits: [
          { sha: 'c8812aa', message: 'perf(dpr): cap devicePixelRatio at 2.0 on HiDPI displays', author: 'Alex Rivera', date: daysAgoISO(126) },
        ],
        _demoReadme: `# shader-grid-canvas\n\nGPU-accelerated subtle mesh and grid backgrounds with automatic \`prefers-reduced-motion\` support.`,
      },
      {
        id: 1011,
        name: 'lucide',
        full_name: 'alexrivera-dev/lucide',
        private: false,
        fork: true,
        archived: false,
        description: 'Beautiful & consistent icon toolkit made by the community. Forked for custom developer workflow icon contributions.',
        language: 'JavaScript',
        stargazers_count: 14,
        watchers_count: 14,
        forks_count: 2,
        open_issues_count: 0,
        size: 48200,
        default_branch: 'main',
        license: { spdx_id: 'ISC', name: 'ISC License' },
        topics: ['icons', 'svg', 'open-source'],
        homepage: 'https://lucide.dev',
        html_url: 'https://github.com/alexrivera-dev/lucide',
        clone_url: 'https://github.com/alexrivera-dev/lucide.git',
        ssh_url: 'git@github.com:alexrivera-dev/lucide.git',
        created_at: '2024-03-11T10:12:00Z',
        pushed_at: daysAgoISO(62),
        _demoLanguages: { JavaScript: 512000, TypeScript: 128000, CSS: 18000 },
        _demoCommits: [
          { sha: '44ef901', message: 'feat(icons): add git-compare-arrows and trace-span SVGs', author: 'Alex Rivera', date: daysAgoISO(62) },
        ],
        _demoReadme: `# Lucide (Fork)\n\nPersonal fork used for submitting custom developer-tool SVG icon PRs upstream.`,
      },
      {
        id: 1012,
        name: 'wasm-audio-dsp',
        full_name: 'alexrivera-dev/wasm-audio-dsp',
        private: false,
        fork: false,
        archived: false,
        description: 'Real-time C++ / WebAssembly AudioWorklet DSP filters, biquad equalizers, and FFT spectrum analyzers.',
        language: 'C++',
        stargazers_count: 208,
        watchers_count: 208,
        forks_count: 19,
        open_issues_count: 3,
        size: 16400,
        default_branch: 'main',
        license: { spdx_id: 'BSD-3-Clause', name: 'BSD 3-Clause' },
        topics: ['cpp', 'webassembly', 'dsp', 'webaudio'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/wasm-audio-dsp',
        clone_url: 'https://github.com/alexrivera-dev/wasm-audio-dsp.git',
        ssh_url: 'git@github.com:alexrivera-dev/wasm-audio-dsp.git',
        created_at: '2022-10-14T18:00:00Z',
        pushed_at: daysAgoISO(245),
        _demoLanguages: { 'C++': 294000, TypeScript: 52000, Shell: 4100 },
        _demoCommits: [
          { sha: '33a71d2', message: 'perf(simd): enable WASM SIMD128 intrinsics for FFT butterfly', author: 'Alex Rivera', date: daysAgoISO(245) },
        ],
        _demoReadme: `# wasm-audio-dsp\n\nZero-allocation C++20 DSP modules compiled via Emscripten for browser \`AudioWorkletProcessor\`.`,
      },
      {
        id: 1013,
        name: 'md-slide-deck',
        full_name: 'alexrivera-dev/md-slide-deck',
        private: false,
        fork: false,
        archived: false,
        description: 'Minimal HTML/CSS presentation deck engine that renders technical Markdown talks with live code execution.',
        language: 'HTML',
        stargazers_count: 164,
        watchers_count: 164,
        forks_count: 22,
        open_issues_count: 2,
        size: 1940,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['markdown', 'presentations', 'html', 'slides'],
        homepage: 'https://md-slides.alexrivera.dev',
        html_url: 'https://github.com/alexrivera-dev/md-slide-deck',
        clone_url: 'https://github.com/alexrivera-dev/md-slide-deck.git',
        ssh_url: 'git@github.com:alexrivera-dev/md-slide-deck.git',
        created_at: '2023-02-09T11:20:00Z',
        pushed_at: daysAgoISO(310),
        _demoLanguages: { HTML: 41200, CSS: 28900, JavaScript: 24500 },
        _demoCommits: [
          { sha: '8f12c09', message: 'feat: add presenter speaker notes sync via BroadcastChannel', author: 'Alex Rivera', date: daysAgoISO(310) },
        ],
        _demoReadme: `# md-slide-deck\n\nWrite conference talks in plain Markdown and present directly from any browser.`,
      },
      {
        id: 1014,
        name: 'raft-consensus-sim',
        full_name: 'alexrivera-dev/raft-consensus-sim',
        private: false,
        fork: false,
        archived: false,
        description: 'Deterministic network partition simulator for teaching and testing Raft leader election and log replication.',
        language: 'Go',
        stargazers_count: 451,
        watchers_count: 451,
        forks_count: 64,
        open_issues_count: 4,
        size: 7340,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['distributed-systems', 'raft', 'golang', 'simulation'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/raft-consensus-sim',
        clone_url: 'https://github.com/alexrivera-dev/raft-consensus-sim.git',
        ssh_url: 'git@github.com:alexrivera-dev/raft-consensus-sim.git',
        created_at: '2022-05-22T14:00:00Z',
        pushed_at: daysAgoISO(420),
        _demoLanguages: { Go: 182000, TypeScript: 46000 },
        _demoCommits: [
          { sha: 'e0192b4', message: 'feat(sim): inject asymmetric packet drop partitions by seed', author: 'Alex Rivera', date: daysAgoISO(420) },
        ],
        _demoReadme: `# raft-consensus-sim\n\nDeterministic discrete-event simulator for Raft clusters with reproducible chaos seeds.`,
      },
      {
        id: 1015,
        name: 'awesome-local-first',
        full_name: 'alexrivera-dev/awesome-local-first',
        private: false,
        fork: true,
        archived: false,
        description: 'Curated list of local-first software papers, sync engines, CRDT libraries, and production case studies.',
        language: null,
        stargazers_count: 37,
        watchers_count: 37,
        forks_count: 5,
        open_issues_count: 0,
        size: 620,
        default_branch: 'main',
        license: { spdx_id: 'CC0-1.0', name: 'Creative Commons Zero v1.0' },
        topics: ['awesome-list', 'local-first', 'crdt'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/awesome-local-first',
        clone_url: 'https://github.com/alexrivera-dev/awesome-local-first.git',
        ssh_url: 'git@github.com:alexrivera-dev/awesome-local-first.git',
        created_at: '2023-08-14T09:45:00Z',
        pushed_at: daysAgoISO(195),
        _demoLanguages: {},
        _demoCommits: [
          { sha: '19ab221', message: 'docs: add 2025 Ink & Switch Cambria follow-up paper', author: 'Alex Rivera', date: daysAgoISO(195) },
        ],
        _demoReadme: `# Awesome Local-First\n\nA community-curated catalog of local-first architecture resources.`,
      },
      {
        id: 1016,
        name: 'legacy-webpack-starter',
        full_name: 'alexrivera-dev/legacy-webpack-starter',
        private: false,
        fork: false,
        archived: true,
        description: 'Zero-config Webpack 4 + Babel starter kit. Archived in favor of Vite and native ESM toolchains.',
        language: 'JavaScript',
        stargazers_count: 192,
        watchers_count: 192,
        forks_count: 38,
        open_issues_count: 0,
        size: 2150,
        default_branch: 'master',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['webpack', 'legacy', 'archived'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/legacy-webpack-starter',
        clone_url: 'https://github.com/alexrivera-dev/legacy-webpack-starter.git',
        ssh_url: 'git@github.com:alexrivera-dev/legacy-webpack-starter.git',
        created_at: '2019-11-03T16:30:00Z',
        pushed_at: daysAgoISO(820),
        _demoLanguages: { JavaScript: 64000, CSS: 11200, HTML: 3200 },
        _demoCommits: [
          { sha: '00a9b11', message: 'docs: add deprecation banner pointing to Vite template', author: 'Alex Rivera', date: daysAgoISO(820) },
        ],
        _demoReadme: `# legacy-webpack-starter (Archived)\n\nThis repository has been archived and is read-only. Please use Vite for new projects.`,
      },
      {
        id: 1017,
        name: 'css-grid-blueprint',
        full_name: 'alexrivera-dev/css-grid-blueprint',
        private: false,
        fork: false,
        archived: true,
        description: 'Experimental subgrid layout primitives and responsive print stylesheet patterns. Archived.',
        language: 'CSS',
        stargazers_count: 89,
        watchers_count: 89,
        forks_count: 11,
        open_issues_count: 0,
        size: 980,
        default_branch: 'main',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['css', 'subgrid', 'layout'],
        homepage: '',
        html_url: 'https://github.com/alexrivera-dev/css-grid-blueprint',
        clone_url: 'https://github.com/alexrivera-dev/css-grid-blueprint.git',
        ssh_url: 'git@github.com:alexrivera-dev/css-grid-blueprint.git',
        created_at: '2020-06-18T10:00:00Z',
        pushed_at: daysAgoISO(640),
        _demoLanguages: { CSS: 52800, HTML: 14200 },
        _demoCommits: [
          { sha: '71ef04c', message: 'chore: archive experiment after baseline subgrid support', author: 'Alex Rivera', date: daysAgoISO(640) },
        ],
        _demoReadme: `# css-grid-blueprint\n\nArchived CSS subgrid experiments.`,
      },
    ];

    return { profile: demoProfile, repos: demoRepos };
  }

  /* ===================================================================
   * 4. UTILITY HELPERS
   * =================================================================== */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(n) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return Number(n).toLocaleString();
  }

  function formatSizeKB(kb) {
    if (!kb || kb <= 0) return '0 KB';
    if (kb >= 1024 * 1024) return (kb / (1024 * 1024)).toFixed(2) + ' GB';
    if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
    return Math.round(kb) + ' KB';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return 'unknown';
    const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diffSec < 60) return 'just now';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }

  function formatShortDate(isoString) {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  function getRepoHealthBucket(repo) {
    if (repo.archived) return 'archived';
    const pushedMs = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
    const ageDays = (Date.now() - pushedMs) / (1000 * 60 * 60 * 24);
    if (ageDays <= 30) return 'active';
    if (ageDays <= 180) return 'recent';
    return 'dormant';
  }

  function decodeBase64UTF8(base64Str) {
    const clean = (base64Str || '').replace(/\s/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function normalizeHomepageUrl(url) {
    if (!url || !url.trim()) return '';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return 'https://' + trimmed;
  }

  // Iframe-safe clipboard copy using document.execCommand('copy')
  function copyToClipboard(text, successMsg = 'Copied to clipboard') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) {
        showToast(successMsg, 'success');
      } else {
        showToast('Unable to copy text', 'error');
      }
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      showToast('Unable to copy text', 'error');
    }
  }

  /* ===================================================================
   * 5. TOAST NOTIFICATIONS
   * =================================================================== */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const iconMap = {
      success: { icon: 'check-circle-2', color: 'text-emerald-500' },
      error: { icon: 'alert-circle', color: 'text-rose-500' },
      info: { icon: 'info', color: 'text-indigo-500' },
    };
    const cfg = iconMap[type] || iconMap.info;

    const toast = document.createElement('div');
    toast.className =
      'pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/[0.12] bg-white dark:bg-[#242030] shadow-xl text-xs font-medium text-zinc-800 dark:text-zinc-100 transition-all duration-200 translate-y-2 opacity-0';
    toast.innerHTML = `
      <i data-lucide="${cfg.icon}" class="w-4 h-4 ${cfg.color} shrink-0"></i>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    lucide.createIcons();

    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    setTimeout(() => {
      toast.classList.add('translate-y-2', 'opacity-0');
      setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  /* ===================================================================
   * 6. GITHUB API CLIENT & RATE-LIMIT TRACKER
   * =================================================================== */
  function getApiHeaders() {
    const headers = {
      Accept: 'application/vnd.github+json',
    };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    return headers;
  }

  function updateRateLimitFromHeaders(headers) {
    if (!headers) return;
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');
    if (remaining !== null && limit !== null) {
      state.rateLimit = {
        remaining: Number(remaining),
        limit: Number(limit),
        reset: reset ? Number(reset) * 1000 : null,
      };
      renderRateLimitBadge();
    }
  }

  function renderRateLimitBadge() {
    const textEl = document.getElementById('rateLimitText');
    const dotEl = document.getElementById('rateLimitDot');
    const badgeEl = document.getElementById('rateLimitBadge');
    if (!textEl || !dotEl || !badgeEl) return;

    if (state.mode === 'demo' && state.rateLimit.limit === null) {
      textEl.textContent = 'Demo Mode';
      dotEl.className = 'w-1.5 h-1.5 rounded-full bg-indigo-500';
      badgeEl.title = 'Viewing interactive sample workspace';
      return;
    }

    if (state.rateLimit.limit !== null) {
      const { remaining, limit, reset } = state.rateLimit;
      textEl.textContent = `${remaining}/${limit} API`;
      const ratio = limit > 0 ? remaining / limit : 0;
      if (remaining === 0) {
        dotEl.className = 'w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse';
      } else if (ratio < 0.2) {
        dotEl.className = 'w-1.5 h-1.5 rounded-full bg-amber-500';
      } else {
        dotEl.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500';
      }
      const resetStr = reset ? ` · Resets at ${new Date(reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
      badgeEl.title = `${remaining} of ${limit} GitHub API calls remaining${resetStr}`;
    }
  }

  async function githubFetch(url) {
    const res = await fetch(url, { headers: getApiHeaders() });
    updateRateLimitFromHeaders(res.headers);
    return res;
  }

  async function verifyToken(token) {
    if (!token) {
      state.authenticatedUser = null;
      return { ok: false, login: null };
    }
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
      });
      updateRateLimitFromHeaders(res.headers);
      if (!res.ok) {
        return { ok: false, status: res.status };
      }
      const user = await res.json();
      state.authenticatedUser = user.login;
      return { ok: true, login: user.login, user };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function snapshotKey(login) {
    return `${STORAGE_KEYS.SNAPSHOT}:${String(login).toLowerCase()}`;
  }

  function saveSnapshot() {
    try {
      localStorage.setItem(
        snapshotKey(state.profile.login),
        JSON.stringify({ savedAt: Date.now(), profile: state.profile, repos: state.repos, includesPrivate: state.includesPrivate })
      );
    } catch (err) {
      console.warn('Could not save snapshot:', err);
    }
  }

  // Paint the last saved copy of an account straight away; a refresh follows.
  function restoreSnapshot(login) {
    try {
      const snap = JSON.parse(localStorage.getItem(snapshotKey(login)) || 'null');
      if (!snap || !snap.profile || !Array.isArray(snap.repos)) return false;
      state.mode = 'live';
      state.username = snap.profile.login;
      state.profile = snap.profile;
      state.repos = snap.repos;
      state.includesPrivate = Boolean(snap.includesPrivate);
      state.snapshotAt = snap.savedAt;
      resetFilters(false);
      renderAll();
      return true;
    } catch {
      return false;
    }
  }

  async function fetchLiveUserAndRepos(rawUsername, opts = {}) {
    const quiet = Boolean(opts.quiet);
    const username = rawUsername.trim().replace(/^@/, '');
    if (!username) {
      showToast('Please enter a GitHub username', 'error');
      return;
    }

    if (!quiet) showLoading(true, `Connecting to @${username}...`, 'Fetching GitHub profile metadata');
    hideError();

    try {
      // If token is present and we haven't checked its owner yet, verify once
      if (state.token && !state.authenticatedUser) {
        const check = await verifyToken(state.token);
        if (!check.ok && check.status === 401) {
          throw {
            title: 'Invalid GitHub Token (401)',
            message: 'Your saved Personal Access Token was rejected by GitHub. Please update or remove it in Auth / Private.',
            showAuth: true,
          };
        }
      }

      const isAuthOwner =
        Boolean(state.token) &&
        Boolean(state.authenticatedUser) &&
        state.authenticatedUser.toLowerCase() === username.toLowerCase();

      // 1. Fetch Profile
      const profileUrl = isAuthOwner
        ? 'https://api.github.com/user'
        : `https://api.github.com/users/${encodeURIComponent(username)}`;

      const profileRes = await githubFetch(profileUrl);

      if (profileRes.status === 404) {
        throw {
          title: `User "@${username}" not found`,
          message: 'Double-check the spelling of the GitHub username or organization and try again.',
          showAuth: false,
        };
      }
      if (profileRes.status === 403 || profileRes.status === 429) {
        const resetTime = state.rateLimit.reset
          ? new Date(state.rateLimit.reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'shortly';
        throw {
          title: 'GitHub API Rate Limit Reached',
          message: `Unauthenticated requests are limited to 60/hr (resets around ${resetTime}). Add a free Personal Access Token to immediately raise your limit to 5,000 req/hr.`,
          showAuth: true,
        };
      }
      if (!profileRes.ok) {
        throw {
          title: `GitHub API Error (${profileRes.status})`,
          message: 'GitHub returned an unexpected error while loading this profile.',
          showAuth: false,
        };
      }

      const profile = await profileRes.json();

      // 2. Paginated Repository Fetching (automatically loops pages > 100 repos)
      const allRepos = [];
      let page = 1;
      const perPage = 100;
      const maxPages = 20; // Guardrail up to 2,000 repos

      while (page <= maxPages) {
        if (!quiet) showLoading(
          true,
          `Loading repositories for @${profile.login}...`,
          page === 1
            ? `Fetching page 1${isAuthOwner ? ' (including private repos)' : ''}...`
            : `Fetching page ${page} (${allRepos.length} repositories loaded so far)...`
        );

        const repoUrl = isAuthOwner
          ? `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&affiliation=owner&sort=pushed`
          : `https://api.github.com/users/${encodeURIComponent(profile.login)}/repos?per_page=${perPage}&page=${page}&sort=pushed&type=owner`;

        const repoRes = await githubFetch(repoUrl);

        if (repoRes.status === 403 || repoRes.status === 429) {
          if (allRepos.length > 0) {
            showToast(`Rate limit hit on page ${page}; displaying ${allRepos.length} loaded repos`, 'error');
            break;
          }
          throw {
            title: 'GitHub API Rate Limit Reached',
            message: 'Add a Personal Access Token in Auth / Private to unlock 5,000 requests per hour.',
            showAuth: true,
          };
        }
        if (!repoRes.ok) {
          throw {
            title: `Failed to fetch repositories (${repoRes.status})`,
            message: 'Could not retrieve the repository list from GitHub.',
            showAuth: false,
          };
        }

        const batch = await repoRes.json();
        if (!Array.isArray(batch) || batch.length === 0) break;

        allRepos.push(...batch);

        // Check if fewer than perPage items returned or Link header has no rel="next"
        const linkHeader = repoRes.headers.get('link') || '';
        const hasNext = linkHeader.includes('rel="next"');
        if (batch.length < perPage || !hasNext) break;
        page++;
      }

      // Commit live state
      state.mode = 'live';
      state.username = profile.login;
      state.profile = profile;
      state.repos = allRepos;
      state.includesPrivate = isAuthOwner || allRepos.some((r) => r.private);
      state.inspectorCache.clear();
      resetFilters(false);

      state.snapshotAt = null;
      localStorage.setItem(STORAGE_KEYS.USERNAME, profile.login);
      document.getElementById('usernameInput').value = profile.login;
      saveSnapshot();
      hook('onUserChange', profile.login);

      showLoading(false);
      renderAll();
      if (!quiet) showToast(`Loaded ${allRepos.length} repositories for @${profile.login}`, 'success');
    } catch (err) {
      showLoading(false);
      if (quiet && state.profile) {
        // Saved copy is on screen; say it is stale and stop there.
        const when = state.snapshotAt ? formatRelativeTime(new Date(state.snapshotAt).toISOString()) : 'earlier';
        showToast(`Couldn't refresh. Showing data saved ${when}.`, 'error');
        return;
      }
      const title = err?.title || 'Network or API Error';
      const message = err?.message || (err instanceof Error ? err.message : 'Unable to connect to api.github.com.');
      showError(title, message, Boolean(err?.showAuth));
      // Keep dashboard visible if we already had data, else fall back cleanly
      if (!state.profile) {
        loadDemoMode(false);
      }
    }
  }

  function loadDemoMode(showNotice = false) {
    const { profile, repos } = buildDemoWorkspace();
    state.mode = 'demo';
    state.username = profile.login;
    state.profile = profile;
    state.repos = repos;
    state.includesPrivate = false;
    state.inspectorCache.clear();
    resetFilters(false);

    hideError();
    showLoading(false);
    renderAll();
    if (showNotice) {
      showToast('Showing sample data', 'info');
    }
  }

  /* ===================================================================
   * 7. UI VISIBILITY HELPERS (LOADING / ERROR / DEMO BANNER)
   * =================================================================== */
  function showLoading(isLoading, title = '', subtitle = '') {
    const loadingEl = document.getElementById('loadingState');
    const contentEl = document.getElementById('dashboardContent');
    if (isLoading) {
      document.getElementById('loadingTitle').textContent = title;
      document.getElementById('loadingSubtitle').textContent = subtitle;
      loadingEl.classList.remove('hidden');
      contentEl.classList.add('opacity-40', 'pointer-events-none');
    } else {
      loadingEl.classList.add('hidden');
      contentEl.classList.remove('opacity-40', 'pointer-events-none');
    }
  }

  function showError(title, message, showAuthBtn = false) {
    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorOpenAuthBtn').classList.toggle('hidden', !showAuthBtn);
    document.getElementById('errorBanner').classList.remove('hidden');
    lucide.createIcons();
  }

  function hideError() {
    document.getElementById('errorBanner').classList.add('hidden');
  }

  function renderDemoBanner() {
    const banner = document.getElementById('demoBanner');
    const dismissed = sessionStorage.getItem(STORAGE_KEYS.DEMO_BANNER_DISMISSED) === '1';
    if (state.mode === 'demo' && !dismissed) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  function renderAuthButtonState() {
    const label = document.getElementById('authBtnLabel');
    const btn = document.getElementById('openAuthModalBtn');

    // Lucide swaps the <i> placeholder for an <svg>, whose className is
    // read-only, so build a fresh placeholder on every render.
    const icon = document.createElement('i');
    icon.id = 'authBtnIcon';

    if (state.token) {
      icon.setAttribute('data-lucide', 'shield-check');
      icon.setAttribute('class', 'w-3.5 h-3.5 text-emerald-500');
      label.textContent = state.authenticatedUser ? `@${state.authenticatedUser}` : 'PAT Active';
      btn.classList.add('border-emerald-500/35');
    } else {
      icon.setAttribute('data-lucide', 'key-round');
      icon.setAttribute('class', 'w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400');
      label.textContent = 'Add token';
      btn.classList.remove('border-emerald-500/35');
    }
    document.getElementById('authBtnIcon').replaceWith(icon);
    lucide.createIcons();
  }

  /* ===================================================================
   * 8. RENDERING: PROFILE, KPIs, ANALYTICS
   * =================================================================== */
  function renderProfile() {
    const p = state.profile;
    if (!p) return;

    const initials = (p.name || p.login || 'GH').slice(0, 2).toUpperCase();
    const fallback = `https://placehold.co/160x160/18181b/e4e4e7?text=${encodeURIComponent(initials)}`;
    const avatarEl = document.getElementById('profileAvatar');
    avatarEl.src = p.avatar_url || fallback;
    avatarEl.onerror = () => {
      avatarEl.onerror = null;
      avatarEl.src = fallback;
    };

    document.getElementById('profileName').textContent = p.name || p.login;
    document.getElementById('profileHandle').textContent = `@${p.login}`;
    document.getElementById('profileBio').textContent = p.bio || 'No profile bio provided.';

    const locWrap = document.getElementById('profileLocationWrap');
    if (p.location) {
      locWrap.classList.remove('hidden');
      document.getElementById('profileLocation').textContent = p.location;
    } else {
      locWrap.classList.add('hidden');
    }

    document.getElementById('profileFollowers').textContent = formatNumber(p.followers || 0);
    document.getElementById('profileFollowing').textContent = formatNumber(p.following || 0);
    document.getElementById('profileJoined').textContent = p.created_at
      ? new Date(p.created_at).getFullYear()
      : '—';

    const extLink = document.getElementById('profileExternalLink');
    extLink.href = p.html_url || `https://github.com/${encodeURIComponent(p.login)}`;

    document.getElementById('profileModeBadge').classList.toggle('hidden', state.mode !== 'demo');
    document.getElementById('profilePrivateScopeBadge').classList.toggle('hidden', !state.includesPrivate);

    const dot = document.getElementById('profileSourceDot');
    if (state.mode === 'demo') {
      dot.className = 'absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 ring-2 ring-white dark:ring-[#1B1823]';
      dot.title = 'Interactive Demo Workspace';
    } else {
      dot.className = 'absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#1B1823]';
      dot.title = 'Connected to Live GitHub API';
    }
  }

  function renderKPIs() {
    const repos = state.repos;
    const total = repos.length;
    const forksCount = repos.filter((r) => r.fork).length;
    const originalsCount = total - forksCount;
    const privateCount = repos.filter((r) => r.private).length;

    const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
    const totalForks = repos.reduce((sum, r) => sum + (r.forks_count || 0), 0);
    const openIssues = repos
      .filter((r) => !r.archived)
      .reduce((sum, r) => sum + (r.open_issues_count || 0), 0);
    const activeRepos = repos.filter((r) => getRepoHealthBucket(r) === 'active').length;
    const activePct = total > 0 ? Math.round((activeRepos / total) * 100) : 0;

    // Top starred repository
    let topStarRepo = null;
    for (const r of repos) {
      if (!topStarRepo || (r.stargazers_count || 0) > (topStarRepo.stargazers_count || 0)) {
        topStarRepo = r;
      }
    }

    // Most forked repository
    let topForkRepo = null;
    for (const r of repos) {
      if (!topForkRepo || (r.forks_count || 0) > (topForkRepo.forks_count || 0)) {
        topForkRepo = r;
      }
    }

    document.getElementById('kpiTotalRepos').textContent = formatNumber(total);
    const privateSub = privateCount > 0 ? ` · ${privateCount} private` : '';
    document.getElementById('kpiTotalReposSub').textContent = `${originalsCount} original · ${forksCount} forks${privateSub}`;

    document.getElementById('kpiTotalStars').textContent = formatNumber(totalStars);
    document.getElementById('kpiTotalStarsSub').textContent =
      topStarRepo && topStarRepo.stargazers_count > 0
        ? `Top: ${topStarRepo.name} (${formatNumber(topStarRepo.stargazers_count)})`
        : 'No stars yet';

    const topStarCard = document.getElementById('kpiTopStarCard');
    topStarCard.onclick = () => {
      if (topStarRepo) openInspectorDrawer(topStarRepo);
    };

    document.getElementById('kpiTotalForks').textContent = formatNumber(totalForks);
    document.getElementById('kpiTotalForksSub').textContent =
      topForkRepo && topForkRepo.forks_count > 0
        ? `Most forked: ${topForkRepo.name}`
        : 'Across all repositories';

    const activeNonArchived = repos.filter((r) => !r.archived).length;
    document.getElementById('kpiOpenIssues').textContent = formatNumber(openIssues);
    document.getElementById('kpiOpenIssuesSub').textContent = `Across ${activeNonArchived} non-archived repos`;

    document.getElementById('kpiActiveRepos').textContent = formatNumber(activeRepos);
    document.getElementById('kpiActivePct').textContent = `${activePct}%`;

    document.getElementById('kpiActiveCard').onclick = () => {
      state.filters.health = state.filters.health === 'active' ? 'all' : 'active';
      applyFiltersAndRender();
    };
  }

  function renderLanguageAnalytics() {
    const counts = new Map();
    for (const repo of state.repos) {
      const lang = repo.language || 'Other / None';
      counts.set(lang, (counts.get(lang) || 0) + 1);
    }

    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const total = state.repos.length || 1;
    const distinctRealLangs = sorted.filter(([name]) => name !== 'Other / None').length;

    document.getElementById('langCountBadge').textContent = `${distinctRealLangs} ${distinctRealLangs === 1 ? 'language' : 'languages'}`;

    // Populate Language Select Dropdown
    const select = document.getElementById('languageSelect');
    const currentLang = state.filters.language;
    select.innerHTML = `<option value="all">All Languages (${state.repos.length})</option>`;
    sorted.forEach(([lang, count]) => {
      const opt = document.createElement('option');
      opt.value = lang;
      opt.textContent = `${lang} (${count})`;
      select.appendChild(opt);
    });
    select.value = counts.has(currentLang) ? currentLang : 'all';

    // Render Segmented Horizontal Bar
    const bar = document.getElementById('languageBar');
    const legend = document.getElementById('languageLegend');
    if (state.repos.length === 0) {
      bar.innerHTML = `<div class="w-full h-full bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>`;
      legend.innerHTML = `<span class="text-xs text-zinc-500">No repositories to analyze.</span>`;
      return;
    }

    bar.innerHTML = sorted
      .map(([lang, count]) => {
        const pct = (count / total) * 100;
        const color = lang === 'Other / None' ? '#71717a' : getLangColor(lang);
        const isSelected = state.filters.language === lang;
        const dimmed = state.filters.language !== 'all' && !isSelected;
        return `
          <button
            type="button"
            data-lang-filter="${escapeHtml(lang)}"
            title="${escapeHtml(lang)}: ${count} repos (${pct.toFixed(1)}%)"
            style="width: ${Math.max(pct, 1.2)}%; background-color: ${color};"
            class="h-full first:rounded-l-full last:rounded-r-full transition-all duration-200 hover:brightness-110 cursor-pointer ${dimmed ? 'opacity-25' : 'opacity-100'}"
          ></button>
        `;
      })
      .join('');

    // Render Interactive Legend Pills (show top 12 to keep card crisp)
    const visibleLangs = sorted.slice(0, 12);
    legend.innerHTML = visibleLangs
      .map(([lang, count]) => {
        const pct = Math.round((count / total) * 100);
        const color = lang === 'Other / None' ? '#71717a' : getLangColor(lang);
        const isActive = state.filters.language === lang;
        return `
          <button
            type="button"
            data-lang-filter="${escapeHtml(lang)}"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all border ${
              isActive
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-200 font-medium'
                : 'bg-zinc-50 dark:bg-[#242030] border-zinc-200/80 dark:border-white/[0.07] text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/[0.16]'
            }"
          >
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color};"></span>
            <span>${escapeHtml(lang)}</span>
            <span class="font-mono text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">${count} · ${pct}%</span>
          </button>
        `;
      })
      .join('');

    // Attach click handlers to bar segments & legend pills
    bar.querySelectorAll('[data-lang-filter]').forEach((el) => {
      el.addEventListener('click', () => {
        const lang = el.getAttribute('data-lang-filter');
        state.filters.language = state.filters.language === lang ? 'all' : lang;
        applyFiltersAndRender();
      });
    });
    legend.querySelectorAll('[data-lang-filter]').forEach((el) => {
      el.addEventListener('click', () => {
        const lang = el.getAttribute('data-lang-filter');
        state.filters.language = state.filters.language === lang ? 'all' : lang;
        applyFiltersAndRender();
      });
    });
  }

  function renderHealthAnalytics() {
    const buckets = [
      {
        key: 'active',
        label: 'Active',
        sub: '< 30 days',
        colorClass: 'bg-emerald-500',
        dotClass: 'bg-emerald-500',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        ringClass: 'border-emerald-500/50 bg-emerald-500/10',
        count: 0,
      },
      {
        key: 'recent',
        label: 'Recent',
        sub: '1–6 months',
        colorClass: 'bg-indigo-500',
        dotClass: 'bg-indigo-500',
        textClass: 'text-indigo-600 dark:text-indigo-400',
        ringClass: 'border-indigo-500/50 bg-indigo-500/10',
        count: 0,
      },
      {
        key: 'dormant',
        label: 'Dormant',
        sub: '> 6 months',
        colorClass: 'bg-amber-500',
        dotClass: 'bg-amber-500',
        textClass: 'text-amber-600 dark:text-amber-400',
        ringClass: 'border-amber-500/50 bg-amber-500/10',
        count: 0,
      },
      {
        key: 'archived',
        label: 'Archived',
        sub: 'Read-only',
        colorClass: 'bg-zinc-400 dark:bg-zinc-600',
        dotClass: 'bg-zinc-400 dark:bg-zinc-500',
        textClass: 'text-zinc-600 dark:text-zinc-400',
        ringClass: 'border-zinc-400/50 bg-zinc-500/10',
        count: 0,
      },
    ];

    const bucketMap = Object.fromEntries(buckets.map((b) => [b.key, b]));
    for (const repo of state.repos) {
      bucketMap[getRepoHealthBucket(repo)].count++;
    }

    const total = state.repos.length || 1;
    const bar = document.getElementById('healthBar');
    const grid = document.getElementById('healthBreakdownGrid');
    const clearBtn = document.getElementById('clearHealthFilterBtn');

    clearBtn.classList.toggle('hidden', state.filters.health === 'all');

    const nonEmpty = buckets.filter((b) => b.count > 0);
    if (nonEmpty.length === 0) {
      bar.innerHTML = `<div class="w-full h-full bg-zinc-200 dark:bg-zinc-800 rounded-full"></div>`;
    } else {
      bar.innerHTML = nonEmpty
        .map((b) => {
          const pct = (b.count / total) * 100;
          const dimmed = state.filters.health !== 'all' && state.filters.health !== b.key;
          return `
            <button
              type="button"
              data-health-filter="${b.key}"
              title="${b.label} (${b.sub}): ${b.count} repos (${pct.toFixed(1)}%)"
              style="width: ${Math.max(pct, 2)}%;"
              class="${b.colorClass} h-full first:rounded-l-full last:rounded-r-full transition-all duration-200 hover:brightness-110 cursor-pointer ${dimmed ? 'opacity-25' : 'opacity-100'}"
            ></button>
          `;
        })
        .join('');
    }

    grid.innerHTML = buckets
      .map((b) => {
        const pct = state.repos.length > 0 ? Math.round((b.count / total) * 100) : 0;
        const isActive = state.filters.health === b.key;
        return `
          <button
            type="button"
            data-health-filter="${b.key}"
            class="text-left p-2.5 rounded-lg border transition-all ${
              isActive
                ? b.ringClass
                : 'bg-zinc-50 dark:bg-[#242030] border-zinc-200/80 dark:border-white/[0.07] hover:border-zinc-300 dark:hover:border-white/[0.15]'
            }"
          >
            <div class="flex items-center justify-between gap-1">
              <span class="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                <span class="w-2 h-2 rounded-full ${b.dotClass}"></span>
                ${b.label}
              </span>
              <span class="text-[10px] font-mono text-zinc-400 tabular-nums">${pct}%</span>
            </div>
            <div class="mt-1.5 flex items-baseline justify-between">
              <span class="text-lg font-semibold tabular-nums ${isActive ? b.textClass : 'text-zinc-900 dark:text-zinc-100'}">${b.count}</span>
              <span class="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">${b.sub}</span>
            </div>
          </button>
        `;
      })
      .join('');

    [...bar.querySelectorAll('[data-health-filter]'), ...grid.querySelectorAll('[data-health-filter]')].forEach(
      (el) => {
        el.addEventListener('click', () => {
          const key = el.getAttribute('data-health-filter');
          state.filters.health = state.filters.health === key ? 'all' : key;
          applyFiltersAndRender();
        });
      }
    );
  }

  /* ===================================================================
   * 9. FILTERING, SORTING & REPOSITORY EXPLORER RENDERING
   * =================================================================== */
  function renderTypeFilterPills() {
    const repos = state.repos;
    const counts = {
      all: repos.length,
      original: repos.filter((r) => !r.fork).length,
      fork: repos.filter((r) => r.fork).length,
      archived: repos.filter((r) => r.archived).length,
      homepage: repos.filter((r) => Boolean(r.homepage && r.homepage.trim())).length,
      private: repos.filter((r) => r.private).length,
    };

    const pills = [
      { key: 'all', label: 'All', count: counts.all },
      { key: 'original', label: 'Original', count: counts.original },
      { key: 'fork', label: 'Forks', count: counts.fork },
      { key: 'archived', label: 'Archived', count: counts.archived },
      { key: 'homepage', label: 'Has Live Site', count: counts.homepage },
    ];

    if (counts.private > 0) {
      pills.push({ key: 'private', label: 'Private', count: counts.private });
    }

    const container = document.getElementById('typeFilterPills');
    container.innerHTML = pills
      .map((pill) => {
        const active = state.filters.type === pill.key;
        return `
          <button
            type="button"
            data-type-filter="${pill.key}"
            class="h-7 px-2.5 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5 border ${
              active
                ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100'
                : 'bg-zinc-100/70 dark:bg-[#242030] text-zinc-600 dark:text-zinc-300 border-zinc-200/80 dark:border-white/[0.07] hover:border-zinc-300 dark:hover:border-white/[0.15]'
            }"
          >
            <span>${pill.label}</span>
            <span class="font-mono text-[10px] tabular-nums ${active ? 'opacity-75' : 'text-zinc-400 dark:text-zinc-500'}">${pill.count}</span>
          </button>
        `;
      })
      .join('');

    container.querySelectorAll('[data-type-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.type = btn.getAttribute('data-type-filter');
        applyFiltersAndRender();
      });
    });
  }

  function renderActiveChips() {
    const chips = [];
    if (state.filters.language !== 'all') {
      chips.push({ label: `Language: ${state.filters.language}`, clear: () => (state.filters.language = 'all') });
    }
    if (state.filters.health !== 'all') {
      const map = { active: 'Active (<30d)', recent: 'Recent (1–6m)', dormant: 'Dormant (>6m)', archived: 'Archived' };
      chips.push({ label: `Health: ${map[state.filters.health]}`, clear: () => (state.filters.health = 'all') });
    }
    if (state.filters.topic) {
      chips.push({ label: `Topic: #${state.filters.topic}`, clear: () => (state.filters.topic = '') });
    }

    const row = document.getElementById('activeChipsRow');
    const hasAnyFilter =
      chips.length > 0 || state.filters.type !== 'all' || state.filters.search.trim().length > 0;
    document.getElementById('resetAllFiltersBtn').classList.toggle('hidden', !hasAnyFilter);

    if (chips.length === 0) {
      row.classList.add('hidden');
      row.classList.remove('flex');
      row.innerHTML = '';
      return;
    }

    row.classList.remove('hidden');
    row.classList.add('flex');
    row.innerHTML = chips
      .map(
        (chip, idx) => `
        <span class="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 rounded-md text-xs font-medium bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/25">
          <span>${escapeHtml(chip.label)}</span>
          <button type="button" data-clear-chip="${idx}" class="p-0.5 rounded hover:bg-indigo-500/20">
            <i data-lucide="x" class="w-3 h-3"></i>
          </button>
        </span>
      `
      )
      .join('');

    row.querySelectorAll('[data-clear-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-clear-chip'));
        chips[idx].clear();
        applyFiltersAndRender();
      });
    });
  }

  function computeFilteredRepos() {
    const q = state.filters.search.trim().toLowerCase();
    const { type, language, health, topic, sort } = state.filters;

    let list = state.repos.filter((repo) => {
      // Type filter
      if (type === 'original' && repo.fork) return false;
      if (type === 'fork' && !repo.fork) return false;
      if (type === 'archived' && !repo.archived) return false;
      if (type === 'homepage' && !(repo.homepage && repo.homepage.trim())) return false;
      if (type === 'private' && !repo.private) return false;

      // Language filter
      if (language !== 'all') {
        const repoLang = repo.language || 'Other / None';
        if (repoLang !== language) return false;
      }

      // Health filter
      if (health !== 'all' && getRepoHealthBucket(repo) !== health) return false;

      // Topic filter
      if (topic) {
        const topics = Array.isArray(repo.topics) ? repo.topics : [];
        if (!topics.includes(topic)) return false;
      }

      // Instant search query
      if (q) {
        const nameMatch = (repo.name || '').toLowerCase().includes(q);
        const descMatch = (repo.description || '').toLowerCase().includes(q);
        const langMatch = (repo.language || '').toLowerCase().includes(q);
        const topicMatch = (repo.topics || []).some((t) => t.toLowerCase().includes(q));
        if (!nameMatch && !descMatch && !langMatch && !topicMatch) return false;
      }

      return true;
    });

    // Sorting
    list.sort((a, b) => {
      switch (sort) {
        case 'stars':
          return (b.stargazers_count || 0) - (a.stargazers_count || 0);
        case 'forks':
          return (b.forks_count || 0) - (a.forks_count || 0);
        case 'issues':
          return (b.open_issues_count || 0) - (a.open_issues_count || 0);
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'size':
          return (b.size || 0) - (a.size || 0);
        case 'health':
          return (hook('healthScore', a) ?? 101) - (hook('healthScore', b) ?? 101);
        case 'pushed':
        default:
          return new Date(b.pushed_at || 0).getTime() - new Date(a.pushed_at || 0).getTime();
      }
    });

    state.filteredRepos = list;
  }

  function renderViewSwitcher() {
    const gridBtn = document.getElementById('viewGridBtn');
    const tableBtn = document.getElementById('viewTableBtn');
    const activeCls = 'bg-white dark:bg-[#322D40] text-zinc-900 dark:text-zinc-100 shadow-sm';
    const idleCls = 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200';

    gridBtn.className = `h-8 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
      state.viewMode === 'grid' ? activeCls : idleCls
    }`;
    tableBtn.className = `h-8 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
      state.viewMode === 'table' ? activeCls : idleCls
    }`;
  }

  function buildBadgesHtml(repo) {
    const badges = [];
    if (repo.private) {
      badges.push(
        `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25"><i data-lucide="lock" class="w-2.5 h-2.5"></i>Private</span>`
      );
    } else {
      badges.push(
        `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-100 dark:bg-white/[0.06] text-zinc-500 dark:text-zinc-400 border border-zinc-200/70 dark:border-white/[0.07]">Public</span>`
      );
    }
    if (repo.fork) {
      badges.push(
        `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-indigo-500/12 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">Fork</span>`
      );
    }
    if (repo.archived) {
      badges.push(
        `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300/70 dark:border-zinc-700">Archived</span>`
      );
    }
    return badges.join('');
  }

  function renderRepositoryExplorer() {
    const list = state.filteredRepos;
    const gridEl = document.getElementById('repoGridContainer');
    const tableWrapEl = document.getElementById('repoTableContainer');
    const tableBodyEl = document.getElementById('repoTableBody');
    const emptyEl = document.getElementById('emptyState');

    document.getElementById('filteredCountText').textContent = `Showing ${list.length} of ${state.repos.length}`;

    if (list.length === 0) {
      gridEl.classList.add('hidden');
      tableWrapEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      lucide.createIcons();
      return;
    }

    emptyEl.classList.add('hidden');

    if (state.viewMode === 'grid') {
      tableWrapEl.classList.add('hidden');
      gridEl.classList.remove('hidden');

      gridEl.innerHTML = list
        .map((repo, idx) => {
          const langColor = getLangColor(repo.language);
          const homepage = normalizeHomepageUrl(repo.homepage);
          const license = repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : '';
          const topics = Array.isArray(repo.topics) ? repo.topics : [];
          const visibleTopics = topics.slice(0, 4);
          const extraTopics = topics.length - visibleTopics.length;
          const health = getRepoHealthBucket(repo);
          const healthDot =
            health === 'active'
              ? 'bg-emerald-500'
              : health === 'recent'
              ? 'bg-indigo-500'
              : health === 'dormant'
              ? 'bg-amber-500'
              : 'bg-zinc-400';

          return `
            <article
              data-repo-idx="${idx}"
              class="repo-item group rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-white dark:bg-[#1B1823] hover:border-indigo-500/45 dark:hover:border-white/[0.18] hover:-translate-y-[1px] p-4 flex flex-col justify-between gap-3.5 transition-all duration-150 cursor-pointer"
            >
              <div class="space-y-2.5">
                <!-- Top Header: Name + Badges + Quick Actions -->
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 space-y-1.5">
                    <div class="flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full ${healthDot} shrink-0" title="Health: ${health}"></span>
                      <h3 class="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                        ${escapeHtml(repo.name)}
                      </h3>
                    </div>
                    <div class="flex flex-wrap items-center gap-1">
                      ${buildBadgesHtml(repo)}${hook('cardBadge', repo) || ''}
                    </div>
                  </div>

                  <!-- Quick Action Icon Buttons -->
                  <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                    ${
                      homepage
                        ? `<a href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer" title="Open Live Site" class="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-indigo-500 hover:bg-indigo-500/10 transition-colors"><i data-lucide="globe" class="w-3.5 h-3.5"></i></a>`
                        : ''
                    }
                    <button type="button" data-copy-clone="${idx}" title="Copy HTTPS Clone URL" class="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.08] transition-colors">
                      <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                    </button>
                    <a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer" title="Open on GitHub" class="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.08] transition-colors">
                      <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                    </a>
                  </div>
                </div>

                <!-- Description -->
                <p class="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 line-clamp-2 min-h-[32px]">
                  ${repo.description ? escapeHtml(repo.description) : '<span class="italic opacity-60">No description provided.</span>'}
                </p>

                <!-- Topics -->
                ${
                  visibleTopics.length > 0
                    ? `<div class="flex flex-wrap items-center gap-1 pt-0.5" onclick="event.stopPropagation()">
                        ${visibleTopics
                          .map(
                            (t) => `
                          <button
                            type="button"
                            data-topic-click="${escapeHtml(t)}"
                            class="px-2 py-0.5 rounded-md text-[10px] font-mono transition-colors border ${
                              state.filters.topic === t
                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-700 dark:text-indigo-200'
                                : 'bg-zinc-100/80 dark:bg-[#242030] border-zinc-200/70 dark:border-white/[0.06] text-zinc-600 dark:text-zinc-400 hover:border-indigo-500/40 hover:text-indigo-600 dark:hover:text-indigo-300'
                            }"
                          >${escapeHtml(t)}</button>
                        `
                          )
                          .join('')}
                        ${extraTopics > 0 ? `<span class="text-[10px] font-mono text-zinc-400 px-1">+${extraTopics}</span>` : ''}
                      </div>`
                    : ''
                }
              </div>

              <!-- Bottom Metadata Footer -->
              <div class="pt-3 border-t border-zinc-100 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  ${
                    repo.language
                      ? `<span class="inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
                          <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${langColor};"></span>
                          <span>${escapeHtml(repo.language)}</span>
                        </span>`
                      : ''
                  }
                  <span class="inline-flex items-center gap-1 tabular-nums" title="Stars">
                    <i data-lucide="star" class="w-3 h-3 text-amber-500/80"></i>
                    ${formatNumber(repo.stargazers_count || 0)}
                  </span>
                  <span class="inline-flex items-center gap-1 tabular-nums" title="Forks">
                    <i data-lucide="git-fork" class="w-3 h-3"></i>
                    ${formatNumber(repo.forks_count || 0)}
                  </span>
                  ${
                    (repo.open_issues_count || 0) > 0
                      ? `<span class="inline-flex items-center gap-1 tabular-nums" title="Open Issues">
                          <i data-lucide="circle-dot" class="w-3 h-3 text-rose-500/80"></i>
                          ${formatNumber(repo.open_issues_count)}
                        </span>`
                      : ''
                  }
                </div>

                <div class="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                  ${license ? `<span title="License">${escapeHtml(license)}</span><span>·</span>` : ''}
                  <span title="Repository Size">${formatSizeKB(repo.size)}</span>
                  <span>·</span>
                  <span title="Last Pushed: ${formatShortDate(repo.pushed_at)}">${formatRelativeTime(repo.pushed_at)}</span>
                </div>
              </div>
            </article>
          `;
        })
        .join('');
    } else {
      // High-Density Data Table View
      gridEl.classList.add('hidden');
      tableWrapEl.classList.remove('hidden');

      tableBodyEl.innerHTML = list
        .map((repo, idx) => {
          const langColor = getLangColor(repo.language);
          const homepage = normalizeHomepageUrl(repo.homepage);
          const license = repo.license && repo.license.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : '';
          const topics = (repo.topics || []).slice(0, 3);

          return `
            <tr
              data-repo-idx="${idx}"
              class="repo-item group hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
            >
              <td class="py-3 px-4 max-w-md">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-semibold text-sm text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    ${escapeHtml(repo.name)}
                  </span>
                  ${buildBadgesHtml(repo)}${hook('cardBadge', repo) || ''}
                  ${license ? `<span class="text-[10px] font-mono text-zinc-400">${escapeHtml(license)}</span>` : ''}
                </div>
                ${
                  repo.description
                    ? `<p class="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">${escapeHtml(repo.description)}</p>`
                    : ''
                }
                ${
                  topics.length > 0
                    ? `<div class="flex flex-wrap gap-1 mt-1" onclick="event.stopPropagation()">
                        ${topics
                          .map(
                            (t) =>
                              `<button type="button" data-topic-click="${escapeHtml(t)}" class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-100 dark:bg-[#242030] text-zinc-500 dark:text-zinc-400 hover:text-indigo-500">${escapeHtml(t)}</button>`
                          )
                          .join('')}
                      </div>`
                    : ''
                }
              </td>
              <td class="py-3 px-3 whitespace-nowrap">
                ${
                  repo.language
                    ? `<span class="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-700 dark:text-zinc-300">
                        <span class="w-2 h-2 rounded-full" style="background-color: ${langColor};"></span>
                        ${escapeHtml(repo.language)}
                      </span>`
                    : `<span class="text-xs font-mono text-zinc-400">—</span>`
                }
              </td>
              <td class="py-3 px-3 text-right font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">${formatNumber(repo.stargazers_count || 0)}</td>
              <td class="py-3 px-3 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">${formatNumber(repo.forks_count || 0)}</td>
              <td class="py-3 px-3 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">${formatNumber(repo.open_issues_count || 0)}</td>
              <td class="py-3 px-3 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap">${formatSizeKB(repo.size)}</td>
              <td class="py-3 px-3 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400 whitespace-nowrap" title="${formatShortDate(repo.pushed_at)}">${formatRelativeTime(repo.pushed_at)}</td>
              <td class="py-3 px-4 text-right whitespace-nowrap" onclick="event.stopPropagation()">
                <div class="inline-flex items-center justify-end gap-1">
                  ${
                    homepage
                      ? `<a href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer" title="Live Site" class="p-1.5 rounded-lg text-zinc-400 hover:text-indigo-500 hover:bg-indigo-500/10"><i data-lucide="globe" class="w-3.5 h-3.5"></i></a>`
                      : ''
                  }
                  <button type="button" data-copy-clone="${idx}" title="Copy Clone URL" class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.08]">
                    <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                  </button>
                  <a href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer" title="Open on GitHub" class="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.08]">
                    <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                  </a>
                </div>
              </td>
            </tr>
          `;
        })
        .join('');
    }

    // Bind card/row click -> Open Inspector Drawer
    document.querySelectorAll('.repo-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.getAttribute('data-repo-idx'));
        const repo = state.filteredRepos[idx];
        if (repo) openInspectorDrawer(repo);
      });
    });

    // Bind quick-copy clone URL
    document.querySelectorAll('[data-copy-clone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-copy-clone'));
        const repo = state.filteredRepos[idx];
        if (repo) {
          const url = repo.clone_url || `${repo.html_url}.git`;
          copyToClipboard(url, `Copied clone URL for ${repo.name}`);
        }
      });
    });

    // Bind clickable topic filters
    document.querySelectorAll('[data-topic-click]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const topic = btn.getAttribute('data-topic-click');
        state.filters.topic = state.filters.topic === topic ? '' : topic;
        applyFiltersAndRender();
      });
    });

    lucide.createIcons();
  }

  function applyFiltersAndRender() {
    computeFilteredRepos();
    renderLanguageAnalytics();
    renderHealthAnalytics();
    renderTypeFilterPills();
    renderActiveChips();
    renderViewSwitcher();
    renderRepositoryExplorer();
    lucide.createIcons();
  }

  function hook(name, ...args) {
    const fn = window.RPHooks && window.RPHooks[name];
    return typeof fn === 'function' ? fn(...args) : undefined;
  }

  function renderAll() {
    renderDemoBanner();
    renderRateLimitBadge();
    renderAuthButtonState();
    renderProfile();
    renderKPIs();
    applyFiltersAndRender();
    hook('onData');
  }

  function resetFilters(shouldRender = true) {
    state.filters = {
      search: '',
      type: 'all',
      language: 'all',
      health: 'all',
      topic: '',
      sort: 'pushed',
    };
    document.getElementById('repoSearchInput').value = '';
    document.getElementById('clearSearchBtn').classList.add('hidden');
    document.getElementById('sortSelect').value = 'pushed';
    if (shouldRender) applyFiltersAndRender();
  }

  /* ===================================================================
   * 10. SLIDE-OVER REPOSITORY INSPECTOR DRAWER
   * =================================================================== */
  function getCloneCommand(repo, mode) {
    const httpsUrl = repo.clone_url || `${repo.html_url}.git`;
    const sshUrl = repo.ssh_url || `git@github.com:${repo.full_name}.git`;
    if (mode === 'ssh') return `git clone ${sshUrl}`;
    if (mode === 'cli') return `gh repo clone ${repo.full_name}`;
    return `git clone ${httpsUrl}`;
  }

  function renderCloneTabs() {
    const repo = state.activeDrawerRepo;
    if (!repo) return;
    document.getElementById('drawerCloneCmd').textContent = getCloneCommand(repo, state.cloneMode);
    document.querySelectorAll('.clone-tab-btn').forEach((btn) => {
      const active = btn.getAttribute('data-clone-mode') === state.cloneMode;
      btn.className = `clone-tab-btn px-2 py-0.5 rounded-md text-[11px] font-mono font-medium transition-colors ${
        active
          ? 'bg-white dark:bg-[#322D40] text-zinc-900 dark:text-zinc-100 shadow-sm'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
      }`;
    });
  }

  async function openInspectorDrawer(repo) {
    state.activeDrawerRepo = repo;
    const root = document.getElementById('inspectorDrawerRoot');
    const backdrop = document.getElementById('drawerBackdrop');
    const panel = document.getElementById('drawerPanel');

    // Populate immediate static metadata
    document.getElementById('drawerRepoName').textContent = repo.name;
    document.getElementById('drawerBadges').innerHTML = buildBadgesHtml(repo);
    document.getElementById('drawerRepoDesc').textContent = repo.description || 'No repository description provided.';
    document.getElementById('drawerGithubLink').href = repo.html_url;

    const homepage = normalizeHomepageUrl(repo.homepage);
    const homepageEl = document.getElementById('drawerHomepageLink');
    if (homepage) {
      homepageEl.href = homepage;
      homepageEl.classList.remove('hidden');
    } else {
      homepageEl.classList.add('hidden');
    }

    // Topics
    const topicsEl = document.getElementById('drawerTopics');
    const topics = Array.isArray(repo.topics) ? repo.topics : [];
    topicsEl.innerHTML = topics
      .map(
        (t) =>
          `<span class="px-2 py-0.5 rounded-md text-[11px] font-mono bg-zinc-100 dark:bg-[#242030] border border-zinc-200 dark:border-white/[0.08] text-zinc-600 dark:text-zinc-300">#${escapeHtml(t)}</span>`
      )
      .join('');

    // Clone command
    renderCloneTabs();

    // Metadata Grid
    const license = repo.license && repo.license.name && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id || repo.license.name : 'None';
    const metaItems = [
      { label: 'Created', value: formatShortDate(repo.created_at), icon: 'calendar-plus' },
      { label: 'Last Push', value: `${formatRelativeTime(repo.pushed_at)}`, sub: formatShortDate(repo.pushed_at), icon: 'clock' },
      { label: 'Default Branch', value: repo.default_branch || 'main', icon: 'git-branch' },
      { label: 'License', value: license, icon: 'scale' },
      { label: 'Size', value: formatSizeKB(repo.size), icon: 'hard-drive' },
      { label: 'Stars', value: formatNumber(repo.stargazers_count || 0), icon: 'star' },
      { label: 'Watchers', value: formatNumber(repo.watchers_count || 0), icon: 'eye' },
      { label: 'Forks', value: formatNumber(repo.forks_count || 0), icon: 'git-fork' },
      { label: 'Open Issues', value: formatNumber(repo.open_issues_count || 0), icon: 'circle-dot' },
    ];

    document.getElementById('drawerMetadataGrid').innerHTML = metaItems
      .map(
        (m) => `
        <div class="rounded-lg border border-zinc-200/80 dark:border-white/[0.07] bg-zinc-50/70 dark:bg-[#242030]/60 p-2.5">
          <div class="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
            <i data-lucide="${m.icon}" class="w-3 h-3"></i>
            <span>${m.label}</span>
          </div>
          <div class="text-xs sm:text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100 mt-1 truncate tabular-nums" title="${escapeHtml(m.sub || m.value)}">
            ${escapeHtml(m.value)}
          </div>
        </div>
      `
      )
      .join('');

    // Show drawer with smooth animation
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overflow-hidden');
    lucide.createIcons();

    requestAnimationFrame(() => {
      backdrop.classList.remove('opacity-0');
      panel.classList.remove('translate-x-full');
    });

    hook('onDrawer', repo);

    // Load on-demand details (languages, commits, README)
    await loadInspectorDetails(repo);
  }

  function closeInspectorDrawer() {
    const root = document.getElementById('inspectorDrawerRoot');
    const backdrop = document.getElementById('drawerBackdrop');
    const panel = document.getElementById('drawerPanel');

    backdrop.classList.add('opacity-0');
    panel.classList.add('translate-x-full');

    setTimeout(() => {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('overflow-hidden');
      state.activeDrawerRepo = null;
    }, 260);
  }

  async function loadInspectorDetails(repo) {
    const langContainer = document.getElementById('drawerLangContent');
    const langTotal = document.getElementById('drawerLangTotal');
    const commitsContainer = document.getElementById('drawerCommitsContent');
    const readmeContainer = document.getElementById('drawerReadmeContent');
    const readmeFilename = document.getElementById('drawerReadmeFilename');

    const spinnerHtml = `<div class="flex items-center gap-2 text-xs font-mono text-zinc-500 py-2"><i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-indigo-500"></i><span>Loading from GitHub API...</span></div>`;
    langTotal.textContent = '';
    langContainer.innerHTML = spinnerHtml;
    commitsContainer.innerHTML = spinnerHtml;
    readmeContainer.innerHTML = spinnerHtml;
    readmeFilename.textContent = 'README.md';
    lucide.createIcons();

    // Check in-memory cache first
    if (state.inspectorCache.has(repo.full_name)) {
      const cached = state.inspectorCache.get(repo.full_name);
      renderInspectorDetails(repo, cached);
      return;
    }

    // Demo mode uses realistic mock payloads
    if (state.mode === 'demo') {
      const mockData = {
        languages: repo._demoLanguages || {},
        commits: (repo._demoCommits || []).map((c) => ({
          sha: c.sha,
          html_url: repo.html_url,
          commit: {
            message: c.message,
            author: { name: c.author, date: c.date },
          },
        })),
        readme: {
          name: 'README.md',
          markdown: repo._demoReadme || `# ${repo.name}\n\n${repo.description || ''}`,
        },
      };
      state.inspectorCache.set(repo.full_name, mockData);
      if (state.activeDrawerRepo && state.activeDrawerRepo.full_name === repo.full_name) {
        renderInspectorDetails(repo, mockData);
      }
      return;
    }

    // Live GitHub API parallel fetch for languages, last 5 commits, and README
    const base = `https://api.github.com/repos/${repo.full_name}`;
    try {
      // The cockpit query already holds languages and recent commits; only the README needs a call.
      const pre = hook('prefill', repo);
      const [langRes, commitsRes, readmeRes] = await Promise.all([
        pre ? null : githubFetch(`${base}/languages`).catch(() => null),
        pre && pre.commits.length ? null : githubFetch(`${base}/commits?per_page=5`).catch(() => null),
        githubFetch(`${base}/readme`).catch(() => null),
      ]);

      const languages = pre ? pre.languages : langRes && langRes.ok ? await langRes.json() : null;
      const commits = pre && pre.commits.length ? pre.commits : commitsRes && commitsRes.ok ? await commitsRes.json() : null;

      let readme = null;
      if (readmeRes && readmeRes.ok) {
        const rdJson = await readmeRes.json();
        if (rdJson && rdJson.content) {
          readme = {
            name: rdJson.name || 'README.md',
            markdown: decodeBase64UTF8(rdJson.content),
          };
        }
      }

      const payload = { languages, commits, readme };
      state.inspectorCache.set(repo.full_name, payload);

      // Ensure user hasn't switched to a different repo drawer while awaiting
      if (state.activeDrawerRepo && state.activeDrawerRepo.full_name === repo.full_name) {
        renderInspectorDetails(repo, payload);
      }
    } catch (err) {
      console.error('Inspector fetch error:', err);
      if (state.activeDrawerRepo && state.activeDrawerRepo.full_name === repo.full_name) {
        langContainer.innerHTML = `<p class="text-xs text-zinc-500">Unable to load language breakdown.</p>`;
        commitsContainer.innerHTML = `<p class="text-xs text-zinc-500">Unable to load commit history.</p>`;
        readmeContainer.innerHTML = `<p class="text-xs text-zinc-500">Unable to load README preview.</p>`;
      }
    }
  }

  function renderInspectorDetails(repo, data) {
    const langContainer = document.getElementById('drawerLangContent');
    const langTotal = document.getElementById('drawerLangTotal');
    const commitsContainer = document.getElementById('drawerCommitsContent');
    const readmeContainer = document.getElementById('drawerReadmeContent');
    const readmeFilename = document.getElementById('drawerReadmeFilename');

    // 1. Exact Byte-Level Language Breakdown
    const entries = data.languages ? Object.entries(data.languages).sort((a, b) => b[1] - a[1]) : [];
    const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);

    if (entries.length === 0 || totalBytes === 0) {
      langTotal.textContent = '';
      langContainer.innerHTML = `<p class="text-xs text-zinc-500 dark:text-zinc-400">No source code language bytes detected.</p>`;
    } else {
      langTotal.textContent = formatBytes(totalBytes);
      const barHtml = entries
        .map(([lang, bytes]) => {
          const pct = (bytes / totalBytes) * 100;
          return `<div title="${escapeHtml(lang)}: ${pct.toFixed(1)}% (${formatBytes(bytes)})" style="width:${Math.max(pct, 1)}%;background-color:${getLangColor(lang)};" class="h-full first:rounded-l-full last:rounded-r-full"></div>`;
        })
        .join('');

      const pillsHtml = entries
        .map(([lang, bytes]) => {
          const pct = (bytes / totalBytes) * 100;
          return `
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="inline-flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color:${getLangColor(lang)};"></span>
                <span>${escapeHtml(lang)}</span>
              </span>
              <span class="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">${pct.toFixed(1)}% · ${formatBytes(bytes)}</span>
            </div>
          `;
        })
        .join('');

      langContainer.innerHTML = `
        <div class="w-full h-2.5 rounded-full overflow-hidden flex gap-[2px] bg-zinc-200 dark:bg-[#14121A]">${barHtml}</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5 pt-1">${pillsHtml}</div>
      `;
    }

    // 2. Last 5 Commits
    if (!Array.isArray(data.commits) || data.commits.length === 0) {
      commitsContainer.innerHTML = `<p class="text-xs text-zinc-500 dark:text-zinc-400">No recent commits available (repository may be empty or rate-limited).</p>`;
    } else {
      commitsContainer.innerHTML = data.commits
        .slice(0, 5)
        .map((c) => {
          const headline = (c.commit?.message || 'No commit message').split('\n')[0];
          const author = c.commit?.author?.name || c.author?.login || 'Unknown';
          const date = c.commit?.author?.date || c.commit?.committer?.date;
          const shortSha = (c.sha || '').slice(0, 7);
          const commitUrl = c.html_url || repo.html_url;

          return `
            <div class="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-white dark:bg-[#1B1823] border border-zinc-200/70 dark:border-white/[0.06]">
              <div class="min-w-0">
                <p class="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate" title="${escapeHtml(headline)}">${escapeHtml(headline)}</p>
                <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  <span>${escapeHtml(author)}</span> · <span class="font-mono">${formatRelativeTime(date)}</span>
                </p>
              </div>
              <a
                href="${escapeHtml(commitUrl)}"
                target="_blank"
                rel="noopener noreferrer"
                class="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-100 hover:bg-indigo-500/15 dark:bg-white/[0.06] dark:hover:bg-indigo-500/20 text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors shrink-0"
              >${escapeHtml(shortSha)}</a>
            </div>
          `;
        })
        .join('');
    }

    // 3. Rendered README Preview
    if (!data.readme || !data.readme.markdown) {
      readmeFilename.textContent = 'README.md';
      readmeContainer.innerHTML = `<p class="text-xs text-zinc-500 dark:text-zinc-400 italic">No README.md found in this repository.</p>`;
    } else {
      readmeFilename.textContent = data.readme.name || 'README.md';
      try {
        const rawHtml = typeof marked !== 'undefined'
          ? marked.parse(data.readme.markdown, { gfm: true, breaks: false })
          : `<pre>${escapeHtml(data.readme.markdown)}</pre>`;

        const cleanHtml = typeof DOMPurify !== 'undefined'
          ? DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } })
          : rawHtml.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

        readmeContainer.innerHTML = cleanHtml;

        // Ensure README links open safely in a new tab & images handle errors gracefully
        readmeContainer.querySelectorAll('a').forEach((a) => {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        });
        readmeContainer.querySelectorAll('img').forEach((img) => {
          img.setAttribute('loading', 'lazy');
          img.onerror = () => {
            img.style.display = 'none';
          };
        });
      } catch (err) {
        console.error('Markdown parse error:', err);
        readmeContainer.innerHTML = `<pre class="text-xs font-mono whitespace-pre-wrap">${escapeHtml(data.readme.markdown)}</pre>`;
      }
    }

    lucide.createIcons();
  }

  /* ===================================================================
   * 11. EXPORT FILTERED LIST (CSV / JSON)
   * =================================================================== */
  function triggerFileDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFilteredAsCSV() {
    const rows = state.filteredRepos;
    if (rows.length === 0) {
      showToast('No repositories to export', 'error');
      return;
    }
    const headers = [
      'Name',
      'Full Name',
      'Visibility',
      'Fork',
      'Archived',
      'Language',
      'Stars',
      'Forks',
      'Open Issues',
      'Size (KB)',
      'License',
      'Last Pushed',
      'Homepage',
      'GitHub URL',
      'Topics',
      'Description',
    ];
    const csvEscape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.map(csvEscape).join(',')];

    for (const r of rows) {
      lines.push(
        [
          r.name,
          r.full_name,
          r.private ? 'Private' : 'Public',
          r.fork ? 'Yes' : 'No',
          r.archived ? 'Yes' : 'No',
          r.language || '',
          r.stargazers_count || 0,
          r.forks_count || 0,
          r.open_issues_count || 0,
          r.size || 0,
          r.license?.spdx_id || '',
          r.pushed_at || '',
          r.homepage || '',
          r.html_url || '',
          (r.topics || []).join('; '),
          r.description || '',
        ]
          .map(csvEscape)
          .join(',')
      );
    }

    const safeUser = (state.profile?.login || 'github').replace(/[^a-z0-9_-]/gi, '');
    triggerFileDownload(`${safeUser}-repos.csv`, lines.join('\n'), 'text/csv;charset=utf-8;');
    showToast(`Exported ${rows.length} repositories as CSV`, 'success');
  }

  function exportFilteredAsJSON() {
    const rows = state.filteredRepos;
    if (rows.length === 0) {
      showToast('No repositories to export', 'error');
      return;
    }
    const cleanData = rows.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      visibility: r.private ? 'private' : 'public',
      fork: Boolean(r.fork),
      archived: Boolean(r.archived),
      language: r.language || null,
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      open_issues: r.open_issues_count || 0,
      size_kb: r.size || 0,
      license: r.license?.spdx_id || null,
      topics: r.topics || [],
      homepage: r.homepage || null,
      html_url: r.html_url,
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      description: r.description || null,
    }));

    const safeUser = (state.profile?.login || 'github').replace(/[^a-z0-9_-]/gi, '');
    triggerFileDownload(`${safeUser}-repos.json`, JSON.stringify(cleanData, null, 2), 'application/json');
    showToast(`Exported ${rows.length} repositories as JSON`, 'success');
  }

  /* ===================================================================
   * 12. THEME & AUTH MODAL MANAGEMENT
   * =================================================================== */
  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME);
    const isDark = saved ? saved === 'dark' : true; // Dark-first default
    document.documentElement.classList.toggle('dark', isDark);
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
    lucide.createIcons();
  }

  function openAuthModal() {
    const root = document.getElementById('authModalRoot');
    const input = document.getElementById('patInput');
    const status = document.getElementById('authTokenStatusMsg');
    input.value = state.token || '';
    input.type = 'password';
    status.textContent = state.authenticatedUser
      ? `Currently authenticated as @${state.authenticatedUser}`
      : state.token
      ? 'Token configured'
      : '';
    root.classList.remove('hidden');
    root.classList.add('flex');
    lucide.createIcons();
    setTimeout(() => input.focus(), 50);
  }

  function closeAuthModal() {
    const root = document.getElementById('authModalRoot');
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  /* ===================================================================
   * 13. EVENT LISTENERS & INITIALIZATION
   * =================================================================== */
  function bindEvents() {
    // Connect username form
    document.getElementById('usernameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('usernameInput').value.trim();
      if (val) {
        fetchLiveUserAndRepos(val);
      } else if (state.authenticatedUser) {
        fetchLiveUserAndRepos(state.authenticatedUser);
      } else {
        showToast('Enter a GitHub username to load repositories', 'info');
      }
    });

    // Quick-load demo account buttons
    document.querySelectorAll('.quick-load-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = btn.getAttribute('data-quick-user');
        document.getElementById('usernameInput').value = user;
        fetchLiveUserAndRepos(user);
      });
    });

    // Dismiss demo banner
    document.getElementById('dismissDemoBannerBtn').addEventListener('click', () => {
      sessionStorage.setItem(STORAGE_KEYS.DEMO_BANNER_DISMISSED, '1');
      document.getElementById('demoBanner').classList.add('hidden');
    });

    // Error banner actions
    document.getElementById('errorOpenAuthBtn').addEventListener('click', openAuthModal);
    document.getElementById('errorLoadDemoBtn').addEventListener('click', () => loadDemoMode(true));

    // Refresh button
    document.getElementById('refreshDataBtn').addEventListener('click', () => {
      if (state.mode === 'live' && state.username) {
        fetchLiveUserAndRepos(state.username);
      } else {
        loadDemoMode(true);
      }
    });

    // Theme toggle
    document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

    // Search input
    const searchInput = document.getElementById('repoSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    searchInput.addEventListener('input', (e) => {
      state.filters.search = e.target.value;
      clearSearchBtn.classList.toggle('hidden', !e.target.value);
      applyFiltersAndRender();
    });
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.filters.search = '';
      clearSearchBtn.classList.add('hidden');
      applyFiltersAndRender();
      searchInput.focus();
    });

    // Language dropdown
    document.getElementById('languageSelect').addEventListener('change', (e) => {
      state.filters.language = e.target.value;
      applyFiltersAndRender();
    });

    // Sort dropdown
    document.getElementById('sortSelect').addEventListener('change', (e) => {
      state.filters.sort = e.target.value;
      applyFiltersAndRender();
    });

    // Clear health filter button
    document.getElementById('clearHealthFilterBtn').addEventListener('click', () => {
      state.filters.health = 'all';
      applyFiltersAndRender();
    });

    // View switcher
    document.getElementById('viewGridBtn').addEventListener('click', () => {
      state.viewMode = 'grid';
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, 'grid');
      renderViewSwitcher();
      renderRepositoryExplorer();
    });
    document.getElementById('viewTableBtn').addEventListener('click', () => {
      state.viewMode = 'table';
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, 'table');
      renderViewSwitcher();
      renderRepositoryExplorer();
    });

    // Reset filters
    document.getElementById('resetAllFiltersBtn').addEventListener('click', () => resetFilters(true));
    document.getElementById('emptyResetBtn').addEventListener('click', () => resetFilters(true));

    // Export dropdown menu
    const exportBtn = document.getElementById('exportMenuBtn');
    const exportDropdown = document.getElementById('exportDropdown');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      exportDropdown.classList.add('hidden');
    });
    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      exportDropdown.classList.add('hidden');
      exportFilteredAsCSV();
    });
    document.getElementById('exportJsonBtn').addEventListener('click', () => {
      exportDropdown.classList.add('hidden');
      exportFilteredAsJSON();
    });

    // Drawer controls
    document.getElementById('closeDrawerBtn').addEventListener('click', closeInspectorDrawer);
    document.getElementById('drawerBackdrop').addEventListener('click', closeInspectorDrawer);

    document.querySelectorAll('.clone-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.cloneMode = btn.getAttribute('data-clone-mode');
        renderCloneTabs();
      });
    });

    document.getElementById('drawerCopyCloneBtn').addEventListener('click', () => {
      if (!state.activeDrawerRepo) return;
      const cmd = getCloneCommand(state.activeDrawerRepo, state.cloneMode);
      copyToClipboard(cmd, `Copied ${state.cloneMode.toUpperCase()} clone command`);
    });

    // Auth PAT Modal
    document.getElementById('openAuthModalBtn').addEventListener('click', openAuthModal);
    document.getElementById('closeAuthModalBtn').addEventListener('click', closeAuthModal);
    document.getElementById('cancelAuthModalBtn').addEventListener('click', closeAuthModal);
    document.getElementById('authModalBackdrop').addEventListener('click', closeAuthModal);

    document.getElementById('togglePatVisibilityBtn').addEventListener('click', () => {
      const input = document.getElementById('patInput');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('clearPatBtn').addEventListener('click', () => {
      state.token = '';
      state.authenticatedUser = null;
      state.includesPrivate = false;
      localStorage.removeItem(STORAGE_KEYS.PAT);
      sessionStorage.removeItem(STORAGE_KEYS.PAT);
      renderAuthButtonState();
      closeAuthModal();
      showToast('GitHub token removed', 'info');
      if (state.mode === 'live' && state.username) {
        fetchLiveUserAndRepos(state.username);
      }
    });

    document.getElementById('authModalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('patInput').value.trim();
      const persist = document.getElementById('patPersistCheckbox').checked;
      const statusEl = document.getElementById('authTokenStatusMsg');
      const saveBtn = document.getElementById('savePatBtn');

      if (!token) {
        statusEl.textContent = 'Please paste a valid GitHub Personal Access Token.';
        statusEl.className = 'text-[11px] font-mono text-rose-500 min-h-[16px]';
        return;
      }

      saveBtn.disabled = true;
      statusEl.textContent = 'Verifying token with api.github.com...';
      statusEl.className = 'text-[11px] font-mono text-indigo-500 min-h-[16px]';

      const result = await verifyToken(token);
      saveBtn.disabled = false;

      if (!result.ok) {
        statusEl.textContent =
          result.status === 401
            ? 'Invalid or expired token (401 Unauthorized).'
            : 'Could not verify token. Check your network connection.';
        statusEl.className = 'text-[11px] font-mono text-rose-500 min-h-[16px]';
        return;
      }

      state.token = token;
      if (persist) {
        localStorage.setItem(STORAGE_KEYS.PAT, token);
        sessionStorage.removeItem(STORAGE_KEYS.PAT);
      } else {
        sessionStorage.setItem(STORAGE_KEYS.PAT, token);
        localStorage.removeItem(STORAGE_KEYS.PAT);
      }

      renderAuthButtonState();
      closeAuthModal();
      showToast(`Token verified for @${result.login} (5,000 req/hr)`, 'success');

      // Automatically load the authenticated user's repos (including private) or reload current live user
      const targetUser = state.mode === 'live' && state.username ? state.username : result.login;
      document.getElementById('usernameInput').value = targetUser;
      fetchLiveUserAndRepos(targetUser);
    });

    // Keyboard shortcuts: "/" focuses search, "Escape" closes drawer/modal
    document.addEventListener('keydown', (e) => {
      if (hook('onKey', e)) return;
      if (e.key === 'Escape') {
        if (!document.getElementById('authModalRoot').classList.contains('hidden')) {
          closeAuthModal();
          return;
        }
        if (!document.getElementById('inspectorDrawerRoot').classList.contains('hidden')) {
          closeInspectorDrawer();
          return;
        }
      }
      if (
        e.key === '/' &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA' &&
        document.activeElement.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        hook('showView', 'repos');
        searchInput.focus();
      }
    });
  }

  async function bootstrap() {
    initTheme();
    bindEvents();

    // Keep the sticky filter bar clear of the header, whatever height it wraps to.
    const headerEl = document.querySelector('header');
    const setHeaderH = () => document.documentElement.style.setProperty('--header-h', `${headerEl.offsetHeight}px`);
    setHeaderH();
    if (window.ResizeObserver) new ResizeObserver(setHeaderH).observe(headerEl);

    // Restore saved PAT if present
    const savedToken = sessionStorage.getItem(STORAGE_KEYS.PAT) || localStorage.getItem(STORAGE_KEYS.PAT);
    if (savedToken) {
      state.token = savedToken;
      renderAuthButtonState();
    }

    hook('onBoot');

    // ?user= wins, then the last loaded username, then sample data
    const params = new URLSearchParams(location.search);
    const startUser = (params.get('user') || localStorage.getItem(STORAGE_KEYS.USERNAME) || '').trim();
    if (startUser) {
      document.getElementById('usernameInput').value = startUser;
      const painted = restoreSnapshot(startUser);
      await fetchLiveUserAndRepos(startUser, { quiet: painted });
    } else {
      loadDemoMode(false);
    }

    lucide.createIcons();

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered:', err));
    }
  }

  window.RP = {
    state,
    STORAGE_KEYS,
    escapeHtml,
    formatNumber,
    formatRelativeTime,
    formatShortDate,
    getLangColor,
    getRepoHealthBucket,
    showToast,
    githubFetch,
    getApiHeaders,
    openInspectorDrawer,
    closeInspectorDrawer,
    openAuthModal,
    fetchLiveUserAndRepos,
    loadDemoMode,
    toggleTheme,
    exportFilteredAsCSV,
    exportFilteredAsJSON,
    applyFiltersAndRender,
    copyToClipboard,
  };

  window.addEventListener('DOMContentLoaded', bootstrap);
})();
