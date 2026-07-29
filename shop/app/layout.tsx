import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CatalogueProvider } from "@/components/catalogue-provider";
import { CartProvider } from "@/components/cart/cart-provider";
import { InstallProvider } from "@/components/install/install-context";
import { PwaProvider } from "@/components/pwa-provider";

const SF_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", "Inter", "Segoe UI", system-ui, Roboto, sans-serif';

export const metadata: Metadata = {
  title: "SayNoMore Shop — Diapers & Detergent, Delivered",
  description: "Shop MamyPoko, Merries and Sosoft — order online, pay on delivery or by bank transfer.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "SNM Shop",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full" style={{ fontFamily: SF_STACK }}>
        <PwaProvider>
          <InstallProvider>
            <CatalogueProvider>
              <CartProvider>{children}</CartProvider>
            </CatalogueProvider>
          </InstallProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
