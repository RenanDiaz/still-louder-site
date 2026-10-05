# Página de enlaces (`/links`, tipo Linktree)

> **Estado (4 oct 2026):** spec, sin implementar.
> Subsistema: **sitio principal** (repo root). No toca `ticket-system/`;
> solo enlaza a él.

## Problema

La bio de Instagram admite **un** enlace y hoy tenemos tres cosas que
empujar a la vez, con destinos distintos:

| Qué | Destino | Estado |
|---|---|---|
| Boletos Stratovarius (11 oct, Aurora at Soho) | Ticketplus (venta externa) | enlace listo |
| Entradas Still Louder's Halloween Party (31 oct, Hops) | `entradas.still-louder.com/halloween-party` | enlace listo, preventa abierta |
| Nuevo single **"A Las 10"** | plataformas de streaming | **se estrena el 5 oct 2026** (mañana); los enlaces llegan ese día |

El home ya tiene todo eso, pero está a dos o tres scrolls y con el peso de
una landing completa. Lo que la bio necesita es una página **ligera, de una
columna, con 3–5 botones grandes** que se abra rápido dentro del navegador de
Instagram/TikTok y que podamos editar sin depender de un servicio externo
(Linktree) ni pagar por quitar su marca.

## Decisiones tomadas

| # | Decisión | Valor |
|---|---|---|
| D1 | URL | **`https://still-louder.com/links`**, servida desde `public/links.html` como tercera entrada de Rollup en `vite.config.js` (mismo mecanismo que `al-vacio-pre-release` y el `/en` de `docs/features/i18n-main-site-en.md`). `cleanUrls` (Vercel) y `html_handling: auto-trailing-slash` (Cloudflare) ya la sirven sin barra y sin rewrites. La URL es **permanente**: va en bios, QR impresos y flyers, nunca se renombra. |
| D2 | Fuente de los enlaces | **El HTML es la fuente** (misma regla que `#shows`): los botones se escriben a mano en `links.html`. Las URLs deben ser las mismas que ya viven en `config.js` (`CONFIG.shows.upcoming.*.ticketsUrl`, `CONFIG.platforms.*`, `CONFIG.social.*`, `CONFIG.store.url`); no se agrega un `CONFIG.links` duplicado. Renderizar desde JS queda descartado: la página tiene que funcionar sin JS y los crawlers de WhatsApp no lo ejecutan. |
| D3 | Indexación | **`noindex, follow`**. Es una página utilitaria para la bio; indexarla solo le quitaría posiciones al home para "Still Louder". No va al `sitemap.xml`. Canonical a sí misma (`/links`) para que el `noindex` no se mezcle con el home. |
| D4 | Idioma | Solo español (igual que el resto). Si algún día existe `/en`, `/links` **no** se traduce: los botones son nombres propios y verbos de una palabra. |
| D5 | Estado del single sin enlace | Dos estados: **`pending`** (deshabilitado, "Próximamente", solo si la página sale antes de tener los enlaces) y **`live`**. **No hay estado de pre-save**: la canción no se subió al distribuidor con antelación y se estrena mañana, así que no habrá enlace de pre-guardado. Si la página se implementa el 5 oct o después, nace directamente en `live`. |
| D6 | Destino del single en `live` | `https://still-louder.com/#escuchar`, que ya lista todas las plataformas; si el distribuidor da un smart link después, se cambia el `href` (un commit). **Confirmado (5 oct):** se mantiene `/#escuchar` y **no** se enlaza directo al track de Spotify (`track/3Bt2Rd8QLuPCd1i4UtgPDn`, el de la tarjeta de `#escuchar`): el navegador in-app de Instagram no siempre abre la app de Spotify, y un enlace directo deja fuera a quien usa Apple Music, Deezer o Amazon. Costo aceptado: un salto extra y cargar el home. No se ponen cinco botones (uno por plataforma): la página es para decidir rápido. Cuando salga el video (≈ 31 oct) **no** se agrega otro botón: el video vive en `#escuchar`. |
| D7 | Orden de los botones | Por **urgencia**, no por importancia: lo que vence antes va primero, salvo el single la semana de su estreno. Del 5 oct en adelante: **A Las 10 → Stratovarius → Halloween**; pasado el 11 oct desaparece Stratovarius; después del 31 oct quedan el single y las redes. |
| D8 | Shows pasados | Cada botón de show lleva `data-expires` (ISO con offset, el final del evento). Un módulo pequeño lo oculta al cargar si ya pasó, para que nadie vea "Comprar boletos" de un show de ayer si no se alcanzó a editar. El HTML se limpia igual en el siguiente cambio. |
| D9 | Diseño | Reutiliza `variables.css` (misma paleta y tipografía que el home) con una hoja propia **`public/assets/css/links.css`**, no `style.css` (33 KB de los que la página usaría un 5 %). Fondo: la portada del single vigente, desenfocada y oscurecida (mismo recurso que `docs/features/nuevo-single.md` usa para el hero). |
| D10 | Analytics | Un solo evento GA4 `click_link` con `event_label` = `data-link` del botón (`stratovarius_tickets`, `halloween_tickets`, `single_listen`, `instagram`, `store`, `site`). Tráfico de la bio se distingue con UTM en el enlace que se pega en Instagram: `/links?utm_source=instagram&utm_medium=bio`. |

