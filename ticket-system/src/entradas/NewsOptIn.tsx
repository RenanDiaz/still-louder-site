// Casilla de opt-in a noticias (docs/features/campanas-promocion.md, Fase 0).
// Desmarcada por defecto y nunca obligatoria: comprar o reclamar no depende de
// ella. La usan /entradas y /regalo (mismo tema público).
export function NewsOptIn({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="tk-check" htmlFor="marketing-opt-in">
      <input
        id="marketing-opt-in"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Quiero recibir noticias de Still Louder (música y shows). Puedo darme de baja cuando quiera.
      </span>
    </label>
  );
}
