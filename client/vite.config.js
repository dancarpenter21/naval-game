import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* global process */

// https://vite.dev/config/
const origin = process.env.VITE_APP_ORIGIN || 'http://localhost:8080';
const hmrHost = process.env.VITE_HMR_HOST || 'localhost';
const hmrClientPort = Number(process.env.VITE_HMR_CLIENT_PORT || 8080);
const openTarget = process.env.VITE_APP_OPEN_URL || origin;
const autoOpen = process.env.VITE_APP_AUTO_OPEN === 'true';
/** Cypress loads http://nginx; HMR still points at localhost:8080 and breaks in headless E2E. */
const disableHmr = process.env.VITE_DISABLE_HMR === 'true';

export default defineConfig({
  plugins: [react()],
  server: {
    // nginx proxies with Host: client; Docker health/E2E probes may use 127.0.0.1 or Host: nginx.
    allowedHosts: ['client', 'nginx', 'localhost', '127.0.0.1'],
    host: '0.0.0.0',
    open: autoOpen ? openTarget : false,
    strictPort: true,
    port: 5173,
    origin,
    hmr: disableHmr
      ? false
      : {
          host: hmrHost,
          clientPort: hmrClientPort,
        },
  },
});
