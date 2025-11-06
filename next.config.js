/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Enable standalone output for Docker optimization
  modularizeImports: {
    "@permaweb/aoconnect": {
      transform: "@permaweb/aoconnect/node",
    },
  },
  async headers() {
    return [
      {
        // matching all API routes
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: process.env.ALLOWED_ORIGINS || "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,POST,OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Accept, Content-Length, Content-Type, Cache-Control",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
