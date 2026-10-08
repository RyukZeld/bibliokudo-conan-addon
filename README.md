# Detective Conan (BiblioKudo) — Addon Stremio / Nuvio

Addon que scrapea [BiblioKudo](https://bibliokudo.wixsite.com/bibliokudo/dc-001-050) y expone episodios, películas, OVAs y especiales de **Detective Conan en español** dentro de Stremio o Nuvio.

Los enlaces se actualizan solos (caché completa cada 12 h; páginas recientes cada 1 h).

## Catálogos

| Catálogo | Contenido |
|----------|-----------|
| **Detective Conan (ES)** | Anime (temp. 1, caps. 1…12xx) + OVAs/especiales (temp. 0) |
| **Detective Conan Películas** | Cada película como título `movie` |

## Streams

En BiblioKudo los botones **BK** vienen en dos colores:
- **Amarillo** (`#FFB703`) → streaming (prioridad en el addon; suele ser Streamtape)
- **Azul/cian** (`#24E5FF`) → descarga (Fireload / Terabox / etc.)

El addon etiqueta y prioriza el amarillo. Streamtape se resuelve a un `.mp4` reproducible; el resto se abre en el navegador. MaxiSubs: contraseña `maxisubs`.

## Desarrollo local

```bash
npm install
npm run dump -- --write   # scrapea todo y guarda data/index.json
npm start                 # http://127.0.0.1:7050/manifest.json
```

Solo estadísticas (sin snapshot completo):

```bash
npm run dump
```

## Instalar en Stremio

1. Arranca el addon (local o en Render).
2. En Stremio → Addons → “Addon Repository URL”.
3. Pega: `http://127.0.0.1:7050/manifest.json` (local) o `https://TU-APP.onrender.com/manifest.json`.

## Instalar en Nuvio

1. Despliega el addon con URL pública (Render free).
2. En Nuvio → Addons → añade la URL del `manifest.json`.

## Despliegue en Render (gratis)

1. Sube este repo a GitHub.
2. En [Render](https://render.com) → **New** → **Blueprint** (usa `render.yaml`) o **Web Service**:
   - Build: `npm install`
   - Start: `npm start`
3. Copia la URL → `https://<servicio>.onrender.com/manifest.json`.

> El plan free se duerme tras ~15 min sin tráfico: la primera petición puede tardar 30–50 s. El snapshot `data/index.json` (si lo commiteas tras `npm run dump -- --write`) sirve contenido inmediato mientras se refresca.

## Notas

- Fuente no oficial (fansubs). Uso personal / educativo.
- Si Streamtape cambia su ofuscación, el resolver en `src/resolvers/streamtape.js` es el único punto a tocar (siempre hay fallback a enlace externo).
