import type { ReactNode } from "react";
import type { ThemeInfo } from "../core/api";

interface Props {
  themes: ThemeInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  aside?: ReactNode;
  children: ReactNode;
}

export function Shell({ themes, activeId, onSelect, aside, children }: Props) {
  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect x="9" y="4" width="18" height="22" rx="4" className="brand-back" transform="rotate(8 18 15)" />
            <rect x="5" y="6" width="18" height="22" rx="4" className="brand-front" />
            <path d="M10 14h8M10 19h5" className="brand-lines" />
          </svg>
          Structured AI
        </h1>
        {themes.length > 1 && (
          <nav aria-label="Themes" className="pills">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={t.id === activeId}
                className={t.id === activeId ? "pill active" : "pill"}
                onClick={() => onSelect(t.id)}
              >
                {t.title}
              </button>
            ))}
          </nav>
        )}
        {aside}
      </header>
      <main>{children}</main>
    </div>
  );
}
