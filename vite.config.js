import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Base path differs by host:
//   - Vercel serves at the domain root ("/") — Vercel sets VERCEL=1 at build.
//   - GitHub Pages serves under "/talaash/".
//   - Local dev serves at "/".
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: process.env.VERCEL ? '/' : mode === 'production' ? '/talaash/' : '/',
}))
