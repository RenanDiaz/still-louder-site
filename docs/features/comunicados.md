# Comunicados oficiales

> **Estado (3 oct 2026):** spec, sin implementar.
> Subsistema: **sitio principal** (repo root). No toca `ticket-system/`.

## Problema

Cuando la banda tiene algo oficial que decir (cambio de fecha o cancelación de
un show, cambio de integrantes, un posicionamiento público), hoy solo existe
el post de Instagram: no se puede citar, no tiene una URL estable propia y la
prensa o quien compró entrada no tiene un lugar canónico al cual ir. El sitio
debe ser **la fuente oficial y enlazable** de esos comunicados.

**No es un blog ni un feed de noticias.** Las novedades casuales siguen en
redes. Si una pieza no es algo que la banda firmaría como "comunicado
oficial", no va aquí.

## Decisiones tomadas

| # | Decisión | Valor |
|---|---|---|
| D1 | Quién publica | **Solo Renan**, vía commit a `main` (directo o con un agente). Sin CMS, sin panel, sin backend. |
| D2 | Idioma | **Solo español** mientras el sitio no esté localizado. Sin campos de idioma; la localización será otro spec. |
| D3 | Fuente del contenido | Un archivo Markdown con front matter por comunicado, en `content/comunicados/`. |
| D4 | Render | **Estático, al hacer el build**: cada comunicado es un HTML real con sus propias meta OG. Los crawlers de WhatsApp/Facebook/X no ejecutan JS, así que renderizarlo en el cliente (como `CONFIG.shows`) no sirve. |
| D5 | Inmutabilidad | Un comunicado publicado **no se borra ni cambia de slug**. Las correcciones se agregan como sección "Actualización" con fecha y se refleja `updated` en el front matter. |
| D6 | Relación con el ticket system | **Ninguna automática.** Si un comunicado afecta un evento, se enlaza a mano desde `/entradas` (copy del evento) o desde el correo. Las apps despliegan por separado y acoplarlas no vale la pena para algo tan ocasional. |
| D7 | Navegación | Enlace "Comunicados" en el **footer** y en el banner del home, **no** en el header (ya tiene 7 ítems y los comunicados son esporádicos). |
| D8 | RSS / feed | Fuera de alcance para v1 (ver "Fuera de alcance"). |

## Alcance (v1)

1. Página por comunicado: `https://still-louder.com/comunicados/<slug>`.
2. Página índice: `https://still-louder.com/comunicados` (lista cronológica, el más nuevo primero).
3. Banner en el home para el comunicado fijado (`pinned`) vigente.
4. Entradas en `sitemap.xml` generadas en el build.
5. Validación estricta del contenido en el build: un comunicado mal formado **rompe el build**.

## Formato del contenido

Ubicación: `content/comunicados/<slug>.md` en la raíz del repo, **fuera** de
`public/` para que Vite no lo copie a `dist/`. El nombre del archivo **es** el
slug (`[a-z0-9]+(-[a-z0-9]+)*`). Los archivos que empiezan con `_` se ignoran
(ahí vive `_plantilla.md`).

```markdown
---
title: Cambio de fecha del show en David
date: 2026-10-15T18:00:00-05:00
summary: El show del 31 de octubre en Hops se mueve al 7 de noviembre. Las entradas compradas siguen siendo válidas.
image: /images/comunicados/cambio-de-fecha.jpg   # opcional
pinned: true                                     # opcional, default false
pin_until: 2026-11-08T00:00:00-05:00             # obligatorio si pinned
updated: 2026-10-16T10:00:00-05:00               # opcional; solo con una Actualización
draft: false                                     # opcional; true = no se publica
---

Texto del comunicado en Markdown.

## Actualización — 16 de octubre de 2026

...
```

