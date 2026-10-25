/** @type {import('tailwindcss').Config} */
const color = (token) => `rgb(var(--${token}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: color('canvas'),
        surface: color('surface'),
        input: color('input'),
        auth: { panel: color('auth-panel'), text: color('auth-text') },
        primary: color('primary'),
        secondary: color('secondary'),
        accent: {
          DEFAULT: color('accent'),
          hover: color('accent-hover'),
          ink: color('accent-ink'),
          soft: color('accent-soft'),
        },
        muted: color('muted'),
        hover: color('hover'),
        subtle: color('border-subtle'),
        control: color('border-control'),
        ink: color('ink'),
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '28px' }],
        '2xl': ['24px', { lineHeight: '30px' }],
        '3xl': ['28px', { lineHeight: '34px' }],
      },
      spacing: {
        1: 'var(--space-unit)',
        2: 'calc(var(--space-unit) * 2)',
        3: 'calc(var(--space-unit) * 3)',
        4: 'calc(var(--space-unit) * 4)',
        6: 'calc(var(--space-unit) * 6)',
        8: 'calc(var(--space-unit) * 8)',
        12: 'calc(var(--space-unit) * 12)',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',
        modal: 'var(--radius-modal)',
        lg: 'var(--radius-control)',
      },
      boxShadow: { overlay: 'var(--shadow-overlay)' },
    },
  },
  plugins: [],
};
