/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta de marca AsysTax. Sueldos (azul fintech sobre neutros).
        // Escala centrada en el primario #1E5BFF para que las clases brand-*
        // existentes adopten la nueva identidad sin reescribir cada vista.
        brand: {
          50: '#EAF0FF',
          100: '#D6E2FF',
          200: '#B3C8FF',
          300: '#85A6FF',
          400: '#5B8DEF',
          500: '#3A72FF',
          600: '#1E5BFF', // primario · acción principal, enlaces, el "punto"
          700: '#1746CC',
          800: '#13379E',
          900: '#0B1B3A', // navy
          navy: '#0B1B3A',
          soft: '#5B8DEF', // acento sobre fondos oscuros
        },
        primary: {
          50: '#EAF0FF',
          100: '#D6E2FF',
          500: '#3A72FF',
          600: '#1E5BFF',
          700: '#1746CC',
          900: '#0B1B3A',
        },
        navy: '#0B1B3A',
        // Superficies / texto del sistema AsysTax
        surface: '#FFFFFF',
        canvas: '#E9EDF4',
        hairline: '#E1E7F1',
        ink: {
          DEFAULT: '#0B1B3A',
          muted: '#4A5872',
          subtle: '#8493AD',
        },
        // Estados semánticos
        ok: { DEFAULT: '#22C3A6', bg: '#ECFAF5' },
        warn: { DEFAULT: '#F5A524', bg: '#FEF3DC' },
        bad: { DEFAULT: '#E5484D', bg: '#FDECEC' },
        uy: {
          blue: '#1E5BFF',
          sky: '#5B8DEF',
        },
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
        brand: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,27,58,0.04), 0 6px 20px -10px rgba(11,27,58,0.12)',
      },
    },
  },
  plugins: [],
};
