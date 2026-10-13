import { defineConfig } from "vite";
export default defineConfig({
  publicDir: "resources",
  resolve: { tsconfigPaths: true },
  define: {
    "process.env.CREW_TWITCH_ONLY": JSON.stringify("true"),
    "process.env.GAME_ENV": JSON.stringify("dev"),
    "process.env.API_DOMAIN": JSON.stringify(""),
  },
  server: { host: "127.0.0.1", port: 9107, strictPort: true, open: false },
});
