import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      '@near-wallet-selector/core',
      '@near-wallet-selector/my-near-wallet',
      '@near-wallet-selector/meteor-wallet',
      '@near-wallet-selector/sender',
      '@near-wallet-selector/here-wallet',
      '@near-wallet-selector/hot-wallet',
      '@near-wallet-selector/nightly',
      '@near-wallet-selector/modal-ui',
      'near-api-js',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: {
      '/api/near-rpc': {
        target: 'https://rpc.testnet.fastnear.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/near-rpc/, ''),
      },
    },
  },
})
