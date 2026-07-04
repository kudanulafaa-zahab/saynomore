import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { OfflineProvider } from "@/components/layout/offline-provider";
import "./globals.css";
import { Plus_Jakarta_Sans } from "next/font/google";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
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
      <body className="min-h-full" style={{ fontFamily: "var(--font-plus-jakarta), -apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}>
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
