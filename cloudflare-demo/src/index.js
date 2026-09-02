import { Container } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class AuDHDMapDemo extends Container {
  defaultPort = 3010;
  sleepAfter = "2h";
  envVars = {
    AUDHDMAP_ADMIN_USERNAME: "demo",
    AUDHDMAP_ADMIN_PASSWORD: env.AUDHDMAP_DEMO_PASSWORD,
    AUDHDMAP_SESSION_SECRET: env.AUDHDMAP_SESSION_SECRET,
    AUDHDMAP_TRUST_PROXY: "1",
  };
}

export default {
  async fetch(request, workerEnv) {
    const demo = workerEnv.AUDHDMAP_DEMO.getByName("public-demo");
    return demo.fetch(request);
  },
};
