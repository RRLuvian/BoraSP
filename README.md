# Bora SP — pronto para Cloudflare Pages

## O que mudou desde a versão original

| Área | Antes | Agora |
|---|---|---|
| Feed RSS | Buscado no navegador via `rss2json.com` (terceiro, limite de cota compartilhado) | Buscado e cacheado no servidor via **Cloudflare Worker** (`/_worker.js`), no seu próprio domínio |
| Segurança do conteúdo externo | Título/descrição do RSS inseridos direto no HTML, sem tratamento | Sanitizado no servidor (função `stripHtml`) **e** escapado de novo no cliente (função `esc()`) antes de qualquer `innerHTML` |
| Links/imagens externas | Inseridos sem validar o protocolo | Passam por `safeUrl()` — só `http(s)` é aceito; `javascript:`, `data:` etc. são descartados |
| Handlers de clique | `onclick="..."` inline no HTML | Removidos; tudo via `addEventListener` em `script.js` — permite uma CSP sem `unsafe-inline` |
| CSS/JS | Dentro do próprio `.html` | Arquivos separados (`style.css`, `script.js`) — permite CSP restritiva e cache mais eficiente |
| Eventos "curados" | Hardcoded no JS | Em `events.json` — dá pra atualizar sem tocar no código |
| SEO / compartilhamento | Nenhuma meta tag | `description`, Open Graph, `canonical` |
| Cabeçalhos de segurança | Nenhum | `_headers` com CSP, X-Frame-Options, Referrer-Policy etc. |

## Estrutura

Todos os arquivos ficam soltos na raiz do repositório (sem subpastas) —
mais simples de subir pelo GitHub no navegador, arquivo por arquivo:

```
/index.html      página (estrutura HTML)
/style.css        todo o CSS
/script.js         toda a lógica de front-end
/events.json        eventos/passeios/hospedagem/produtos "de catálogo"
/_headers            CSP e outros headers de segurança/cache
/_worker.js           lógica de servidor: /api/feed + /api/click
/wrangler.jsonc        diz à Cloudflare onde está o Worker e os assets
/.assetsignore          impede que _worker.js/wrangler.jsonc/README virem
                         arquivos públicos servidos pelo site
```

**Importante — o que aprendemos tentando publicar**: o fluxo "Upload
assets" (arrastar arquivos) do dashboard da Cloudflare serve **só
arquivos estáticos** — ele não executa nenhum código de servidor, nem
`_worker.js` nem a antiga pasta `/functions`. Testamos e confirmamos:
`/api/feed` deu 404 mesmo com o arquivo presente. Por isso o deploy
precisa ser feito conectando um repositório Git (abaixo), que usa o
pipeline de build de verdade da Cloudflare — esse sim executa o Worker.

## Deploy via GitHub (sem precisar de terminal)

