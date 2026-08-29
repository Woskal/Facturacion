import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /*
      Sin esto la aplicación no abre sin internet: el navegador no tendría de
      dónde sacar el HTML ni el JavaScript. Se precargan los archivos del build,
      pero NUNCA las respuestas de la API — los datos vienen del almacén local,
      que sabe cuáles son suyos y cuáles ya se subieron. Una respuesta de API
      servida desde caché mostraría existencias o precios viejos como si fueran
      de ahora.
    */
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'Punto de venta',
        short_name: 'Caja',
        description: 'Punto de venta y gestión',
        lang: 'es-VE',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f8fa',
        theme_color: '#1f6feb',
        icons: [],
      },
    }),
  ],
  server: {
    port: 5173,
    // La API corre aparte; el proxy evita CORS en desarrollo.
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
})
