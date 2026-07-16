import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Market Rover - AI Equity Research Dashboard",
  description:
    "Bloomberg-grade dashboard with automated technical indicators and Gemini AI equity research notes",
  viewport: "width=device-width, initial-scale=1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <ThemeProvider>
        <body
          className="h-full bg-bg-primary text-text-primary flex overflow-hidden font-sans"
          suppressHydrationWarning
        >
          {/* Page content — takes all remaining width */}
          <main className="flex-1 flex flex-col h-full overflow-y-auto min-w-0 bg-bg-primary">
            {children}
          </main>
        </body>
      </ThemeProvider>
    </html>
  );
}
