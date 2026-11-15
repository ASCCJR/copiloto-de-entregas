import type { NextConfig } from "next";
import { portfolioUrl } from "./lib/portfolio";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/", destination: portfolioUrl, permanent: true }];
  },
  outputFileTracingIncludes: {
    "/copiloto": ["./data/deliveries.json"],
    "/api/*": ["./data/deliveries.json"],
  },
};

export default nextConfig;
