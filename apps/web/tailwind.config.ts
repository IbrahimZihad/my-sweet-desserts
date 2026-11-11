import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FAF6F2",
        ink: "#2B2320",
        muted: "#7A6B64",
        line: "#EADFD8",
        rose: {
          50: "#FBF3F6",
          100: "#F6E4EB",
          300: "#E4B4C7",
          500: "#C084A0",
          600: "#A96A86",
          700: "#8C526B",
        },
        sage: "#6F7F6A",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 18px 50px -24px rgba(43,35,32,0.35)",
      },
      borderRadius: {
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
