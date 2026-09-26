import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const themeColor = (variable: string) =>
  `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}", "./index.html"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "JetBrains Mono", "monospace"],
        display: ["Fraunces", "Plus Jakarta Sans", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        brand: "#FF5B2E",
        "brand-light": "#FF8A5B",
        "brand-dark": "#D94418",
        "brand-blue": "#2B4CFF",
        "brand-ink": "#0E1116",
        "brand-paper": "#F4F1EA",
        "brand-glow": "rgba(255, 91, 46, 0.10)",
        "brand-dim": "rgba(255, 91, 46, 0.05)",
        // Surface colors follow the light/dark theme tokens in index.css. They
        // were hard-coded to the light palette, so every legacy (GlassCard)
        // page rendered light surfaces under light dark-mode text.
        // color-mix keeps opacity modifiers like bg-bg-base/50 working.
        "bg-base": themeColor("--bg-base"),
        "bg-surface": themeColor("--bg-surface"),
        "bg-elevated": themeColor("--bg-elevated"),
        "bg-sidebar": themeColor("--bg-sidebar"),
        "bg-hover": themeColor("--bg-hover"),
        // Text / border tokens used across the legacy UI (text-text-muted,
        // border-border-subtle, …) had no mapping, so those classes produced
        // no CSS at all and fell back to inherited/default colors.
        "text-primary": themeColor("--text-primary"),
        "text-secondary": themeColor("--text-secondary"),
        "text-muted": themeColor("--text-muted"),
        "text-disabled": themeColor("--text-disabled"),
        "text-brand": themeColor("--text-brand"),
        "border-subtle": themeColor("--border-subtle"),
        "border-default": themeColor("--border-default"),
        "sev-critical": "#EF4444",
        "sev-high": "#F97316",
        "sev-medium": "#EAB308",
        "sev-low": "#22C55E",
        "sev-info": "#3B82F6",
        "severity-critical": "#EF4444",
        "severity-high": "#F97316",
        "severity-medium": "#EAB308",
        "severity-low": "#22C55E",
        "severity-info": "#3B82F6",
        "status-open": "#EF4444",
        "status-false-positive": "#F97316",
        "status-analyzed": "#EAB308",
        "status-risk-accepted": "#2B4CFF",
        "status-resolved": "#22C55E",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "slide-in": { from: { opacity: "0", transform: "translateX(-6px)" }, to: { opacity: "1", transform: "translateX(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.95)" }, to: { opacity: "1", transform: "scale(1)" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in": "slide-in 0.2s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
