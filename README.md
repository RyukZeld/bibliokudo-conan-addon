# Detective Conan (BiblioKudo) — Addon Stremio / Nuvio

Addon que scrapea [BiblioKudo](https://bibliokudo.wixsite.com/bibliokudo/dc-001-050) y expone episodios, películas, OVAs y especiales de **Detective Conan en español** en Stremio o Nuvio.

Repo: https://github.com/RyukZeld/bibliokudo-conan-addon

## Instalar (URL del manifest)

Pega esto en Stremio (Addons → Addon Repository URL) o en Nuvio:

```
https://wesley-spreading-threshold-forestry.trycloudflare.com/manifest.json
```

Health: https://wesley-spreading-threshold-forestry.trycloudflare.com/health

> Esa URL es un túnel Cloudflare hacia este Mac (Fly.io pide tarjeta para apps nuevas). Mientras el Mac esté encendido y el addon corriendo, funciona. Para hosting 24/7: conecta el repo a [Render](https://dashboard.render.com) (Blueprint `render.yaml`) o añade tarjeta en Fly y `fly deploy`.

## Catálogos

| Catálogo | Contenido |
|----------|-----------|
| **Biblioteca Conan** | Serie, Listas A–D, personajes, extras (canon/películas), arcos, OVAs. Filtros de género + destacados. Configurable. |
| **Películas Conan** | Cada película como `movie` |

Busca «Lista B», «Haibara», «Kid», «HdN», «canon»… Posters vía proxy del addon. Softsubs ES cuando existen.

Despliegue 24/7: ver [DEPLOY.md](DEPLOY.md).

## Streams (botones BiblioKudo)

- **Amarillo** (`#FFB703`) → streaming → prioridad (`BK streaming · Streamtape ▶`)
- **Azul** (`#24E5FF`) → descarga (`BK descarga · Fireload`)
- Streamtape se resuelve a `.mp4` reproducible; el resto se abre en el navegador
- MaxiSubs: contraseña `maxisubs`

## Desarrollo local

```bash
npm install
npm start   # http://127.0.0.1:7050/manifest.json
npm run dump -- --write   # rescrapea y guarda data/index.json
```

Health: `http://127.0.0.1:7050/health`

## Despliegue

- **Fly.io**: `fly.toml` + `Dockerfile` listos (`fly deploy`)
- **Render**: Blueprint en `render.yaml` (conecta el repo de GitHub)

La caché completa se refresca cada 12 h; las páginas recientes cada 1 h. El snapshot `data/index.json` permite responder al instante en arranques en frío.

## Notas

- Fuente no oficial (fansubs). Uso personal / educativo.
- Si Streamtape cambia su ofuscación, toca `src/resolvers/streamtape.js` (siempre hay fallback a enlace externo).
