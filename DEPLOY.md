# Deploy 24/7 (dejar el túnel Cloudflare)

## Producción actual (Cloud Run)

```
https://bibliokudo-conan-1079186437265.us-east1.run.app/manifest.json
```

Proyecto GCP: `glaze-music` · región `us-east1` · servicio `bibliokudo-conan`

Redeploy:

```bash
IMG=us-east1-docker.pkg.dev/glaze-music/bibliokudo/conan:latest
gcloud builds submit --tag "$IMG" --project=glaze-music
gcloud run deploy bibliokudo-conan --project=glaze-music --region=us-east1 \
  --image="$IMG" --allow-unauthenticated --port=8080 \
  --update-env-vars=PUBLIC_URL=https://bibliokudo-conan-1079186437265.us-east1.run.app
```

## Render (alternativa)

1. Conecta el repo `RyukZeld/bibliokudo-conan-addon` en [Render](https://dashboard.render.com).
2. Usa el Blueprint [`render.yaml`](render.yaml) o crea un **Web Service**:
   - Build: `npm install`
   - Start: `npm start`
   - Health: `/health`
3. Tras el primer deploy, define:
   - `PUBLIC_URL` = `https://<tu-servicio>.onrender.com`
4. En Nuvio/Stremio instala: `https://<tu-servicio>.onrender.com/manifest.json`

> En el plan free Render duerme tras inactividad; el primer hit puede tardar ~30s.

## Fly.io

```bash
fly launch   # o fly deploy si ya existe la app en fly.toml
fly secrets set PUBLIC_URL=https://bibliokudo-conan.fly.dev
fly deploy
```

Requiere cuenta Fly con método de pago para apps nuevas en algunas regiones.

## Local + túnel (desarrollo)

```bash
PUBLIC_URL=https://….trycloudflare.com PORT=7050 npm start
cloudflared tunnel --url http://127.0.0.1:7050
```
