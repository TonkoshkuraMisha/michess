/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Светлые элементы (Самшит индийский)
        boxwood: {
          light: '#F5DEB3',
          DEFAULT: '#E6C998',
          dark: '#D0A972',
        },
        // Темные элементы (Акация)
        acacia: {
          light: '#7A4B31',
          DEFAULT: '#5C3A21',
          dark: '#3D2314',
        },
        // Фон и элементы интерфейса (Стол/Комната)
        room: {
          light: '#4A3B32',
          DEFAULT: '#2C221C',
        },
        paper: '#FDFBF7',
      },
      fontFamily: {
        serif: ['"Playfair Display"', '"Merriweather"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'heavy': '0 15px 35px -5px rgba(0, 0, 0, 0.6), 0 10px 15px -5px rgba(0, 0, 0, 0.4)',
        'piece': '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -1px rgba(0, 0, 0, 0.3)',
        'inner-board': 'inset 0 4px 10px 0 rgba(0, 0, 0, 0.5)',
      },
      backgroundImage: {
        'wood-texture': "url('/assets/textures/wood-grain.png')",
      }
    },
  },
  plugins: [],
}