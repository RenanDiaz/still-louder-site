# Main site en inglés (`/en`)

> Subsistema: **main site** (raíz del repo). El ticket system (`ticket-system/`)
> queda **fuera de alcance** y sigue solo en español.

## Estado: propuesto (3 oct 2026)

## Contexto y objetivo

El público que no habla español hoy no tiene cómo leer el sitio: oyentes de
afuera (Spotify/YouTube) y **prensa** o bookers internacionales. No compran
entradas por nuestro sistema (el pago es solo Yappy, de Panamá) y por eso no
justifica traducir el ticket system.

Objetivo: una versión en inglés del landing (`index.html`), indexable,
enlazable directamente (para mandarla a prensa) y que se mantenga sincronizada
con la versión en español sin esfuerzo manual de memoria.

### No-objetivos

- Traducir `ticket-system/` (`/entradas`, `/ayuda`, emails, Wallet).
- Traducir `al-vacio-pre-release.html` (legacy).
- Traducir los comunicados (`docs/features/comunicados.md`, D2). Ver Decisión 7
  para cómo se muestran en `/en`.
- Detección automática de idioma con redirect (mala para SEO y para quien
  comparte un link; ver Decisión 3).
- Un press kit / EPK. Es el siguiente paso natural para prensa, pero es contenido
  nuevo y va en su propio spec (ver Preguntas abiertas).
- Manifest PWA por idioma: el nombre de la app es la marca y no cambia.
- Más idiomas además de `es` y `en`.

## Decisiones

### 1. URL: `/en`, servida desde `public/en.html`

`public/en.html` es una **tercera entrada de Rollup** en `vite.config.js`, igual
que `al-vacio-pre-release`. `html_handling: auto-trailing-slash` (Cloudflare)
ya la sirve en `/en` sin rewrites.

Descartado `public/en/index.html` (`/en/`): `index.html` usa rutas **relativas**
(`assets/images/...`) que se romperían dentro de una subcarpeta, y el
directorio impone una barra final en Cloudflare.

Canonical de la página: `https://still-louder.com/en`.

### 2. Dos HTML completos + un chequeo de paridad automático (sin templating)

`en.html` es una copia traducida de `index.html`, editada a mano igual que hoy.
Para evitar que se desincronicen (el caso típico: alguien agrega una tarjeta en
`#shows` en español y se olvida del inglés), `scripts/check-i18n.js` compara la
**estructura** de ambos archivos y falla si difieren:

- mismos `id` de sección y en el mismo orden;
- mismos `href` externos, `src`/`srcset` de imágenes, `data-*`
  (`data-countdown`, `data-shows-link`, `data-section`, `data-platform`, …) y
  `datetime`;
- mismo número de tarjetas en `.shows-upcoming`, de preguntas en `#faq` y de
  enlaces en `#conectar`;
- en cada bloque JSON-LD: los mismos `@type`, URLs, fechas, precios y nombres
  propios. Solo pueden cambiar los campos de texto libre (`description`,
  `alternateName` de rol, etc.).

Se ejecuta dentro de `npm run validate`, así que corre antes de cada commit
igual que el lint.

**Alternativa descartada:** un `index.html` plantilla con claves (`{{t:hero.title}}`)
más `locales/es.json`/`en.json` y un plugin de Vite que genere ambos. Elimina la
duplicación, pero obliga a reescribir las 1.300 líneas de `index.html` y
convierte cada cambio de copy (que hoy es editar HTML) en buscar una clave en un
JSON. Para un sitio de una página que se edita a mano en cada show, cuesta más
de lo que ahorra. Si algún día se agrega un tercer idioma, se reevalúa.

**Costo que se acepta:** cada cambio de contenido en `index.html` requiere el
cambio equivalente en `en.html`. El chequeo de paridad garantiza que no se
olvide la estructura; no puede verificar que la traducción sea fiel.

### 3. Selector de idioma visible, sin redirect automático