| Campo | Req. | Reglas de validación |
|---|---|---|
| `title` | sí | 1–90 caracteres. Va a `<title>`, `<h1>` y `og:title`. |
| `date` | sí | ISO 8601 **con offset** (`-05:00`). Ni futuro lejano ni sin zona. |
| `summary` | sí | 50–200 caracteres, texto plano. Va a `meta description`, `og:description`, el índice y el banner. |
| `image` | no | Ruta root-relative a un archivo que exista en `public/assets/images/comunicados/` (se sirve en `/images/comunicados/…`). JPG/PNG, 1200×630 recomendado. Sin imagen se usa la og:image por defecto del sitio. |
| `pinned` | no | Booleano. |
| `pin_until` | si `pinned` | ISO con offset, posterior a `date`. |
| `updated` | no | ISO con offset, posterior a `date`. Si existe, el cuerpo debe tener al menos un `## Actualización`. |
| `draft` | no | Booleano. `true` = se renderiza en `npm run dev` pero **no** en `npm run build`. |

Más reglas del build:

- Slug duplicado, campo desconocido, fecha inválida, imagen inexistente o
  **HTML crudo en el cuerpo** → error con nombre de archivo y campo, y exit ≠ 0.
  El HTML crudo se prohíbe para no meter estilos inline ni scripts (convención
  del repo y CSP).
- **Más de un comunicado fijado y vigente a la vez** → warning (no error);
  el banner muestra el de `date` más reciente.
- **Cero comunicados publicados** → no se generan `/comunicados` ni el enlace
  del footer (no queremos un índice vacío).

## Arquitectura

### Generación

Un plugin local de Vite (`scripts/comunicados/plugin.js`, registrado en
`vite.config.js`) se encarga de:

1. **Hook `config`** (corre antes de resolver los inputs, en dev y en build):
   lee y valida `content/comunicados/*.md`, escribe en `public/comunicados/`
   un `<slug>.html` por comunicado más `public/comunicados.html` (el índice)
   desde una plantilla, y agrega esas rutas a `build.rollupOptions.input`.
   Vite las procesa igual que `index.html`: CSS y JS con hash, sin rutas que
   se rompan.
2. **Hook `transformIndexHtml`** (solo `index.html`): inyecta el banner del
   comunicado fijado vigente (ver abajo) y el enlace del footer.
3. **Hook `closeBundle`**: agrega a `dist/sitemap.xml` un `<url>` por
   comunicado (`lastmod` = `updated` ?? `date`) y otro para el índice.
4. **Dev**: `configureServer` observa `content/comunicados/`; al cambiar un
   archivo regenera el HTML y fuerza un full reload.

`public/comunicados/` y `public/comunicados.html` son **generados**: van en
`.gitignore` y `.prettierignore` (si no, `npm run format:check` revisaría
archivos generados). La plantilla vive en `scripts/comunicados/template.html`,
fuera del root de Vite.

Dependencias nuevas, **solo devDependencies** (el bundle del cliente no crece):
`marked` (Markdown → HTML) y `gray-matter` (front matter). El texto que
renderiza `marked` se escapa a nivel de nodos; los nodos `html` se rechazan.

### Rutas y hosting

- Vite emite `dist/comunicados/<slug>.html` y `dist/comunicados.html`.
  `html_handling: auto-trailing-slash` (Cloudflare) los
  sirven en `/comunicados/<slug>` y `/comunicados`. **No** crear
  `dist/comunicados/index.html`: con `comunicados.html` al lado, la resolución
  de `/comunicados` sería ambigua.
- **CSP sin cambios**: todo es `'self'`. Si la implementación necesita tocar
  headers, se cambian en `public/assets/_headers`.
- Service worker sin cambios: los HTML ya van network-first, así que un
  comunicado nuevo aparece en cuanto hay red. Los comunicados **no** se agregan
  a `PRECACHE_URLS`.

### Plantilla de la página

