/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client", "sharp"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "images-api.printify.com" },
      { protocol: "https", hostname: "oaidalleapiprodscus.blob.core.windows.net" },
    ],
  },
};

export default nextConfig;