- Un link `ES | EN` en el header (desktop) y en el `mobile-nav`. Apunta a
  `/` ↔ `/en` y conserva el ancla actual (`#shows` → `/en#shows`), porque los
  `id` de sección son los mismos en ambos idiomas (lo garantiza el chequeo de la
  Decisión 2). Cada link lleva `hreflang` y `lang` en el `<a>`.
- **No** hay redirect por `Accept-Language` ni por `navigator.language`: quien
  recibe un link en español ve español, y Google indexa ambas versiones.
- No se guarda la preferencia: con un selector visible y dos páginas estáticas
  no hace falta.

### 4. Los textos que vienen de JS se resuelven por `<html lang>`

Hoy hay copy en español dentro de JS, no solo en el HTML:

| Dónde | Qué |
|---|---|
| `config.js` → `CONFIG.messages` | toasts de error y éxito (contacto, compartir, comentarios) |
| `config.js` → `CONFIG.site.description` | texto de compartir |
| `main.js` | texto de `navigator.share`, toasts de copiar, cuenta regresiva (`Faltan N días`), etiquetas del mensaje del form de contacto |
| `share.js` | label/aria `Compartir` |
| `ui-utils.js` | `Cargando...` |
| `error-handler.js` | errores de audio/imagen, `Reintentar`, `Cerrar notificación` |
| `sw-register.js` | `innerHTML` del aviso de actualización y del prompt de instalación |

Nuevo módulo `public/assets/js/i18n.js`:

```js
export const lang = document.documentElement.lang === 'en' ? 'en' : 'es';
export const t = (dict) => dict[lang] ?? dict.es;
```

`CONFIG.messages` pasa a tener la forma `{ es: {...}, en: {...} }`, y cada
llamada lee `t(CONFIG.messages).error.generic`. Los strings sueltos de los
módulos se mueven a `CONFIG.messages` (o a un dict local del módulo cuando
solo los usa ese módulo). Fallback a `es` si falta una clave en `en`. Ambas
páginas cargan el **mismo bundle**, no hay un build por idioma.

Cuenta regresiva en inglés: `1 day to go` / `N days to go`.

### 5. El form de contacto marca el idioma

`main.js` arma un solo campo (`Nombre: … Correo: … Mensaje: …`). Desde `/en`
el mensaje compuesto empieza con `[EN]` y usa las etiquetas en inglés
(`Name`/`Email`/`Message`), para que la banda sepa en qué idioma contestar sin
leer todo. Mismo Google Form y mismo campo (`CONFIG.contact`); no cambia la CSP.

### 6. Links a sistemas que solo están en español

Los CTA de entradas (`entradas.still-louder.com`, Ticketplus) y `/ayuda` se
quedan como están, pero en `en.html` el texto del botón o el `aria-label` lo
avisa: *"Get tickets (Spanish-only site)"*. Así no se engaña a nadie con un
flujo que no puede seguir.

### 7. Comunicados: siguen en español, pero `/en` también los muestra

`docs/features/comunicados.md` (D2) deja los comunicados **solo en español** y
este spec no lo cambia. Lo que sí se exige es que un comunicado importante
(por ejemplo, una cancelación) también llegue a quien entra por `/en`:

- **Banner:** el hook `transformIndexHtml` del plugin de comunicados inyecta el
  banner en `index.html` **y** en `en.html`. En `en.html` el texto que pone la
  página va en inglés (`aria-label="Official statement"`, etiqueta *"Official
  statement (in Spanish)"*, enlace *"Read statement"*, `aria-label` del ✕
  *"Dismiss statement"*). `title` y `summary` quedan en español, con
  `lang="es"` en su contenedor para que el lector de pantalla los pronuncie
  bien. Se usa la misma llave de `localStorage`, así que cerrarlo en un idioma
  lo cierra en los dos.
- **Footer:** el enlace a `/comunicados` también se inyecta en `en.html` como
  *"Statements (Spanish)"*, con `hreflang="es"`.
