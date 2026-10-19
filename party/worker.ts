// Cloudflare Worker entry: /parties/main/<room> goes to the room's Durable Object (YapServer); everything else is the frontend.
import { routePartykitRequest } from "partyserver";

export { YapServer } from "./server";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
