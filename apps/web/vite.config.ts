import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["branding/favicon.svg", "branding/apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Issue Prompt Tracker",
        short_name: "AAM Tracker",
        description: "Capture issues/features with screenshots and export AI-ready YAML prompts.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f4f2e7",
        theme_color: "#0e7665",
        icons: [
          {
            src: "/branding/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/branding/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/branding/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ],
        screenshots: [
          {
            src: "/branding/screenshot-desktop.png",
            sizes: "1280x720",
            type: "image/png",
            form_factor: "wide",
            label: "Desktop workspace with projects, issues, and prompts"
          },
          {
            src: "/branding/screenshot-mobile.png",
            sizes: "720x1280",
            type: "image/png",
            label: "Mobile issue capture and prompt workflow"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "upload-images",
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 14
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      },
      "/uploads": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