- **Páginas de comunicado** (`/comunicados/*`): sin selector de idioma ni
  versión `/en`. Su plantilla es una tercera copia del header/footer. El
  selector de idioma no se agrega ahí: llevaría a una página que no existe.
- **Paridad:** el banner y el enlace del footer se inyectan en el build y no
  están en el HTML fuente, así que `check-i18n.js` no los ve ni los necesita
  ver. Lo cubre el criterio 13.

**Orden de implementación:** lo que se mergee segundo carga con el cambio del
plugin. Si i18n va primero, el spec de comunicados ya tiene que tratar
`en.html` cuando se implemente. Si comunicados va primero, la PR de i18n
extiende el hook de `transformIndexHtml` a `en.html`.

## Alcance por archivo

| Archivo | Cambio |
|---|---|
| `public/en.html` | **Nuevo.** Copia traducida de `index.html`: `lang="en"`, `<title>`, meta description/keywords, OG/Twitter (`og:locale=en_US`, `og:locale:alternate=es_PA`, `og:url=/en`, alt de imágenes, `twitter:label*`), canonical `/en`, JSON-LD con texto libre traducido y `"inLanguage": "en"` en `WebSite`, todos los `alt`/`aria-label`, skip-link y copy visible. |
| `public/index.html` | `<link rel="alternate" hreflang="es|en|x-default">` (x-default → `/`), `og:locale:alternate=en_US`, `"inLanguage": "es"` en `WebSite`, selector de idioma. |
| `vite.config.js` | Entrada `en: '/en.html'`. |
| `public/assets/js/i18n.js` | **Nuevo** (Decisión 4). |
| `public/assets/js/config.js`, `main.js`, `share.js`, `ui-utils.js`, `error-handler.js`, `sw-register.js` | Strings por idioma (Decisión 4) y form (Decisión 5). |
| `scripts/comunicados/plugin.js` | Solo si comunicados ya está implementado: banner + enlace de footer también en `en.html` (Decisión 7). |
| `public/assets/css/style.css` | Estilo del selector (`.lang-switch`), con tokens de `variables.css`. |
| `public/assets/sitemap.xml` | Entrada `/en` y `xhtml:link rel="alternate" hreflang` en **ambas** URLs (namespace `xmlns:xhtml`). |
| `public/assets/sw.js` | Agregar `/en` a `PRECACHE_URLS` y subir `CACHE_VERSION`. Ojo: `addAll` es todo o nada, así que `/en` tiene que existir en `dist/` antes de mergear. |
| `public/assets/offline.html` | Bilingüe: el mismo mensaje en ES y EN en una sola página (es una sola URL de fallback). |
| `scripts/check-i18n.js` + `package.json` | **Nuevo** chequeo de paridad (Decisión 2), sumado a `validate`. |
| `scripts/check-dist.js` | Verificar que `/en` (`en.html`) esté en `REQUIRED`. Ya recorre todos los `dist/*.html` del nivel raíz, así que cubre las referencias de `en.html` sin más cambios. |
| `CLAUDE.md`, `docs/main-site/seo-accessibility.md`, `docs/main-site/pwa.md` | Documentar la regla "todo cambio de contenido va en `index.html` **y** `en.html`", el hreflang y el precache. |

Sin cambios: `public/assets/_headers`, `wrangler.jsonc` (sin
rewrites ni CSP nuevas), `site.webmanifest`, `ticket-system/`.

## Criterios de aceptación

1. `https://still-louder.com/en` responde 200 en Cloudflare con
   `<html lang="en">`. `/en.html` y `/en/` redirigen a `/en`, igual que hoy pasa
   con `/al-vacio-pre-release`.
2. No queda copy visible en español en `/en`, salvo nombres propios: banda,
   apodos de los miembros, títulos de canciones (`Skirlaz`, `Al Vacío`),
   venues, `Fábula Sarcástica`, `Elefreak`. Incluye `alt`, `aria-label`,
   `title`, toasts, cuenta regresiva, prompt de instalación del PWA y errores.
