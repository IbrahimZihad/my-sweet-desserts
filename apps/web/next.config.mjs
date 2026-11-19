/** @type {import('next').NextConfig} */
const nextConfig = {
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

/**
 * `NODE_ENV=development` during a build makes Next load its development React
 * runtime, and static prerendering then fails with "Cannot read properties of
 * null (reading 'useContext')" and "<Html> should not be imported outside of
 * pages/_document". Non-standard values such as "Production" are also
 * inconsistent, so normalise both to "production" for the build.
 *
 * `scripts/build.mjs` already pins the value; this is the safety net for a
 * direct `next build` invocation (for example a host running the command by
 * hand). `next dev` passes a development phase, so it is untouched.
 */
export default function config(phase) {
  if (phase === "phase-production-build" && process.env.NODE_ENV !== "production") {
    const requested = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    console.warn(
      `[cakeflow] NODE_ENV=${requested === undefined ? "(unset)" : JSON.stringify(requested)} during next build; using "production".`,
    );
  }
  return nextConfig;
}
