# Detective Conan (BiblioKudo) — Addon Stremio / Nuvio

Addon que scrapea [BiblioKudo](https://bibliokudo.wixsite.com/bibliokudo/dc-001-050) y expone episodios, películas, OVAs y especiales de **Detective Conan en español** en Stremio o Nuvio.

Repo: https://github.com/RyukZeld/bibliokudo-conan-addon

## Instalar (URL del manifest)

Pega esto en Stremio (Addons → Addon Repository URL) o en Nuvio:

```
https://bibliokudo-conan-1079186437265.us-east1.run.app/manifest.json
```

Health: https://bibliokudo-conan-1079186437265.us-east1.run.app/health

> Hosting 24/7 en **Google Cloud Run** (proyecto `glaze-music`). El primer hit tras inactividad puede tardar unos segundos (cold start).

## Catálogos

| Catálogo | Contenido |
|----------|-----------|
| **Biblioteca Conan** | Listas A–D → Películas → Especiales/OVAs (con covers). |
| **Películas Conan** | Cada película como `movie` |

Busca «Lista B», «películas», «ovas»… Posters vía proxy. Softsubs ES cuando existen.

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
