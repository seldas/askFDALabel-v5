import type { NextConfig } from "next";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";

// 1. Load .env from project root
const envPath = path.resolve(process.cwd(), "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const backendHost = process.env.HOST || 'localhost';
const backendPort = process.env.BACKEND_PORT || 8842;
const BACKEND = process.env.BACKEND_URL ?? `http://${backendHost}:${backendPort}`;

// App Base Path (e.g. /fdalabel-v3)
const appBase = process.env.NEXT_PUBLIC_APP_BASE?.trim() || 
                process.env.NEXT_PUBLIC_DASHBOARD_BASE?.trim() || 
                '/fdalabel-v3';
const normalizedAppBase = appBase === '/' ? '' : appBase.replace(/\/$/, '');
const basePath = normalizedAppBase === '' ? undefined : normalizedAppBase;
const assetPath = normalizedAppBase === '' ? undefined : normalizedAppBase;

// API Base Path (e.g. /fdalabel-v3_api)
const apiBase = process.env.NEXT_PUBLIC_API_BASE?.trim() || '/fdalabel-v3_api';
const normalizedApiBase = apiBase === '/' ? '' : apiBase.replace(/\/$/, '');

const nextConfig: NextConfig = {
  turbopack: {},
  async rewrites() {
    const rewrites: any[] = [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/api/:path*`,
        basePath: false,
      },
    ];

    if (normalizedApiBase && normalizedApiBase !== '/api') {
      rewrites.push({
        source: `${normalizedApiBase}/api/:path*`,
        destination: `${BACKEND}/api/:path*`,
        basePath: false,
      });
    }

    return rewrites;
  },
  devIndicators: false,
  allowedDevOrigins: ["ncshpcgpu01", "elsa.fda.gov", "localhost", "ncshpc400"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ],
      },
    ];
  },
  basePath,
  assetPrefix: assetPath,
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
