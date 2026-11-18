import { useState } from "react";
import type { components } from "../../core/api-types";

type EchoData = components["schemas"]["EchoData"];

/** Throwaway pipeline-test view. Interaction state (done / removed) lives here, keyed by item id. */
export function EchoView({ data }: { data: EchoData }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const items = data.items.filter((i) => !removed.has(i.id));

  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  return (
    <article className="card">
      <h2>{data.title}</h2>
      <p className="muted">
        {items.filter((i) => done.has(i.id)).length} of {items.length} done
        {removed.size > 0 && (
          <>
            {" · "}
            <button type="button" className="link" onClick={() => setRemoved(new Set())}>
              restore {removed.size} removed
            </button>
          </>
        )}
      </p>
      <ul className="checklist">
        {items.map((item) => (
          <li key={item.id}>
            <label className={done.has(item.id) ? "done" : undefined}>
              <input type="checkbox" checked={done.has(item.id)} onChange={() => setDone((d) => toggle(d, item.id))} />
              {item.text}
            </label>
            <button
              type="button"
              aria-label={`Remove "${item.text}"`}
              onClick={() => setRemoved((r) => toggle(r, item.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}
