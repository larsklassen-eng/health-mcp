import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    // Patient import files are sent through a server action; the api accepts up to 5 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default config;
