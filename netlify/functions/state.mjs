import { getStore } from "@netlify/blobs";

const KEY = "estado";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  // Región fija: los datos se guardaron en us-east-2 desde el principio
  const store = getStore({ name: "voley", consistency: "strong", region: "us-east-2" });

  if (req.method === "GET") {
    const url = new URL(req.url);
    // Sin parámetros: respuesta compartida en la caché de Netlify unos segundos,
    // así varios móviles mirando a la vez no ejecutan la función cada uno.
    if (!url.search) {
      const data = await store.get(KEY, { type: "json" });
      return new Response(JSON.stringify(data ? { state: data, version: data.version ?? 0 } : { state: null, version: 0 }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=0, must-revalidate",
          "netlify-cdn-cache-control": "public, durable, s-maxage=3",
        },
      });
    }
    const entry = await store.getWithMetadata(KEY, { type: "json" });
    if (entry === null) return json({ state: null, version: 0 });
    const v = Number(url.searchParams.get("v") || -1);
    if (entry.data && entry.data.version === v) return json({ same: true, version: v });
    return json({ state: entry.data, version: entry.data?.version ?? 0 });
  }

  if (req.method === "PUT") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
    const { base, state } = body || {};
    if (!state || typeof state !== "object") return json({ error: "Falta estado" }, 400);
    if (JSON.stringify(state).length > 500_000) return json({ error: "Demasiado grande" }, 413);

    const entry = await store.getWithMetadata(KEY, { type: "json" });
    const current = entry?.data ?? null;
    const curVersion = current?.version ?? 0;
    if (curVersion !== base) return json({ conflict: true, state: current, version: curVersion }, 409);

    state.version = curVersion + 1;
    const opts = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const res = await store.setJSON(KEY, state, opts);
    // Algunas versiones devuelven undefined; solo es conflicto si dice explícitamente modified:false
    if (res && res.modified === false) {
      const fresh = await store.get(KEY, { type: "json" });
      return json({ conflict: true, state: fresh, version: fresh?.version ?? 0 }, 409);
    }
    return json({ ok: true, version: state.version });
  }

  return json({ error: "Método no permitido" }, 405);
};

export const config = { path: "/api/state" };
