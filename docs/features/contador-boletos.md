# Contador de boletos disponibles configurable

> **Estado (8 oct 2026):** implementado (migración `0016_stock_display.sql`).
> Subsistema: `ticket-system/` (`/entradas` y páginas de evento). No toca el
> sitio principal.

## Problema

`/entradas` siempre muestra cuántos boletos quedan ("★ quedan **N** boletos
disponibles ★") y, en preventa, cuántos conservan ese precio ("los próximos
**N** al precio de preventa"). Un contador que dice "quedan 180" no crea
urgencia y revela cuánto se ha vendido. Uno que dice "quedan 12" sí vende.
Queremos que el admin decida, por evento, si se muestra.

## Decisiones

| # | Decisión | Valor |
|---|---|---|
| D1 | Granularidad | **Por evento**: columnas en `events`, editables desde la pestaña **Eventos** de `/admin`. Nada global. |
| D2 | Modos | `always` (como hoy, default), `never` (nunca), `threshold` (solo cuando quedan ≤ N). |
| D3 | Qué cubre | Los dos contadores públicos: aforo total ("quedan N boletos") y cupo de preventa ("los próximos N al precio de preventa"). En `threshold` **cada uno** se muestra solo si **su** valor es ≤ N. |
| D4 | Dónde se oculta | **En el servidor.** Si un número no debe verse, `GET /api/presale/status` no lo envía (`null`). Ocultarlo solo en React lo dejaría visible en DevTools. |
| D5 | Lo que siempre viaja | Los booleanos que mueven la UI (`soldOut`, `eventSoldOut`, `stage2Active`) y `maxPerOrder = clamp(totalAvailable, 1, 10)` para el selector de cantidad. |
| D6 | Fuga aceptada | Con `never`, cuando quedan < 10 el máximo del selector baja y deja inferir cuántos quedan. Se acepta: es mejor que invitar a pedir 10 cuando quedan 3 y recibir un 409. |
| D7 | Admin | Las estadísticas del panel (`/admin`) siguen mostrando todos los números. Esto solo afecta la página pública. |
| D8 | Umbral guardado | `stock_display_threshold` se conserva aunque el modo cambie a `always`/`never`, para no perderlo al alternar. Solo es obligatorio con `threshold`. |

## Modelo

Migración `0016_stock_display.sql`:

```sql
alter table events
  add column stock_display text not null default 'always'
    check (stock_display in ('always', 'never', 'threshold')),
  add column stock_display_threshold int
    check (stock_display_threshold is null or stock_display_threshold >= 1),
  add constraint events_stock_display_threshold_required
    check (stock_display <> 'threshold' or stock_display_threshold is not null);
```

Eventos existentes quedan en `always`: sin cambio visible.

## API

`GET /api/presale/status` → `presale`:

| Campo | Antes | Ahora |
|---|---|---|
| `totalAvailable` | `number` | `number \| null` (null = oculto) |
| `available` | `number` | `number \| null` |
| `capacity` | `number` | `number \| null` (visible solo si `available` lo es) |
| `maxPerOrder` | — | `number` (1–10), siempre |
| `soldOut`, `eventSoldOut`, `stage2Active` | `boolean` | sin cambio |

Regla (`stockVisible(ev, n)` en `api/_lib/events.ts`): `always` → visible;
`never` → oculto; `threshold` → visible si `n ≤ stock_display_threshold`.

Admin `POST/PATCH /api/admin/events` acepta `stock_display` y
`stock_display_threshold`. Errores 400: `invalid_stock_display`,
`invalid_stock_display_threshold`, `missing_stock_display_threshold` (modo
`threshold` sin umbral, mirando también el valor ya guardado).

## UI

- **Admin → Eventos → editar**, sección "Contador público": select *Siempre /
  Nunca / Solo cuando queden pocos* + campo "Mostrar cuando queden ≤" (activo
  solo en el tercer modo).
- **`/entradas`**: `PresaleIndicator` pinta cada línea solo si su número
  llegó. Sin números, en preventa no se muestra nada extra; los avisos de
  "preventa agotada/finalizada" y el formulario de agotado no cambian (dependen
  de booleanos). El selector usa `maxPerOrder`.

## Criterios de aceptación

1. Evento con `always`: `/entradas` se ve igual que antes.
2. `never`: la respuesta de `presale/status` trae `totalAvailable`,
   `available` y `capacity` en `null`; no aparece ninguna línea "quedan N" ni
   "los próximos N".
3. `threshold` con N = 20 y 50 boletos restantes: sin contador. Al bajar a 20
   restantes aparece "quedan 20" (el refresco de 60 s lo recoge sin recargar).
4. `threshold` con preventa: "los próximos N al precio de preventa" aparece
   solo si el cupo de preventa ≤ umbral, independiente del total.
5. Agotado (preventa o total) se comporta igual en los tres modos.
6. Con 3 boletos restantes, el selector permite máximo 3 en los tres modos.
7. Guardar `threshold` sin umbral → error legible en el admin; la DB lo
   rechaza también.
8. El panel `/admin` sigue mostrando los números reales.