1. Crie uma conta no [github.com](https://github.com) se ainda não tiver.
2. Crie um repositório novo (botão **New**), pode ser privado.
3. Nele, use **Add file → Upload files** e envie cada um dos arquivos
   listados acima (inclusive os que começam com `_` e `.` — `_worker.js`,
   `_headers`, `.assetsignore`) — tudo solto na raiz, sem pasta nenhuma.
   Se o seu navegador só deixar escolher arquivo por arquivo (sem manter
   pastas), sem problema: o projeto já está pensado pra isso. Clique em
   **Commit changes**.
4. No dashboard da Cloudflare: **Workers & Pages → Create application →
   Connect to Git** (em vez de "Upload assets").
5. Autorize o GitHub e selecione o repositório que você acabou de criar.
6. Nas configurações de build, a Cloudflare deve detectar o
   `wrangler.jsonc` automaticamente. Se pedir um "Build command", deixe
   em branco (não tem build — é código pronto).
7. Deploy. A partir daqui, qualquer mudança que você fizer nos arquivos
   pelo GitHub (editar direto na página do arquivo) gera um novo deploy
   automático — não precisa repetir esse processo.
8. Depois do primeiro deploy funcionando: **Custom domains** → aponte
   `borasp.tur.br`.
9. Para o rastreio de clique salvar de verdade: **Settings → Bindings**
   → crie um KV namespace → vincule com o nome **`CLICKS_KV`**.

## Como atualizar o conteúdo no dia a dia

- **Eventos "de vitrine" (afiliados, fixos)**: edite `events.json` e
  faça um novo deploy. É só um arquivo JSON, sem risco de quebrar o site.
- **Feed automático (RSS)**: edite o array `RSS_SOURCES` no topo de
  `_worker.js` para adicionar ou remover fontes. Cada fonte vira
  automaticamente um selo "novo" no card.

## Sobre a cobertura "underground" e diversidade de locais

Pesquisei fontes de agenda de SP e a cena underground (techno, house,
coletivos como Mamba Negra, D-EDGE, Batekoo etc.) **não publica RSS** —
ela vive quase toda em Instagram e Telegram. Isso significa que não dá
pra automatizar 100% essa parte sem um passo extra. Duas opções:

1. **RSS-Bridge** (ferramenta gratuita, auto-hospedável) gera um feed RSS
   a partir de perfis do Instagram — depois é só listar a URL gerada em
   `RSS_SOURCES` como qualquer outra fonte.
2. Manter uma curadoria manual leve em `events.json`, marcando
   `"moods": ["underground"]` — já que esse recorte se beneficia de
   julgamento humano sobre segurança e qualidade do evento antes de
   publicar (é o que o comentário original no código já sugeria).

Para fontes "oficiais" de diversidade de programação (cultura gratuita,
museus, feiras), vale considerar adicionar aos `RSS_SOURCES`:
agenda do Sesc, Itaú Cultural, Virada Cultural e a agenda oficial da
Prefeitura (spmaiscultura.prefeitura.sp.gov.br) — todas têm bastante
conteúdo gratuito e plural, o que ajuda a equilibrar com os eventos
pagos/afiliados.

## Rastreio de clique em afiliado (aferir retorno)

Todo card marcado como `"affiliate": true` (em `events.json` ou vindo
do RSS) agora passa por `/api/click` antes de sair pro site do parceiro
(Sympla, Booking, Amazon etc.), em vez de linkar direto.

**Correção importante**: no site original, os cards afiliados dos rails
secundários (Passeios, Arredores, Hospedagem, Achadinhos) mostravam o
texto "reservar"/"comprar", mas **não eram links de verdade** — não tinham
`href` nenhum. Isso foi corrigido: agora eles também geram clique
rastreável e vão pro parceiro.

**O que o clique registra**: seção, item, fonte, data/hora, país (via
Cloudflare) e um `subId` único, gravado num KV do Cloudflare — depois
anexado como parâmetro na própria URL de destino (`subid=`, ou `aid=`
pra Booking, `tag=` pra Amazon — ajustável em
`SUBID_PARAM_BY_HOST` dentro de `_worker.js`).

**Isso NÃO é lucro ainda** — é o clique no seu site. Pra saber o que virou
venda, você precisa casar esse `subId` com o relatório de conversão de
cada programa de afiliados (a maioria mostra o sub-ID/click-ID na própria
tela de relatórios). Comissão em R$ é informação que só cada programa tem.

**Setup necessário antes de funcionar** (uma vez só, no dashboard):
1. Cloudflare Pages → seu projeto → **Settings → Functions → KV namespace
   bindings**
2. Crie um namespace (ex: `bora_sp_clicks`)
3. Faça o bind com o nome de variável **`CLICKS_KV`**

Sem isso, os links ainda funcionam e redirecionam normalmente — só não
salvam o histórico de clique.

**Segurança**: `/api/click` só redireciona pra uma lista branca de
domínios de parceiros conhecidos (`ALLOWED_HOSTS` em `_worker.js`) — isso
existe pra impedir que alguém use seu domínio como redirecionador aberto
pra phishing. Se adicionar um novo programa de afiliados, inclua o
domínio dele nessa lista.

## Ainda vale considerar (não incluído nesta rodada)

- **Cloudflare Web Analytics**: gratuito, sem cookies, um `<script>` só.
  Dá pra ativar direto no dashboard da Cloudflare (Analytics → Web
  Analytics → Add site) sem mexer em código.
- **Imagens reais nos cards** de Passeios/Hospedagem/Produtos (hoje é só
  texto "IMG").
- **Painel simples pra ver os cliques salvos no KV** — hoje os dados
  ficam lá, mas não tem tela nenhuma pra visualizar; dá pra fazer depois
  uma página `/admin` protegida por senha, ou exportar via Wrangler CLI.
