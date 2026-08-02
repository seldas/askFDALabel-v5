import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { UserProvider } from "./context/UserContext";
import AuthModals from "./components/AuthModals";
import FetchPrefix from "./FetchPrefix";
import { withAppBase } from "./utils/appPaths";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "askFDALabel | Scientific Drug Label Intelligence",
  description: "Advanced semantic search and toxicological analysis for FDA drug labeling.",
  icons: {
    icon: withAppBase("/askfdalabel_icon.svg"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistMono.variable}`} style={{ 
        margin: 0, 
        padding: 0, 
        backgroundColor: '#ffffff',
        fontFamily: 'var(--font-inter), system-ui, sans-serif'
      }}>
        <UserProvider>
          <FetchPrefix />
          {children}
          <AuthModals />
        </UserProvider>
      </body>
    </html>
  );
}