3. `/` no cambia visualmente, salvo por el selector de idioma.
4. El selector lleva de `/#faq` a `/en#faq` y de vuelta. Funciona con teclado y
   tiene `aria-label`.
5. Ambas páginas tienen canonical propio y el trío `hreflang` (`es`, `en`,
   `x-default`) recíproco. El sitemap lista ambas con sus alternates. Rich
   Results Test sin errores nuevos en ninguna de las dos.
6. El preview del link `/en` en WhatsApp/X/LinkedIn muestra título y
   descripción en inglés.
7. Un mensaje enviado desde el form de `/en` llega al Google Form con el
   prefijo `[EN]` y las etiquetas en inglés. Los mensajes de validación y el
   toast de éxito se ven en inglés.
8. Los CTA de entradas en `/en` avisan que el destino está solo en español.
9. `npm run validate` falla si a `en.html` le falta una tarjeta de `#shows`,
   una pregunta de `#faq`, un link de plataforma, o tiene un `href`/`datetime`
   distinto de `index.html`. Se comprueba borrando una tarjeta a propósito.
10. `npm run build && npm run check:dist` pasan. Con el sitio cacheado y la red
    cortada (DevTools → offline), `/en` carga desde el cache y una ruta no
    cacheada muestra el `offline.html` bilingüe.
11. GA4 distingue las visitas por `page_path` (`/` vs `/en`) sin cambios en
    `analytics.js`. Además, el selector manda el evento `language_switch` con
    `{ from, to }`.
12. Lighthouse de `/en` (mobile): SEO y Accesibilidad ≥ a los de `/`.
13. Si existe `docs/features/comunicados.md` implementado: con un comunicado
    fijado y vigente, `/en` muestra el banner con el texto de la página en
    inglés y el contenido en español (`lang="es"`), y el footer de `/en`
    enlaza a `/comunicados`. Cerrarlo en `/en` también lo oculta en `/`.

## Traducción

- El agente hace el primer borrador. La banda revisa el tono (hero, about,
  textos de shows y FAQ) antes de mergear, porque es la voz de la banda y no
  copy genérico.
- Inglés neutro/US. Fechas en formato largo en inglés (`Sunday, October 11`).
  Las etiquetas tipo `11 · 10 · 2026` se mantienen porque son diseño, no
  formato regional.
- No se traducen: nombres de canciones, del evento (`Still Louder's Halloween
  Party` ya está en inglés), venues ni apodos.

## Plan de entrega

Una sola PR. El main site no toca el flujo de venta, así que no hay
restricción por el show del 31-10. Orden sugerido para el agente:

1. `i18n.js` + refactor de strings de JS, sin cambio visible en `/`.
2. `en.html` + entrada en Vite + selector + hreflang/OG/JSON-LD.
3. `check-i18n.js` en `validate`.
4. Sitemap, SW (precache + versión), `offline.html` bilingüe, `check-dist`.
5. Docs (`CLAUDE.md`, `seo-accessibility.md`, `pwa.md`).

**Mantenimiento:** el próximo cambio de contenido (por ejemplo, pasar el show
del 11-10 a "pasado") ya tiene que hacerse en los dos archivos. El chequeo de
paridad lo hace cumplir.

## Preguntas abiertas

1. **Press kit.** ¿Prensa necesita algo más que el landing en inglés: bio
   larga, fotos en alta descargables, rider, contacto de booking? Si sí, va
   como spec aparte (`docs/features/press-kit.md`), probablemente en
   `/en/press` o `/press`.
2. **Email de booking.** `CONFIG.contact.bookingEmail` hoy es `null`. Para
   prensa internacional un correo directo pesa más que un Google Form o un DM
   de Instagram. ¿Se habilita?
3. **Revisor del inglés.** ¿Quién de la banda (o alguien de afuera) aprueba la
   traducción del about y el FAQ?
