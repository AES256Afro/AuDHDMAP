import { Container } from "@cloudflare/containers";

export class AuDHDMapDemo extends Container {
  defaultPort = 3010;
  sleepAfter = "2h";
  envVars = {
    AUDHDMAP_ADMIN_USERNAME: "demo",
    AUDHDMAP_TRUST_PROXY: "1",
    AUDHDMAP_PUBLIC_DEMO: "1",
  };
}

export default {
  async fetch(request, workerEnv) {
    const demo = workerEnv.AUDHDMAP_DEMO.getByName("public-demo");
    return demo.fetch(request);
  },
};
