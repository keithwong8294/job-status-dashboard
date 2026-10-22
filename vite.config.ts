import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative paths so the build works at https://<user>.github.io/<repo>/
  base: './',
  plugins: [react()],
  // Google sign-in only allows origins registered in Cloud Console.
  server: { port: 5173, strictPort: true },
})