- Mismo `<head>` base que `index.html` (fuentes, `variables.css` +
  `style.css`, GA4, favicon, manifest) más:
  - `<title>{title} | Comunicado oficial | Still Louder</title>`
  - `meta description` = `summary`; `<link rel="canonical">` absoluto.
  - `og:type=article`, `og:title`, `og:description`, `og:url`, `og:image`
    (absoluta), `og:locale=es_PA`, `article:published_time`,
    `article:modified_time` (si hay `updated`), y las equivalentes `twitter:*`.
  - JSON-LD `Article` con `headline`, `datePublished`, `dateModified`, `image`
    y `author`/`publisher` = el `MusicGroup` Still Louder (mismo `@id` que el
    JSON-LD del home).
- Cuerpo: header y footer del sitio, con los enlaces del nav apuntando a
  `/#seccion` en vez de `#seccion`. Encabezado "Comunicado oficial", `<h1>`,
  `<time datetime>` con la fecha en formato largo en español
  ("15 de octubre de 2026"), "Actualizado el …" si aplica, el cuerpo y un
  botón Compartir (Web Share API con fallback a copiar, reutilizando
  `share.js`). Al final, enlace "Todos los comunicados".
- JS: un entry nuevo `public/assets/js/comunicados.js` que solo inicializa lo
  necesario (menú móvil, compartir, analytics, registro del SW). **No** carga
  `main.js` entero (countdown de shows, formulario, parallax). Lo que se
  comparta con `main.js` (p. ej. `initMobileMenu`) se extrae a un módulo,
  sin duplicarlo.
- El header y el footer quedan **duplicados** entre `index.html` y la
  plantilla. Es deuda aceptada para v1 (ver "Riesgos").

### Banner en el home

- Se renderiza en el HTML del home al hacer el build (lo ven los crawlers y
  funciona sin JS), justo debajo del header y antes del hero:
  `<aside class="comunicado-banner" aria-label="Comunicado oficial" data-slug data-pin-until>`
  con la etiqueta "Comunicado oficial", el `title`, el `summary` y un enlace
  "Leer comunicado".
- **Caducidad en el cliente**: como el HTML solo cambia en cada deploy, un
  script pequeño quita el banner cuando `Date.now() > pin_until`. Sin JS el
  banner se queda hasta el siguiente deploy: es el fallo aceptable (mejor un
  aviso viejo que no ver uno de cancelación).
- **Descartable**: botón ✕ (`aria-label="Cerrar comunicado"`) que guarda
  `comunicado-dismissed:<slug>` en `localStorage`, con try/catch. Si el
  storage falla, el banner sigue funcionando y solo pierde la memoria. Un
  slug nuevo vuelve a aparecer.
- **No** `role="alert"`: se anunciaría en cada carga del lector de pantalla.
- Estilos con tokens de `variables.css` y BEM (`.comunicado-banner__title`,
  etc.); respeta `prefers-reduced-motion`.

### Analytics

Usando `analytics.trackEvent`:

| Evento | Cuándo | Parámetros |
|---|---|---|
| `click_comunicado_banner` | Click en "Leer comunicado" del banner | `event_label: <slug>` |
| `dismiss_comunicado_banner` | Click en ✕ | `event_label: <slug>` |
| `share` (existente) | Botón compartir en la página | `content_type: 'comunicado'`, `item_id: <slug>` |

## Criterios de aceptación

**Contenido y build**

- **CA-1** Con un `.md` válido en `content/comunicados/`, `npm run build`
  produce `dist/comunicados/<slug>.html` y `dist/comunicados.html`, y
  `npm run check:dist` pasa.
- **CA-2** Cada violación de la tabla de validación (campo requerido ausente,
  fecha sin offset, `pinned` sin `pin_until`, imagen inexistente, slug
  duplicado, HTML crudo, campo desconocido) hace fallar `npm run build` con un
  mensaje que nombra el archivo y el campo.
- **CA-3** Un comunicado con `draft: true` aparece en `npm run dev` y **no**
  aparece en `dist/` ni en el sitemap.
- **CA-4** Sin comunicados publicados, el build pasa, no existe
  `dist/comunicados.html` y el footer no tiene el enlace.
- **CA-5** `npm run validate` pasa con y sin archivos generados presentes en
  `public/comunicados/`.

