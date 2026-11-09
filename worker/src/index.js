import { Container, getContainer } from "@cloudflare/containers";

export class Backend extends Container {
    defaultPort = 8000;
    sleepAfter = "10m"
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
            return getContainer(env.BACKEND).fetch(request);
        }

        return env.ASSETS.fetch(request);
    },
};