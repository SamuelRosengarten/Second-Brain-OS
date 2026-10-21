import type { MetadataRoute } from "next";

/** Makes "Add to Home Screen" open the app full-screen with its own icon. Public on purpose: it contains no data. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Second Brain OS",
    short_name: "Second Brain",
    description: "Private, local-first personal knowledge and productivity system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    // Chromium/Android only (iOS Safari ignores share targets; use the Shortcut in docs/SETUP.md). Opens the capture form prefilled.
    share_target: { action: "/capture", method: "GET", params: { title: "title", text: "text", url: "url" } },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
