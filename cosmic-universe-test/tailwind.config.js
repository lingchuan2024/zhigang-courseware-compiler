/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'deep-space': '#01030A',
        'void-blue': '#020617',
        'abyss': '#050816',
        'deep-sea': '#071426',
        'indigo-deep': '#1E3A8A',
        'nebula-blue': '#2563EB',
        'nebula-purple': '#6D28D9',
        'soft-purple': '#8B5CF6',
        'ice-blue': '#7DD3FC',
        'cyan-glow': '#22D3EE',
        'star-white': '#F8FAFC',
        'gray-blue': '#94A3B8',
      },
      fontFamily: {
        sans: ['Manrope', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        'ultra-tight': '-0.04em',
        'tighter-2': '-0.03em',
      },
      animation: {
        'breathe': 'breathe 8s ease-in-out infinite',
        'drift-slow': 'drift-slow 40s linear infinite',
        'fade-in-slow': 'fade-in-slow 1.6s ease-out forwards',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.85', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.015)' },
        },
        'drift-slow': {
          '0%': { transform: 'translate3d(0,0,0)' },
          '100%': { transform: 'translate3d(-2%, -1%, 0)' },
        },
        'fade-in-slow': {
          '0%': { opacity: '0', transform: 'translateY(16px)', filter: 'blur(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
      },
    },
  },
  plugins: [],
}
