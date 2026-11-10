import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { DeviceProvider } from "@/components/device-provider";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PEND — Send any file", template: "%s · PEND" },
  description: "Peer-to-peer file sharing with trusted contacts and pending transfers. P2P transfer preview.",
  applicationName: "PEND",
  appleWebApp: { capable: true, title: "PEND", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icon-192.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0d111d" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><body className="antialiased"><ThemeProvider attribute="class" defaultTheme="dark" enableSystem><DeviceProvider><ServiceWorkerRegister/><AppShell>{children}</AppShell></DeviceProvider></ThemeProvider></body></html>;
}
