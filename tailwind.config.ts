import type { Config } from "tailwindcss";

const withAlpha = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: withAlpha("--bg"),
        surface: {
          DEFAULT: withAlpha("--surface"),
          2: withAlpha("--surface-2"),
          hover: withAlpha("--surface-hover"),
        },
        border: {
          DEFAULT: withAlpha("--border"),
          strong: withAlpha("--border-strong"),
        },
        fg: {
          DEFAULT: withAlpha("--fg"),
          muted: withAlpha("--fg-muted"),
          subtle: withAlpha("--fg-subtle"),
          faint: withAlpha("--fg-faint"),
        },
        brand: {
          DEFAULT: withAlpha("--brand"),
          hover: withAlpha("--brand-hover"),
          subtle: withAlpha("--brand-subtle"),
          fg: withAlpha("--brand-fg"),
        },
        success: {
          DEFAULT: withAlpha("--success"),
          subtle: withAlpha("--success-subtle"),
        },
        warning: {
          DEFAULT: withAlpha("--warning"),
          subtle: withAlpha("--warning-subtle"),
        },
        danger: {
          DEFAULT: withAlpha("--danger"),
          subtle: withAlpha("--danger-subtle"),
        },
        info: {
          DEFAULT: withAlpha("--info"),
          subtle: withAlpha("--info-subtle"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
      },
    },
  },
  plugins: [],
};

export default config;
