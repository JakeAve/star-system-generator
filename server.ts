import { generateSolarSystem } from "./seeder/generator.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8080");
const RENDERER_DIR = "./renderer";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i) : "";
}

async function serveStatic(pathname: string): Promise<Response> {
  const safe = pathname.replace(/\.\./g, "").replace(/^\/+/, "");
  const filePath = `${RENDERER_DIR}/${safe || "index.html"}`;
  try {
    const data = await Deno.readFile(filePath);
    return new Response(data, {
      headers: {
        "Content-Type": MIME[ext(filePath)] ?? "application/octet-stream",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

function handleSSE(): Response {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      sseClients.add(c);
    },
    cancel() {
      sseClients.delete(ctrl);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function handleGenerate(url: URL): Promise<Response> {
  const raw = url.searchParams.get("seed");
  let seed: number;
  if (raw && raw !== "") {
    seed = parseInt(raw, 10);
    if (isNaN(seed)) return new Response("Invalid seed", { status: 400 });
  } else {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    seed = buf[0];
  }

  const system = generateSolarSystem({ seed });
  const json = JSON.stringify(system, null, 2);
  await Deno.mkdir("./seeds", { recursive: true });
  await Deno.writeTextFile(`./seeds/system-${seed}.json`, json);

  return new Response(json, {
    headers: { "Content-Type": "application/json" },
  });
}

async function watchFiles(): Promise<void> {
  let debounce: number | null = null;
  for await (const _event of Deno.watchFs(RENDERER_DIR)) {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const msg = enc.encode("data: reload\n\n");
      for (const client of sseClients) {
        try {
          client.enqueue(msg);
        } catch {
          sseClients.delete(client);
        }
      }
    }, 50);
  }
}

watchFiles();

const server = Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/sse") return handleSSE();
  if (url.pathname === "/generate") return await handleGenerate(url);
  if (url.pathname === "/seeds") return serveStatic("/seeds.html");
  if (url.pathname === "/seed") return Response.redirect("/seeds", 302);
  if (url.pathname.startsWith("/seed/")) {
    const id = url.pathname.slice(6);
    if (!id) return Response.redirect("/seeds", 302);
    return serveStatic("/seed.html");
  }
  if (url.pathname.startsWith("/canvas/")) {
    const id = url.pathname.slice(8);
    if (!id) return Response.redirect("/seeds", 302);
    return serveStatic("/canvas.html");
  }
  return serveStatic(url.pathname);
});

console.log(`Renderer at http://localhost:${PORT}`);
new Deno.Command("open", { args: [`http://localhost:${PORT}`] }).spawn();
await server.finished;
