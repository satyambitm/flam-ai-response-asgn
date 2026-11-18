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
      <header>
        <h1>Structured AI</h1>
        {themes.length > 1 && (
          <nav aria-label="Themes" className="tabs">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={t.id === activeId}
                className={t.id === activeId ? "tab active" : "tab"}
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
