/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de marca GRO (azul institucional).
        brand: {
          50: '#eef4fb',
          100: '#d6e4f5',
          200: '#aecaeb',
          300: '#7da7dd',
          400: '#4a80cb',
          500: '#1f5fb8',
          600: '#003DA5',
          700: '#00337f',
          800: '#002a66',
          900: '#001f4d',
          navy: '#1E477C',
        },
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        uy: {
          blue: '#003DA5',
          sky: '#75AADB',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px -8px rgba(16,24,40,0.08)',
      },
    },
  },
  plugins: [],
};