**Página**

- **CA-6** `/comunicados/<slug>` responde 200 en `npm run preview` **y** en
  `npm run preview:cloudflare`; `/comunicados/<slug>/` redirige a la versión
  sin barra.
- **CA-7** Pegar la URL en el [Sharing Debugger de Facebook](https://developers.facebook.com/tools/debug/)
  (o en WhatsApp) muestra el `title`, el `summary` y la imagen del comunicado,
  no los del home.
- **CA-8** El JSON-LD pasa el [Rich Results Test](https://search.google.com/test/rich-results)
  sin errores.
- **CA-9** Sin errores en consola; el menú móvil y Compartir funcionan; los
  enlaces del nav llevan a la sección correcta del home.

**Índice y banner**

- **CA-10** `/comunicados` lista todos los publicados, el más nuevo primero,
  con fecha, título y resumen; cada ítem enlaza a su página.
- **CA-11** Con un comunicado fijado y vigente, el home muestra el banner;
  después de `pin_until` (probado adelantando el reloj) desaparece sin
  redeploy; después de ✕ no vuelve a salir en ese navegador; si sale un slug
  nuevo, vuelve a aparecer.
- **CA-12** El banner se puede operar con teclado (Tab llega al enlace y al ✕,
  Enter los activa) y lo anuncia el lector como región "Comunicado oficial".

**Mantenimiento**

- **CA-13** `check:dist` (o un check nuevo) falla si el `og:image` de un
  comunicado apunta a un archivo local que no existe en `dist/`.
- **CA-14** El sitemap de `dist/` contiene las URLs del home, de
  `al-vacio-pre-release`, de `/comunicados` y de cada comunicado.
- **CA-15** `CLAUDE.md` (estructura del proyecto + sección "Comunicados"),
  `docs/README.md` y `docs/main-site/seo-accessibility.md` se actualizan en
  el mismo cambio.

## Cómo publicar (flujo operativo)

1. Copiar `content/comunicados/_plantilla.md` a `content/comunicados/<slug>.md`.
   El slug es definitivo: elegirlo bien.
2. Si lleva imagen: 1200×630 en `public/assets/images/comunicados/`.
3. `npm run dev` → revisar `/comunicados/<slug>` y el banner.
4. `npm run build && npm run check:dist`.
5. Commit `feat(comunicados): <título corto>` → `main` → deploy automático.
6. Pasar la URL por el Sharing Debugger de Facebook para que se refresque la
   vista previa antes de difundirla.
7. Si afecta un evento del ticket system: enlazarlo a mano (D6).

Para **actualizar**: agregar `## Actualización — <fecha>` al final del cuerpo
y el campo `updated`; nunca reescribir el texto original.

## Fuera de alcance

- CMS, panel de edición o publicación por gente de la banda (D1). Si eso
  cambia, es otro spec (CMS headless o un formulario en el panel admin).
- Localización (D2).
- RSS/Atom. Es barato de agregar en el mismo plugin si lo pide la prensa.
- Notificaciones push o por correo a fans.
- Mostrar comunicados en `entradas.still-louder.com` (D6).
- Comentarios, reacciones, categorías o etiquetas.
- Comunicados que sean solo una imagen: el texto es obligatorio por
  accesibilidad y SEO; la imagen es complementaria.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El header/footer de la plantilla se desfasa del de `index.html` | CA-15 + revisar la plantilla al cambiar la navegación. Si se repite, extraer los parciales a un include que el plugin inyecte en las dos páginas. |
| El banner se queda tras `pin_until` en navegadores sin JS | Aceptado (ver "Caducidad en el cliente"). |
| Caché de vista previa de WhatsApp/Facebook después de corregir un comunicado | Paso 6 del flujo; si cambia la imagen, usar un nombre de archivo nuevo. |
| Un comunicado urgente depende de que el deploy esté sano | El build valida en local (paso 4); si algo sale mal en producción, se vuelve a la versión anterior del Worker (`wrangler rollback`). |
