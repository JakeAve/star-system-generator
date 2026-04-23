import { build } from "./build.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8080");
const RENDERER_DIR = "./renderer";
const SEEDER_DIR = "./seeder";

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

function notifyReload(): void {
  const msg = enc.encode("data: reload\n\n");
  for (const client of sseClients) {
    try {
      client.enqueue(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function watchRenderer(): Promise<void> {
  let debounce: number | null = null;
  for await (const _event of Deno.watchFs(RENDERER_DIR)) {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(notifyReload, 50);
  }
}

async function watchSeeder(): Promise<void> {
  let debounce: number | null = null;
  for await (const _event of Deno.watchFs(SEEDER_DIR)) {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        await build();
        notifyReload();
      } catch (err) {
        console.error("Rebuild failed:", err);
      }
    }, 100);
  }
}

watchRenderer();
watchSeeder();

const server = Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/sse") return handleSSE();
  return serveStatic(url.pathname);
});

console.log(`Renderer at http://localhost:${PORT}`);
new Deno.Command("open", { args: [`http://localhost:${PORT}`] }).spawn();
await server.finished;
