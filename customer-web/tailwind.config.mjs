import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,mdoc,ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1280px'
      }
    },
    extend: {
      colors: {
        text: '#050316',
        background: '#fffef3',
        primary: '#312ac6',
        secondary: '#a2bdfb',
        accent: '#ffad42',
        'muted-foreground': '#4d4a70',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        }
      },
      fontFamily: {
        heading: ['Prata', 'serif'],
        body: ['Geist Sans', 'system-ui', 'sans-serif']
      },
      fontSize: {
        sm: '0.750rem',
        base: '1rem',
        xl: '1.333rem',
        '2xl': '1.777rem',
        '3xl': '2.369rem',
        '4xl': '3.158rem',
        '5xl': '4.210rem'
      },
      fontWeight: {
        normal: '400',
        bold: '700'
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      boxShadow: {
        soft: '0 18px 60px rgba(49, 42, 198, 0.15)'
      }
    }
  },
  plugins: [tailwindcssAnimate]
};
