/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tv: {
          bg: '#0b0e11',
          panel: '#131722',
          panel2: '#1a1e2a',
          border: '#1e222d',
          text: '#d1d4dc',
          textDim: '#787b86',
          green: '#26a69a',
          red: '#ef5350',
          accent: '#2962ff',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
