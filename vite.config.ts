import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Google sign-in only allows the origin registered in Cloud Console.
  server: { port: 5173, strictPort: true },
})
