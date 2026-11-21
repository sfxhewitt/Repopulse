/** RepoPulse palette: chart-recorder paper, ink, and one cobalt accent. */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './js/*.js'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Neutrals carry a little aubergine so the page never reads as plain grey.
        zinc: {
          50: '#FBF7F4', 100: '#F3EEEC', 200: '#E6DFDE', 300: '#D2C9CB', 400: '#A39AA3',
          500: '#766E7A', 600: '#57505C', 700: '#3D3745', 800: '#2A2532', 900: '#1B1722', 950: '#14121A',
        },
        // The accent. Named indigo so the original markup picks it up unchanged.
        indigo: {
          50: '#EEF1FF', 100: '#DFE5FF', 200: '#C3CDFF', 300: '#9DABFF', 400: '#7284FF',
          500: '#4A5EFB', 600: '#2F43EE', 700: '#2433CC', 800: '#1F2CA3', 900: '#1E2A80',
        },
        grid: { light: '#F1CFCF', dark: '#3A2230' },
      },
      borderRadius: { lg: '5px', xl: '7px', '2xl': '10px' },
    },
  },
};
