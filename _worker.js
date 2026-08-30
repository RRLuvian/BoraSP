// _worker.js
// Formato "Advanced Mode" — um único arquivo de Worker que roda ANTES de
// tudo. Ele decide: se a rota é /api/feed ou /api/click, executa a lógica
// de servidor; para qualquer outra rota, entrega o arquivo estático
// correspondente (index.html, style.css, script.js, data/events.json...).
//
// Por que esse formato e não a pasta /functions de antes: a Cloudflare
// uniu Pages e Workers numa plataforma só, e o upload direto pelo
// dashboard (arrastar arquivos) não decodifica mais a pasta /functions.
// Um _worker.js na raiz é o formato que continua funcionando nesse fluxo.
//
// Nada do comportamento mudou pro visitante do site — só a forma como o
// código chega até a Cloudflare.

// ================= /api/feed =================

const RSS_SOURCES = [
  { name: "Agenda Cultural", url: "https://agendaculturalsaopaulo.com/feed/", moods: ["cultura"] },
  { name: "Nubank Parque", url: "https://nubankparque.com/category/agenda/feed/", moods: ["musica"] },
  // Underground (techno/house/coletivos) não publica RSS — ver README.md
  // para as duas opções de trazer isso (RSS-Bridge ou curadoria manual).
];

const FEED_CACHE_TTL_SECONDS = 900; // 15 minutos

function stripHtml(html) {
  if (!html) return "";
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? text.slice(0, 200) + "…" : text;
}

function safeUrl(url) {
  try {
    const u = new URL(url, "https://example.org");
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch (_) {}
  return null;
}

function formatFeedDate(pubDate) {
  try {
    const d = new Date(pubDate);
    if (isNaN(d.getTime())) return "";
    return d
      .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
      .toUpperCase()
      .replace(".", "");
  } catch (_) {
    return "";
  }
}

function parseFeedXml(xml, src) {
  const items = [];
  const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  for (const raw of itemMatches.slice(0, 8)) {
    const get = (tag) => {
      const m = raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
    };
    const linkAttrMatch = raw.match(/<link[^>]*href=["']([^"']+)["']/i);
    const link = get("link") || (linkAttrMatch ? linkAttrMatch[1] : "");
    const title = stripHtml(get("title"));
    if (!title) continue;

    const pubDate = get("pubDate") || get("published") || get("updated");
    const description = stripHtml(get("description") || get("summary") || get("content"));

    let image = "";
    const enclosureMatch = raw.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
    const mediaMatch = raw.match(/<media:content[^>]*url=["']([^"']+)["']/i) ||
                        raw.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
    if (enclosureMatch) image = enclosureMatch[1];
    else if (mediaMatch) image = mediaMatch[1];
    else {
      const imgTagMatch = get("description").match(/<img[^>]*src=["']([^"']+)["']/i);
      if (imgTagMatch) image = imgTagMatch[1];
    }

    items.push({
      title,
      meta: (formatFeedDate(pubDate) + " · " + src.name.toUpperCase()).trim(),
      badge: "NOVO",
      link: safeUrl(link) || "",
      pubDate: pubDate || "",
      moods: src.moods,
      source: src.name,
      affiliate: false,
      image: safeUrl(image) || "",
      description,
      ageRating: null,
    });
  }
  return items;
}

async function fetchOneFeed(src) {
  try {
    const res = await fetch(src.url, {
      headers: { "User-Agent": "BoraSP-Bot/1.0 (+https://borasp.tur.br)" },
      cf: { cacheTtl: FEED_CACHE_TTL_SECONDS, cacheEverything: true },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeedXml(xml, src);
  } catch (err) {
    console.warn(`Feed indisponível: ${src.name}`, err);
    return [];
  }
}

async function handleFeed(request) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const results = await Promise.allSettled(RSS_SOURCES.map(fetchOneFeed));
  const items = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, 10);

  const body = JSON.stringify({ items, generatedAt: new Date().toISOString() });
  const response = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${FEED_CACHE_TTL_SECONDS}`,
      "access-control-allow-origin": "*",
    },
  });
  return response;
}

// ================= /api/click =================

const ALLOWED_HOSTS = [
  "sympla.com.br", "www.sympla.com.br",
  "eventim.com.br", "www.eventim.com.br",
  "booking.com", "www.booking.com",
  "decolar.com", "www.decolar.com",
  "amazon.com.br", "www.amazon.com.br",
  "shopee.com.br", "www.shopee.com.br", "shope.ee",
  "getyourguide.com", "www.getyourguide.com",
  "civitatis.com", "www.civitatis.com",
  "clickbus.com.br", "www.clickbus.com.br",
  "ingresso.com", "www.ingresso.com",
];

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
}

const SUBID_PARAM_BY_HOST = {
  "booking.com": "aid",
  "amazon.com.br": "tag",
};

function subIdParamFor(hostname) {
  for (const host in SUBID_PARAM_BY_HOST) {
    if (hostname === host || hostname.endsWith("." + host)) return SUBID_PARAM_BY_HOST[host];
  }
  return "subid";
}

function makeSubId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

async function handleClick(request, env, ctx) {
  const url = new URL(request.url);
  const to = url.searchParams.get("to");
  const cardId = (url.searchParams.get("id") || "").slice(0, 80);
  const section = (url.searchParams.get("sec") || "").slice(0, 40);
  const source = (url.searchParams.get("src") || "").slice(0, 40);

  if (!to) return new Response("Parâmetro 'to' ausente", { status: 400 });

  let target;
  try {
    target = new URL(to);
  } catch (_) {
    return new Response("URL de destino inválida", { status: 400 });
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new Response("Protocolo não permitido", { status: 400 });
  }
  if (!isAllowedHost(target.hostname)) {
    return new Response("Domínio de destino não autorizado", { status: 400 });
  }

  const subId = makeSubId();
  target.searchParams.set(subIdParamFor(target.hostname), subId);

  if (env.CLICKS_KV) {
    const record = {
      subId, cardId, section, source,
      target: target.href,
      ts: new Date().toISOString(),
      country: request.cf?.country || null,
      referer: request.headers.get("referer") || null,
    };
    ctx.waitUntil(
      env.CLICKS_KV.put(`click:${subId}`, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 180,
      })
    );
  } else {
    console.warn("CLICKS_KV não configurado — clique não foi salvo, só redirecionado.");
  }

  return Response.redirect(target.href, 302);
}

// ================= roteador principal =================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/feed" && request.method === "GET") {
      return handleFeed(request);
    }
    if (url.pathname === "/api/click" && request.method === "GET") {
      return handleClick(request, env, ctx);
    }

    // Qualquer outra rota: serve o arquivo estático correspondente
    // (index.html, style.css, script.js, data/events.json, _headers...).
    return env.ASSETS.fetch(request);
  },
};
