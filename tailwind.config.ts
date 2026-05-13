import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        payso: {
          blue: "#1551F5",
          dark: "#102BB1",
          light: "#C3CEFC",
          red: "#FB5B5B",
          bg: "#F6F8FF",
          soft: "#EEF3FF",
          ink: "#11204F",
          muted: "#4F628F",
        },
      },
      boxShadow: {
        glass: "0 28px 60px rgba(16, 43, 177, 0.12)",
      },
      fontFamily: {
        sans: ["var(--font-noto-sans-thai)", "Noto Sans Thai", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
