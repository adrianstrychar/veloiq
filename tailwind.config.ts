import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-hover": "var(--card-hover)",
        border: "var(--border)",
        secondary: "var(--text-secondary)",
        accent: {
          DEFAULT: "#00E5A0",
          warning: "#FF8C42",
          danger: "#FF4757",
          info: "#4ECDC4",
        },
      },
    },
  },
  plugins: [],
};
export default config;
