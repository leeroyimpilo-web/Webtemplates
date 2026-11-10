import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PEND — Peer-to-Peer File Transfer",
    short_name: "PEND",
    description: "Send files securely between paired devices.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d111d",
    theme_color: "#0d111d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