## Alcance (v1)

1. `public/links.html`: página de una columna con cabecera, botones
   principales, fila de redes y pie.
2. `public/assets/css/links.css`: estilos propios, mobile-first.
3. `public/assets/js/links.js`: analytics (`click_link`) + ocultar
   expirados (`data-expires`). Importa `analytics.js` y `config.js`; nada más.
4. Entrada en `vite.config.js`, regla de caché en `public/assets/_headers`,
   `noindex` y meta OG propios.
5. Checklist operativo para cambiar el estado del single y limpiar shows.

## Contenido y estructura

```
┌──────────────────────────────┐
│  [símbolo SL]                │  still_louder_simbolo.svg, 72px
│  Still Louder                │  h1, Bebas Neue
│  Rock · David, Chiriquí      │  una línea, text-secondary
├──────────────────────────────┤
│ ▶ Stratovarius en Panamá     │  botón: título + sublínea
│   11 oct · Aurora at Soho    │  "Boletos en Ticketplus"
├──────────────────────────────┤
│ ▶ Halloween Party            │  botón DESTACADO (venta propia)
│   31 oct · Hops, David       │  "Preventa $10 · entradas.still-louder.com"
├──────────────────────────────┤
│ ★ Escucha «A Las 10»         │  botón DESTACADO desde el 5 oct
│   Nuevo sencillo             │  (antes: pending "Próximamente")
├──────────────────────────────┤
│  ◎ IG  ◎ TikTok  ◎ YT  ◎ Tienda │ fila de iconos
├──────────────────────────────┤
│  still-louder.com →          │  enlace al home
└──────────────────────────────┘
```

Reglas:

