import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  // host: true escucha en todas las interfaces, para abrir la pantalla desde el celular (http://<IP-de-la-PC>:5173).
  // allowedHosts: Vite rechaza los hosts que no conoce; los túneles de VS Code (*.devtunnels.ms) se permiten a propósito.
  server: { host: true, port: 5173, allowedHosts: ['.devtunnels.ms'] },
  preview: { host: true, port: 4173, allowedHosts: ['.devtunnels.ms'] },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
});
