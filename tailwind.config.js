/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      spacing: { '9.5': '2.375rem' },
      colors: {
        ink: {
          50: '#f7f8fa', 100: '#eef0f4', 200: '#dde1e8', 300: '#c2c9d4',
          400: '#8f99a9', 500: '#657084', 600: '#4a5568', 700: '#374151',
          800: '#232a36', 900: '#141922', 950: '#0b0e14',
        },
        brand: {
          50: '#f1f1fe', 100: '#e5e5fd', 200: '#cdcdfb', 300: '#aaa8f6',
          400: '#8a83f0', 500: '#6f63e8', 600: '#5b46dc', 700: '#4f3ac2',
          800: '#41319d', 900: '#372d7d', 950: '#221a4c',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.04)',
        pop: '0 12px 32px -8px rgba(16,24,40,.18), 0 4px 10px -4px rgba(16,24,40,.10)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
      },
      animation: { 'fade-up': 'fade-up .22s ease-out both' },
    },
  },
  plugins: [],
};
