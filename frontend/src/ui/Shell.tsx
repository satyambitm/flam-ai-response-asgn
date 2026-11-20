import type { ReactNode } from "react";
import type { ThemeInfo } from "../core/api";
import { Segmented } from "./Segmented";

const REPO_URL = "https://github.com/satyambitm/flam-ai-response-asgn";

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
        <div className="topbar-inner">
          <h1 className="brand">
            <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
              <rect x="9" y="4" width="18" height="22" rx="4" className="brand-back" transform="rotate(8 18 15)" />
              <rect x="5" y="6" width="18" height="22" rx="4" className="brand-front" />
              <path d="M10 14h8M10 19h5" className="brand-lines" />
            </svg>
            Structured AI
          </h1>
          {themes.length > 1 && activeId && (
            <Segmented
              label="Themes"
              className="themes"
              options={themes.map((t) => ({ value: t.id, label: t.title }))}
              value={activeId}
              onChange={onSelect}
            />
          )}
          <div className="topbar-end">
            {aside}
            <a className="icon-link" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub">
              {/* GitHub mark, from svgl.app via the 21st.dev logo search */}
              <svg viewBox="0 0 1024 1024" width="20" height="20" aria-hidden="true">
                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
                />
              </svg>
            </a>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
