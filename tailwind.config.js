/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      colors: {
        ink: { 950: '#050608', 900: '#0a0c10', 850: '#0f1217', 800: '#14181f', 700: '#1c212a', 600: '#272d38', 500: '#3a4250' },
        mist: { 50: '#f5f7fa', 100: '#e7ebf1', 200: '#c9d0db', 300: '#a3adbd', 400: '#7c8799', 500: '#5d6779' },
        lumen: { DEFAULT: 'rgb(var(--lumen) / <alpha-value>)', 400: 'rgb(var(--lumen-400) / <alpha-value>)', 500: 'rgb(var(--lumen-500) / <alpha-value>)', 600: 'rgb(var(--lumen-600) / <alpha-value>)' },
        ok: '#5fd69a',
        warn: '#f2c46b',
        bad: '#ff6b6b',
      },
      borderRadius: { '4xl': '2rem', '5xl': '2.5rem' },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 20px 50px -20px rgba(0,0,0,0.65)',
        focus: '0 0 0 2px rgba(216,228,255,0.9), 0 18px 40px -12px rgba(127,163,255,0.35)',
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
};
