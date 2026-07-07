import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { OfflineProvider } from "@/components/layout/offline-provider";
import "./globals.css";
import { Plus_Jakarta_Sans } from "next/font/google";

// SF Pro is the system UI font (Apple HIG 2026). On iOS/macOS the -apple-system
// stack resolves to the REAL SF Pro — the most authentic, zero-download result.
// Inter/Segoe/system-ui are the cross-platform fallbacks. We keep the historical
// --font-plus-jakarta variable name so every existing reference now points at
// this SF-first stack without touching any component (surgical swap).
const SF_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Inter", "Segoe UI", system-ui, Roboto, sans-serif';

// Plus Jakarta stays loaded for the "saynomore" wordmark ONLY.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-wordmark",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SayNoMore",
  description: "FMCG Import & Distribution Operations",
  manifest: "/manifest.webmanifest",
  icons: {
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "SayNoMore",
    statusBarStyle: "black-translucent",
    // No startupImage: a 512px icon stretched to a phone-sized splash looks
    // worse than iOS's clean solid-colour launch. A proper per-device
    // apple-touch-startup-image set is a separate asset task; until then iOS
    // falls back to the manifest background_color, which is the better default.
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7fb" },
    { media: "(prefers-color-scheme: dark)",  color: "#0a0a0f" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`h-full antialiased ${plusJakarta.variable}`}>
      <body className="min-h-full" style={{ fontFamily: SF_STACK }}>
        <ThemeProvider>
          <OfflineProvider>
            {children}
          </OfflineProvider>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
