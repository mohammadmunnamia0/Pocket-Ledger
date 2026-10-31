import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { OfflineBanner, ServiceWorkerRegister } from "@/components/pwa";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Bangla titles and notes render consistently across devices.
const bangla = Noto_Sans_Bengali({ variable: "--font-bangla", subsets: ["bengali"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "PocketLedger", template: "%s · PocketLedger" },
  description: "Personal salary, expense and savings ledger",
  applicationName: "PocketLedger",
  // Home-screen app behaviour on iPhone/iPad.
  appleWebApp: { capable: true, title: "PocketLedger", statusBarStyle: "default" },
  // Stop iOS turning amounts like 20000 into tappable phone numbers.
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Edge-to-edge on notched phones; layout pads itself with safe-area insets.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${bangla.variable} h-full antialiased`}>
      <body className="min-h-full pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster position="top-center" richColors closeButton offset={{ top: "max(16px, env(safe-area-inset-top))" }} />
          <OfflineBanner />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