- Máximo **5 botones principales**. Si hay que agregar un sexto, se quita uno.
- Cada botón es un `<a>` (o `<span>` en `pending`) con `data-link`, `aria-label`
  completo ("Comprar boletos para Stratovarius en Panamá en Ticketplus, se
  abre en nueva ventana"), `target="_blank" rel="noopener noreferrer"` para
  destinos externos (Ticketplus, plataformas, redes). El de entradas propias
  también abre en nueva pestaña: es otro origen.
- El botón destacado (`.links-card--featured`) es **uno solo**: el single
  mientras sea novedad (D7); si la página sale antes del 5 oct, mientras tanto
  lo es Halloween (venta propia).
- Estados del single, por clase y atributos:

| Estado | Marcado | Texto |
|---|---|---|
| `pending` | `<span class="links-card links-card--pending" aria-disabled="true">` | "A Las 10 · Próximamente" |
| `live` | `<a href="https://still-louder.com/#escuchar" class="links-card links-card--featured" data-link="single_listen">` | "Escucha «A Las 10»" |

- Sin JS la página es completa: todos los enlaces funcionan; lo único que se
  pierde es ocultar shows vencidos y el tracking.

### `<head>`

- `<title>Still Louder · Enlaces</title>`, `meta description` corta.
- `<meta name="robots" content="noindex, follow">` (D3).
- `<link rel="canonical" href="https://still-louder.com/links">`.
- OG/Twitter propios: `og:type=website`, `og:title` "Still Louder · Enlaces",
  `og:image` = la **misma portada del single vigente que usa el home**
  (cuadrada, ≥ 600 px); así cuando alguien pega `/links` en WhatsApp sale el
  arte actual sin generar otro asset. Cambia cuando cambia el single
  (`docs/features/nuevo-single.md`, checklist).
- Misma fuente de Google Fonts que el home (ya precacheada por el SW), favicon
  y `theme-color` iguales a `index.html`.
- GA4: `analytics.js` **no** inyecta gtag, solo comprueba
  `typeof gtag === 'function'`; `links.html` lleva el mismo snippet de
  `googletagmanager.com/gtag/js` que `index.html` (ya permitido por el CSP).

### Estilos (`links.css`)

- `@import url('./variables.css')`. Nada de valores sueltos.
- Columna centrada, `max-width: 480px`, `padding: var(--spacing-xl) var(--section-padding-x)`.
- Fondo: `.links-bg` con la portada (`image-set` AVIF/WebP, como `.hero-bg`
  de `style.css`), `filter: blur(28px) brightness(0.35) saturate(0.8)`,
  `transform: scale(1.3)` para que el blur no deje bordes, y un overlay con
  `--gradient-hero`. En `prefers-reduced-motion` no hay animaciones de
  entrada; el blur es estático y se mantiene.
- Botón: `glass` (`--glass-bg`, `--glass-border`), `min-height: 64px`,
  radio `--border-radius-lg`, título en `--font-size-md` semibold y sublínea
  en `--font-size-sm` `--color-text-secondary`. Destacado: borde y glow con
  `--color-accent` / `--shadow-glow`. `pending`: opacidad 0.6, `cursor: default`,
  sin hover.
- Foco visible (`outline: 3px solid var(--color-accent)`, igual que el home).
- Contraste AA: texto sobre el fondo oscurecido usa `--color-text-primary`;
  el acento como texto usa `--color-accent-text`, nunca `--color-accent`.

### Script (`links.js`)

```js
import { CONFIG } from './config.js';
import analytics from './analytics.js';

const now = Date.now();
document.querySelectorAll('[data-expires]').forEach((card) => {
  if (new Date(card.dataset.expires).getTime() < now) {
    card.hidden = true;
  }
});

document.querySelectorAll('[data-link]').forEach((link) => {
  link.addEventListener('click', () => {
    analytics.trackEvent('click_link', {
      event_category: 'links',
      event_label: link.dataset.link
    });
  });
});
```

Cargado con `<script type="module" src="/assets/js/links.js">` para que Vite
lo empaquete (regla de CLAUDE.md). ~1 KB; no comparte nada con `main.js`.

## Configuración y despliegue

| Archivo | Cambio |
|---|---|
| `vite.config.js` | `input.links: '/links.html'`. |
| `public/assets/_headers` | Regla `/links` → `Cache-Control: public, max-age=0, must-revalidate` (las páginas se listan una por una, ver comentario del archivo). `vercel.json` no cambia: `/:path*.html` ya cubre la página. |
| `public/assets/sw.js` | **No** se precachea `/links` (es una página de paso; `addAll` es todo o nada y no queremos que un 404 tumbe la instalación). El runtime cache la toma en network-first como cualquier HTML. Sin bump de `CACHE_VERSION`. |
| `public/assets/sitemap.xml` / `robots.txt` | Sin cambios (D3). |
| `scripts/check-dist.js` | Sin cambios: ya recorre todos los `dist/*.html` y valida `<script src>` y `<link href>`. |
| CSP | Sin cambios: la página no carga nada que el home no cargue ya. |
| `CLAUDE.md`, `docs/README.md`, `docs/main-site/seo-accessibility.md` | Estructura del proyecto, índice, y una nota en 1.3/1.4 de que `/links` es `noindex` y cambia su `og:image` con el single. |

Si `docs/features/i18n-main-site-en.md` se implementa después, su
`check-i18n.js` compara solo `index.html` con `en.html`; `links.html` no
participa (D4).

## Analytics

| Evento | Cuándo | Parámetros |
|---|---|---|
| `click_link` | Click en cualquier `[data-link]` | `event_category: 'links'`, `event_label: <data-link>` |

Valores de `data-link`: `stratovarius_tickets`, `halloween_tickets`,
`single_listen`, `instagram`, `tiktok`, `youtube`, `store`,
`site`. Mismo estilo que `click_shows` en el home para que los reportes se
lean juntos.

## Criterios de aceptación

**Build y servido**

- **CA-1** `npm run build` produce `dist/links.html`; `npm run check:dist`
  pasa; `npm run validate` pasa (incluye `links.js` y `links.css` en los
  globs de lint/format).
- **CA-2** `/links` responde 200 en `npm run preview` **y** en
  `npm run preview:cloudflare`; `/links/` redirige a `/links`; la respuesta
  trae `Cache-Control: public, max-age=0, must-revalidate` y el CSP del sitio.
- **CA-3** `dist/sitemap.xml` **no** contiene `/links`; la página tiene
  `noindex, follow` y canonical propio.

**Contenido**

- **CA-4** Los `href` de los botones de shows coinciden carácter a carácter
  con `CONFIG.shows.upcoming.stratovarius.ticketsUrl` y
  `CONFIG.shows.upcoming.oct31.ticketsUrl` (comprobable con `grep`).
- **CA-5** Con JS deshabilitado todos los enlaces funcionan y el botón
  `pending` no es enfocable ni clickeable.
- **CA-6** Adelantando el reloj del navegador más allá de `data-expires` de
  Stratovarius, su botón desaparece al cargar; el resto queda.
- **CA-7** Pegar `https://still-louder.com/links` en WhatsApp o en el
  [Sharing Debugger](https://developers.facebook.com/tools/debug/) muestra
  "Still Louder · Enlaces" con la portada vigente.

**Diseño y accesibilidad**

- **CA-8** En un viewport de 360 px no hay scroll horizontal y los 3–5
  botones principales caben sin scroll vertical en un teléfono de 640 px de
  alto (la fila de redes puede quedar debajo del pliegue).
- **CA-9** Lighthouse móvil: Performance ≥ 95, Accessibility 100. La página
  pesa < 150 KB transferidos (sin contar la portada, que llega en AVIF/WebP y
  es la misma que ya cachea el home).
- **CA-10** Tab recorre los botones en orden visual, el foco es visible y
  cada botón anuncia destino y "se abre en nueva ventana" en VoiceOver/TalkBack.
- **CA-11** Dentro del navegador in-app de Instagram (iOS y Android) los
  enlaces externos abren y el de entradas llega a `/halloween-party` con la
  preventa visible.

## Flujo operativo

**Publicar la página**

1. Implementar, mergear a `main`, verificar CA-2 y CA-7 en producción.
2. Pegar en la bio de Instagram y TikTok:
   `https://still-louder.com/links?utm_source=instagram&utm_medium=bio`
   (cambiar `utm_source` por red).
3. Si hay QR impreso, que apunte a `/links` **sin** UTM.

**Estado del single** (cada paso es un commit `feat(links): …`)

1. Si la página sale el 5 oct o después, nace en `live`: `href` a
   `/#escuchar`, texto "Escucha «A Las 10»", `data-link="single_listen"`,
   clase `--featured`, primer lugar (D7). Es el caso esperado.
2. Si saliera antes, nace en `pending` y el 5 oct se hace el cambio anterior.
3. El cambio de era del home (`docs/features/nuevo-single.md`) y esta página
   comparten la portada de fondo y el `og:image`: si coinciden en fecha, van
   en el **mismo PR**.

**Después de un show**

1. El botón ya está oculto por `data-expires` (D8).
2. En el siguiente cambio que se haga a la página, borrar el botón del HTML.

## Fuera de alcance

- Editar los enlaces sin commit (CMS, panel). La página cambia 3–4 veces al
  mes como mucho; `main` es el panel.
- Más de una página de enlaces (p. ej. una por show). Los QR de un evento
  apuntan directo a `entradas.still-louder.com/<slug>`.
- Versión en inglés (D4).
- Contador de clicks visible o acortador propio: GA4 ya lo cubre.
- Un `og:image` compuesto (1200×630) propio de `/links`; se reutiliza la
  portada (ver `<head>`). Si WhatsApp recorta mal, se revisa aquí.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un botón queda apuntando a una URL vieja (cambia el enlace de Ticketplus, el slug de un evento) | CA-4: las URLs se copian de `config.js`, que es lo que ya se mantiene. Si vuelve a pasar, agregar a `check-dist.js` (o un `check-links.js`) la comparación `links.html` ↔ `config.js`. |
| Cambiar la portada del fondo sin cambiar el `og:image` (o al revés) | Checklist de `docs/features/nuevo-single.md` lista `links.html` explícitamente. |
| Instagram cachea la vista previa de la bio | La bio no muestra preview; WhatsApp sí: pasar la URL por el Sharing Debugger tras cambiar la portada. |
| El símbolo SL (`still_louder_simbolo.svg`, 17 KB) y la fuente display retrasan el primer render | Ambos ya están en caché si el usuario vino del home; si no, el SVG es inline-able (`assetsInlineLimit` es 4 KB, así que va como archivo, con `fetchpriority="high"`). |

## Preguntas abiertas

- ¿Se quiere el botón de **Tienda** (Cuanto) entre los principales o basta
  con el icono en la fila de redes? El spec lo deja en la fila.
- Tras el 31 de octubre quedan solo el single y las redes: ¿se agrega
  "Comunicados" (`docs/features/comunicados.md`) cuando exista, o la página
  se queda en 1–2 botones hasta la próxima fecha?
