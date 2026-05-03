/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        black: '#000000',
        white: '#ffffff',
        gray: '#888888',
        offwhite: '#f0f0f0',
        'ink-dark': '#111111',
        'ink-light': '#222222',
      },
      fontFamily: {
        'bebas': ['"Bebas Neue"', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
        'rajdhani': ['Rajdhani', 'monospace'],
        'manga-heading': ['"Bebas Neue"', '"Special Gothic Expanded One"', 'sans-serif'],
      },
      boxShadow: {
        'ink-glow': '0 0 20px rgba(255,255,255,0.6), 0 0 40px rgba(255,255,255,0.3)',
        'ink-glow-strong': '0 0 30px rgba(255,255,255,0.8), 0 0 60px rgba(255,255,255,0.4)',
        'manga-panel': 'inset 0 0 0 2px rgba(255,255,255,0.2), 0 8px 32px rgba(0,0,0,0.8)',
      },
      animation: {
        'ink-wipe': 'inkWipe 1.5s ease-out forwards',
        'glitch': 'glitch 0.2s infinite',
        'manga-slam': 'mangaSlam 0.8s cubic-bezier(0.34,1.56,0.64,1)',
        'pulsing-aura': 'pulsingAura 2s ease-in-out infinite',
      },
      backgroundImage: {
        'manga-noise': "url('/textures/manga-noise.svg')",
        'ink-splatter': "url('/textures/ink-splatter.svg')",
        'halftone': "url('/textures/halftone-dots.svg')",
      },
      backgroundSize: {
        'manga-noise': '300px 300px',
        'halftone': '8px 8px',
      }
    },
  },
  plugins: [],
};
