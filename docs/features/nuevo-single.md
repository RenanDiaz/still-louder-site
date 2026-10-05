# Nueva era del sitio: "A Las 10"

> **Estado (4 oct 2026):** **Fase 1 implementada** en la rama
> `feat/a-las-10-rework` con la portada (1400×1400) y la foto en vivo
> (Modesto Miranda, Rock n' Folk, 6 feb 2026, con permiso) en mano; solo faltan las **URLs
> de plataformas**, que se pegan el 5 de octubre (`config.js`, `#escuchar` y
> los `offers` del JSON-LD siguen con las de Skirlaz hasta entonces, CA-3).
> **"A Las 10" se estrena el 5 de octubre de 2026.** El video de YouTube llega
> aparte (previsto el 31 oct): **Fase 2 pendiente**. No hay pre-save.
> Subsistema: **sitio principal** (repo root) + el asset de marca genérico del
> ticket system (`ticket-system/public/og-image.jpg`, regla "Brand-derived
> assets" de `CLAUDE.md`). Se coordina con `docs/features/bio-links.md`.
> Decisiones cerradas al implementar: D4 → foto en vivo en el hero (aguanta a
> 1920 px: 164 KB WebP / 221 KB AVIF); D5 → `IMG_2433` con duotono
> (`--about-photo-*` en `variables.css`); D6 → paleta en el comentario de era
> de `variables.css`; D8 → portada 1400×1400 JPEG (234 KB); D11 → se quitan
> los shortcuts de YouTube **y** del pre-release de Al Vacío; D12 → archivo
> `live/a-las-10-rock-n-folk-2026-02-06.*`. Los originales viven fuera del repo en
> `originals/` (gitignored).

## Problema

El sitio está "ambientado" a **Skirlaz** (feb 2026): portada en el hero,
paleta azul-gris + rojo derivada de esa portada, fotos de la sesión de
Skirlaz en el fondo del hero y en `#about`, y toda la metadata (OG, JSON-LD,
sitemap, manifest) apuntando a ese single. Viene **"A Las 10"** y hay que
volver a hacer lo que hizo `cfaee34` (rework a Skirlaz), con dos diferencias:

1. **No hay sesión de fotos nueva.** Hay la portada y **una foto de la banda
   tocando en vivo** cuyas luces van en el color de la portada. Todo lo visual
   sale de esas dos imágenes; las fotos de la sesión de Skirlaz siguen siendo
   las únicas fotos "de estudio" de la banda.
2. **El estreno es mañana** y hoy no existen los enlaces. No vale la pena un
   modo "Próximamente" de un día: el cambio de era se despliega **el 5 de
   octubre con los enlaces**, en un solo PR. El video llega semanas después
   y es una fase propia.

## Decisiones tomadas

| # | Decisión | Valor |
|---|---|---|
| D1 | Slug interno | **`a-las-10`**. Nombres de archivo: `album_covers/a-las-10.{jpeg,webp,avif}`. El título se escribe siempre **"A Las 10"** (mayúscula en "Las", como lo nombra la banda). |
| D2 | Fases | **Fase 1 — Estreno (5 oct)**: cambio de era completo con enlaces: es el checklist 1.4 de `docs/main-site/seo-accessibility.md` más la piel nueva; el bloque de video de `#escuchar` se **quita** porque no hay video. **Fase 2 — Video (≈ 31 oct)**: vuelve el iframe de YouTube con el video nuevo, `release.video`, `music:preview_url:youtube`. **No** hay fase teaser: un día no la justifica (si por lo que sea el estreno se corre, el teaser está descrito en "Plan B: teaser"). Nada se decide por fecha en JS: los crawlers no ejecutan JS y el OG tiene que ser correcto en cada fase. |
| D3 | Fecha pública | `2026-10-05`. Va en `music:release_date`, `MusicRecording.datePublished`, `CONFIG.release.releaseDate` y el `twitter:data2` (año). Sin cuenta regresiva: no hay nada que contar. |
| D4 | Fondo del hero | **La foto en vivo**, tratada como hoy se trata `IMG_2434` (`brightness(0.4) saturate(0.55) contrast(1.05)`, ajustando la saturación para que las luces de la foto y el acento de la portada queden en el mismo matiz), en `.hero-bg` con `image-set` AVIF/WebP. **Plan B** si la foto no aguanta a pantalla completa (ruido, resolución, encuadre): la propia portada desenfocada y ampliada (`filter: blur(…)`, `transform: scale(1.3)`), la técnica estándar de las apps de música. Se decide con la foto real en mano, con capturas a 390 px y 1280 px. |
| D5 | Foto de `#about` | **Se queda `photoshoot/skirlaz/IMG_2433`** (se ven las caras; es la foto de la banda, no de un single) con tratamiento CSS que la lleve a la nueva paleta: `filter: grayscale(1) contrast(1.05)` + capa `::after` con `background: var(--color-accent); mix-blend-mode: color` (duotono) u `overlay` a baja opacidad. Si la foto en vivo no se usa en el hero (plan B de D4), se evalúa aquí en vez de la de Skirlaz. El tratamiento se define con tokens, así que la próxima era solo cambia `variables.css`. |
| D6 | Paleta | Se **deriva de la portada**, igual que se hizo con Skirlaz: `--color-bg-primary` = el tono más oscuro de la portada; `--color-accent` = su color dominante saturado; `--color-accent-hover` un paso más claro; `--color-accent-text` un tinte del mismo matiz con **≥ 4.5:1** sobre `--color-bg-primary` **y** `--color-bg-tertiary` (regla ya anotada en `variables.css`). Los acentos secundarios (`--color-teal`, `--color-bandage`) se renombran o reemplazan por los de la portada nueva; se borran si no se usan. Se verifica con un comprobador de contraste antes de abrir el PR. |
| D7 | Skirlaz después del estreno | Pasa a ser un single anterior: se nombra en el párrafo de `#about` ("…continúa la senda de «Skirlaz» (2026), «Al Vacío» (2025) y «Litio+» (2024)") y **no** recibe página legacy propia (`al-vacio-pre-release.html` existe por el formulario de comentarios de aquella campaña, no como patrón). Los archivos `album_covers/skirlaz.*` y `photoshoot/skirlaz/*` se quedan: `#about` y el OG del ticket system los usan. |
| D8 | Versión de la portada para OG | **Cuadrada**, igual que hoy (640×640 funcionó en WhatsApp/Facebook/X con `summary_large_image`). JPEG para `og:image` (los crawlers no leen AVIF/WebP), AVIF + WebP para `<picture>`. Tamaño mínimo 1000×1000 si el archivo original lo da; declarar el real en `og:image:width/height`. |
| D9 | Assets del ticket system | `ticket-system/public/og-image.jpg` se **regenera** con los nuevos tokens (colores en `design/og-image/og-image.html`; la foto sigue siendo `IMG_2433`, que ya va en blanco y negro) y se sube `?v=2` → `?v=3` en `entradas.html`. Las piezas por evento (`og-31-10.jpg`, temas en `src/entradas/themes/`) **no** cambian: siguen al flyer del show. |
| D10 | `/links` | Si `docs/features/bio-links.md` ya está en producción, su fondo y `og:image` cambian a la portada nueva **en el mismo PR** de la Fase 1. |
| D11 | Manifest y shortcuts | `site.webmanifest`: `name` "Still Louder - A Las 10", `description`, y los `shortcuts` (que **todavía dicen "Al Vacío"**) se corrigen al single vigente. El shortcut "Ver en YouTube" se quita en la Fase 1 y vuelve en la Fase 2. |
| D12 | Foto en vivo: archivo | `public/assets/images/live/a-las-10-<lugar>-<aaaa-mm-dd>.{jpg,webp,avif}` (carpeta nueva `live/`, distinta de `photoshoot/` que es sesión de estudio). Fallback JPG ≤ 1920 px de ancho y ≤ 250 KB; entrada explícita en `scripts/optimize-images.js` como la de `IMG_2434`. Se publica con `alt` vacío en el hero (es decorativa) y, si va a `#about`, con `alt` descriptivo (lugar y fecha del show). |

## Alcance

### Fase 1 — Estreno (5 oct 2026): cambio de era + enlaces

1. Portada nueva en `public/assets/images/album_covers/a-las-10.*` (JPEG +
   WebP + AVIF) y foto en vivo en `public/assets/images/live/` (D12).
2. Tokens nuevos en `variables.css` (D6) con comentario de era
   ("A Las 10: …") reemplazando el de Skirlaz.
3. Hero: portada, `<h1>` "A Las 10", kicker "Nuevo sencillo", "Ya disponible
   en todas las plataformas", fondo con la foto en vivo (D4). CTA primario
   "Escuchar ahora" → `#escuchar`; secundario "Compartir" (se mantiene).
4. `#escuchar`: tarjetas de plataforma y `aria-label`s de "A Las 10" con las
   URLs del día; **sin** bloque de video (se quita el iframe y su contenedor;
   el `frame-src` del CSP se deja como está para la Fase 2). La tarjeta de
   YouTube apunta al canal (`CONFIG.social.youtube.url`) con texto
   "Suscríbete" hasta que exista el video, o se omite; decidir al implementar.
5. `#about`: tratamiento de la foto (D5); párrafo final: "A Las 10" (2026) es
   el más reciente, seguido de Skirlaz (2026), Al Vacío (2025), Litio+ (2024)
   (D7).
6. Metadata: `<title>` "Still Louder - A Las 10 | Lanzamiento Oficial 2026",
   `description`, `keywords`, `og:*` (imagen = portada nueva, `og:type`
   `music.song`), `music:release_date` = `2026-10-05`, **sin**
   `music:preview_url:youtube` hasta la Fase 2, `twitter:*`, `theme-color`
   (= nuevo `--color-bg-primary`, también en `site.webmanifest`,
   `offline.html` y `CONFIG.site.themeColor`). JSON-LD `MusicRecording`:
   `name`, `image`, `datePublished`, `recordingOf.name`, `inAlbum.*`,
   `offers[]` con las URLs reales y `offerCount`; `isrcCode`/`iswcCode` solo
   si se tienen, si no se quitan (no inventar campos).
7. `config.js`: `release` (title, releaseDate, coverImage, `video: null`),
   `platforms.*` → URLs de "A Las 10", `site.description`, `site.themeColor`.
   `main.js` → `CONFIG.share.title/text`.
8. `sitemap.xml`: `lastmod`, `image:loc/title/caption` de `/`.
9. `sw.js`: bump `CACHE_VERSION` (regla de `docs/main-site/pwa.md`).
10. `offline.html`: colores/portada si los referencia.
11. `site.webmanifest`: `name`, `description`, `shortcuts` (D11).
12. `public/assets/links.json`: URLs de artista si cambian (nada lo consume
    hoy; se mantiene por el checklist 1.4).
13. Ticket system: `og-image.jpg` regenerado + `?v=3` (D9).
14. `/links` si existe (D10): fondo, `og:image` y botón `live`.
15. `CLAUDE.md` ("current single" en Project Overview y la lista de assets
    derivados), `docs/main-site/seo-accessibility.md` (tabla 1.2 y 1.4),
    `package.json` `description`/`keywords` (siguen diciendo "Al Vacío").

### Fase 2 — Video (≈ 31 oct 2026)

1. `#escuchar`: vuelve el iframe de `youtube-nocookie.com` con el video
   nuevo, `title` "A Las 10 - Still Louder (Video Oficial)"; la tarjeta de
   YouTube pasa a "Ver video" con la URL del video.
2. `config.js`: `release.video`, `platforms.youtube.url`.
3. `index.html`: `music:preview_url:youtube`; JSON-LD `MusicRecording` suma
   el video (`video` `VideoObject` con `uploadDate`, `thumbnailUrl` de
   `i.ytimg.com`, ya permitido en `img-src`).
4. `site.webmanifest`: vuelve el shortcut "Ver en YouTube".
5. `sw.js`: bump `CACHE_VERSION`.
6. El 31 oct es también el show de Halloween: este cambio **no** se mezcla
   con el de pasar ese show a "Último show" (checklist 1.5); son dos PRs.

### Plan B: teaser

Solo si el estreno se corre más de unos días. Es la Fase 1 sin los puntos 4,
6 (`offers`, `datePublished`, `music:release_date`) y 7 (`platforms.*`): el
hero dice "Próximamente", `#escuchar` se titula "Mientras tanto" y sigue
mostrando Skirlaz, y `#about` dice que "A Las 10" viene en camino. Luego la
Fase 1 completa el día del estreno.

## Trabajo visual con una sola imagen

Cómo sacar una "era" entera de una portada, en orden:

1. **Muestrear la portada**: 4–5 colores (fondo dominante, acento dominante,
   un secundario, el tono más claro, el más oscuro). Herramienta: cualquier
   extractor de paleta o `sharp` con `.stats()` / `.resize(1,1)`; anotar los
   hex en el comentario de era de `variables.css`.
2. **Tokens** (D6): `--color-primary`/`--color-bg-primary` ← más oscuro (si
   la portada es clara, oscurecerlo hasta ≤ L 10 % en HSL: el sitio sigue
   siendo oscuro, el modo claro queda fuera de alcance);
   `--color-bg-secondary/tertiary` ← dos pasos de luminosidad arriba, mismo
   matiz; `--color-accent` ← acento dominante; `--color-accent-glow` ← el
   mismo con alpha 0.4; `--color-accent-text` ← tinte AA; `--gradient-hero`
   ← rgba del nuevo bg. `@media (prefers-contrast: high)` se revisa (hoy sube
   el acento un paso).
3. **Hero** (D4): la foto en vivo como `.hero-bg` con el filtro actual,
   afinando `saturate()` hasta que sus luces lean como el `--color-accent`;
   la portada nítida como `.album-cover` y el acento como `.album-glow`.
   Plan B: la portada desenfocada como fondo (`background-position` para
   centrar una zona lisa si el blur se ve "sucio").
4. **Foto de banda** (D5): duotono con el nuevo acento en `#about`. Probar
   `mix-blend-mode: color` vs `overlay` con la portada real al lado; elegir
   el que no pelee con ella.
5. **Flyers de shows** (`#shows`): no se tocan. Son arte de cada evento.
6. **Símbolo / logo**: `still_louder_simbolo.svg` ya es monocromo
   (`currentColor` o blanco), así que hereda la paleta.
7. **Captura comparativa**: antes/después del home a 390 px y 1280 px en el
   PR para revisar la paleta en contexto.

## Criterios de aceptación

**Fase 1**

- **CA-1** `npm run validate`, `npm run build`, `npm run check:dist` pasan.
- **CA-2** `grep -n Skirlaz public/index.html` devuelve solo las menciones
  de `#about`; `grep -rn "Al Vacío" public/assets/site.webmanifest package.json`
  no devuelve nada.
- **CA-3** Cada enlace de plataforma abre "A Las 10" en una pestaña nueva;
  no queda ninguna URL de Skirlaz en `#escuchar` ni en `config.js
  platforms.*`. No hay iframe de YouTube ni placeholders `#`.
- **CA-4** Contraste: `--color-accent-text` sobre `--color-bg-primary` y
  `--color-bg-tertiary` ≥ 4.5:1; texto primario sobre `.hero-bg` tratado
  ≥ 4.5:1 en la zona del `<h1>` (medir sobre captura). Lighthouse
  Accessibility 100.
- **CA-5** Sharing Debugger y WhatsApp muestran la portada de "A Las 10" y el
  título nuevo para `/`; `entradas.still-louder.com/entradas` muestra el
  `og-image.jpg?v=3` con la paleta nueva.
- **CA-5b** La foto en vivo del hero pesa ≤ 250 KB en el formato que recibe
  un móvil (AVIF o WebP) y el LCP del home a 390 px sigue siendo la portada
  (`fetchpriority="high"`), no el fondo. Lighthouse móvil Performance ≥ 90.
- **CA-6** Rich Results Test sin errores en `MusicRecording`, `MusicGroup` y
  los dos `MusicEvent` (que no cambian).
- **CA-7** `prefers-reduced-motion`: el hero no anima; el blur y el duotono
  son estáticos y se mantienen.
- **CA-8** El SW viejo se reemplaza al recargar (nuevo `CACHE_VERSION`), sin
  mezclar CSS viejo con HTML nuevo.
- **CA-9** `al-vacio-pre-release.html` **no cambia** en ningún byte y se ve
  igual que antes: sus hojas en `css/al-vacio-pre-release/` no importan
  `variables.css` (verificado el 4 oct 2026), así que el cambio de tokens no
  la toca.

- **CA-10** Checklist 1.4 de `seo-accessibility.md` completo (todos los
  puntos marcan "A Las 10").

**Fase 2**

- **CA-11** El iframe reproduce el video nuevo; `music:preview_url:youtube`
  y `platforms.youtube.url` apuntan a él; Rich Results Test sin errores con
  el `VideoObject`.
- **CA-12** Sin errores de CSP en consola al reproducir (ya están permitidos
  `youtube-nocookie.com` en `frame-src` e `i.ytimg.com` en `img-src`).

## Flujo operativo

1. **Hoy (4 oct)**: recibir la portada (archivo original, el más grande que
   haya) y la foto en vivo → `album_covers/a-las-10.jpeg` y
   `live/a-las-10-….jpg` + WebP/AVIF (`scripts/optimize-images.js` no recorre
   esas carpetas: tiene entradas explícitas para `skirlaz.jpeg` con
   `maxWidth: 1200` y para las fotos de `photoshoot/skirlaz`; agregar las
   nuevas al lado y correr `npm run optimize:images`). Sacar la paleta
   (sección "Trabajo visual") y dejar la rama con todo menos las URLs.
2. **5 oct**: pegar las URLs de plataformas en `config.js` e `index.html`,
   `npm run validate && npm run build && npm run check:dist`, capturas
   comparativas, PR `feat: rework landing page for "A Las 10"`, merge.
3. Sharing Debugger para `/`, `/links` y `entradas.still-louder.com/entradas`.
   La bio ya apunta a `/links`, así que no cambia.
4. **≈ 31 oct**: PR de Fase 2 con el video (preparado la víspera en una rama
   si ya se conoce la URL del estreno programado de YouTube).

## Fuera de alcance

- Sesión de fotos nueva o retoque de las existentes fuera de CSS. La foto en
  vivo entra tal cual (recorte y compresión aparte).
- Página propia del single (`/a-las-10`): el home **es** la página del single
  (es lo que se comparte y lo que indexa Google). Una landing aparte dividiría
  el OG y el SEO entre dos URLs.
- Página legacy para Skirlaz (D7).
- Modo claro o tema seleccionable.
- Rediseño de estructura: las secciones (`#escuchar`, `#shows`, `#about`,
  `#faq`, `#conectar`, `#contacto`) se quedan; solo cambia piel y contenido.
- `/en` (`i18n-main-site-en.md`): si existe para entonces, hereda los tokens
  automáticamente y su copy se cambia en el mismo PR (regla de paridad).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La portada no da un acento usable (p. ej. toda en grises o neón sin contraste) | D6 permite ajustar saturación/luminosidad del acento mientras conserve el matiz; `--color-accent-text` es un token separado justamente para esto. |
| El blur de la portada como fondo se ve plano o manchado | Alternativa documentada: degradado radial con los dos colores dominantes sobre `--color-bg-primary` (sin imagen). Decidir con captura. |
| Cambiar la paleta rompe el pre-release legacy | CA-9. |
| Se publica el OG nuevo y WhatsApp sigue mostrando Skirlaz | Nombre de archivo nuevo (`a-las-10.jpeg`, no sobrescribir `skirlaz.jpeg`) + Sharing Debugger. |
| El ticket system se olvida (deploy separado) | Está en el alcance de la Fase 1 (D9) y en el CA-5; la regla ya vive en `CLAUDE.md`. |
| El estreno se corre | "Plan B: teaser": se despliega la piel nueva sin `offers` ni enlaces y se completa después. |
| La foto en vivo no rinde a pantalla completa (ruido de ISO alto, poca resolución) | Plan B de D4 (portada desenfocada). Decidir con capturas, no en abstracto. |
| El video se estrena el mismo día del show de Halloween y se mezclan dos cambios | Fase 2, punto 6: dos PRs. |

## Preguntas abiertas

- **Portada**: dimensiones del archivo original y si es cuadrada (D8).
- **Foto en vivo**: archivo original, lugar y fecha del show (para el nombre
  del archivo y el `alt`), y si hay permiso del fotógrafo para publicarla.
- ¿Habrá **ISRC** a mano el 5 oct? Si no, `isrcCode` se omite.
- ¿Hay alguna imagen más aparte de la portada (arte alterno, tipografía del
  título en vector)? Si existe el título en vector, el `<h1>` podría usarlo
  como imagen accesible en vez de Bebas Neue; sin eso, la tipografía del sitio
  no cambia.
