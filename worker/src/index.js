import { Container, ContainerProxy, getRandom } from "@cloudflare/containers";

export { ContainerProxy };

export class Backend extends Container {
    defaultPort = 8000;
    sleepAfter = "10m"
    envVars = {
        DB_BACKEND: "d1",
        D1_BRIDGE_URL: "http://d1.internal",
        COOKIE_SECURE: "true",
        FLASK_ENV: "production",
        ALLOWED_ORIGINS: "",
        BARCODE_PROVIDER: "none",
    };
}

Backend.outboundByHost = {
    "d1.internal": handleD1Bridge,
};

async function handleD1Bridge(request, env) {
    if (request.method !== "POST") {
        return Response.json({ error: { message: "Only POST is allowed." } }, { status: 405 });
    }
    const url = new URL(request.url);

    let body;
    try {
        body = await request.json();
    } catch (err) {
        return Response.json({ error: { message: "The request body isn't valid JSON." } }, { status: 500 });
    }

    const prepare = (stmt) => env.DB.prepare(stmt.sql).bind(...(stmt.params || []));

    const shape = (result) => ({
        results: result.results || [],
        meta: { changes: result.meta.changes, last_row_id: result.meta.last_row_id },
    });

    try {
        if (url.pathname === "/query") {
            return Response.json(shape(await prepare(body).all()));
        }
        if (url.pathname === "/batch") {
            const results = await env.DB.batch(body.map(prepare));
            return Response.json(results.map(shape));
        }
        return Response.json({ error: { message: "Not found." } }, { status: 404 });
    } catch (err) {
        const message = String((err && err.message) || err);
        const status = /D1_|SQLITE/.test(message) ? 400:500;
        return Response.json({ error: { message } }, { status });    
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
            return (await getRandom(env.BACKEND, 2)).fetch(request);
        }

        return env.ASSETS.fetch(request);
    },
};