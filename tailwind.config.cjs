/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './index.tsx',
    './app/**/*.{js,ts,jsx,tsx}',
    './editor/**/*.{js,ts,jsx,tsx}',
    './engine/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        panel: 'rgba(30, 30, 30, 0.90)',
        'panel-header': 'rgba(40, 40, 40, 0.95)',
        'panel-border': 'rgba(255, 255, 255, 0.08)',
        accent: '#4f80f8',
        'accent-hover': '#3b6ccf',
        'input-bg': 'rgba(0, 0, 0, 0.3)',
        'text-primary': '#e0e0e0',
        'text-secondary': '#909090',
      },
    },
  },
  plugins: [],
};
