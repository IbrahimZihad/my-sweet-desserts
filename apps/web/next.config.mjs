/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone tracing uses symlinks that Windows blocks without developer mode.
  // Docker builds opt in explicitly; local builds keep the normal output.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  reactStrictMode: true,
  transpilePackages: ["@cakeflow/contracts"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
