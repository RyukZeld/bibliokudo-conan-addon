# Detective Conan (BiblioKudo) — Addon Stremio / Nuvio

Addon que scrapea [BiblioKudo](https://bibliokudo.wixsite.com/bibliokudo/dc-001-050) y expone episodios, películas, OVAs y especiales de **Detective Conan en español** en Stremio o Nuvio.

Repo: https://github.com/RyukZeld/bibliokudo-conan-addon

## Instalar (URL del manifest)

```
https://TU-HOST/manifest.json
```

En Stremio → Addons → “Addon Repository URL”, o en Nuvio → Addons.

## Catálogos

| Catálogo | Contenido |
|----------|-----------|
| **Detective Conan (ES)** | Anime (temp. 1, caps. 1…12xx) + OVAs/especiales (temp. 0) |
| **Detective Conan Películas** | Cada película como `movie` |

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
