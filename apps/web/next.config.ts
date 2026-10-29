import type { NextConfig } from "next";

const config: NextConfig = {
  // A self-contained server with only the files it needs, for the Docker image.
  output: "standalone",
  experimental: {
    // Patient import files are sent through a server action; the api accepts up to 5 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default config;
