import { useCallback, useEffect, useState } from "react";
import {
  type Fault,
  fetchProviders,
  fetchThemes,
  type ProviderId,
  type ProvidersInfo,
  type ThemesResult,
} from "./core/api";
import { DEV_ONLY, INTROS, VIEWS } from "./themes/registry";
import { DevFaultPanel } from "./ui/DevFaultPanel";
import { ErrorView } from "./ui/ErrorView";
import { LoadingView } from "./ui/LoadingView";
import { ProviderPicker } from "./ui/ProviderPicker";
import { Shell } from "./ui/Shell";
import { Workspace } from "./ui/Workspace";

const SHOW_DEV_PANEL = import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug");

export default function App() {
  const { themes, reload } = useThemes();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fault, setFault] = useState<Fault | null>(null);
  const providers = useProviders();
  const [chosen, setChosen] = useState<ProviderId | null>(null);
  const provider = chosen ?? providers?.default ?? null;

  const available =
    themes.status === "done" && themes.result.ok
      ? themes.result.data.filter((t) => VIEWS[t.id] && (SHOW_DEV_PANEL || !DEV_ONLY.has(t.id)))
      : [];
  const active = available.find((t) => t.id === activeId) ?? available[0];

  return (
    <Shell
      themes={available}
      activeId={active?.id ?? null}
      onSelect={setActiveId}
      aside={SHOW_DEV_PANEL && <DevFaultPanel fault={fault} onChange={setFault} />}
    >
      {themes.status === "loading" && <LoadingView startedAt={themes.startedAt} label="Connecting to the server" />}
      {themes.status === "done" && !themes.result.ok && <ErrorView error={themes.result.error} onRetry={reload} />}
      {themes.status === "done" && themes.result.ok && !active && (
        <p className="card">The server offers no themes this app can display.</p>
      )}
      {active && (
        <Workspace
          key={active.id}
          theme={active}
          View={VIEWS[active.id]}
          intro={INTROS[active.id]}
          fault={fault}
          provider={provider}
          picker={
            providers &&
            provider &&
            providers.options.length > 1 && (
              <ProviderPicker
                options={providers.options}
                value={provider}
                onChange={setChosen}
                locked={fault !== null}
              />
            )
          }
        />
      )}
    </Shell>
  );
}

type ThemesState = { status: "loading"; startedAt: number } | { status: "done"; result: ThemesResult };

function useThemes() {
  const [themes, setThemes] = useState<ThemesState>(() => ({ status: "loading", startedAt: Date.now() }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchThemes({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) console.warn(`[themes] ${result.error.kind}: ${result.error.message}`);
      setThemes({ status: "done", result });
    });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setThemes({ status: "loading", startedAt: Date.now() });
    setAttempt((n) => n + 1);
  }, []);
  return { themes, reload };
}

/** Optional: if this fails the picker is hidden and requests use the server's default chain. */
function useProviders(): ProvidersInfo | null {
  const [info, setInfo] = useState<ProvidersInfo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchProviders({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setInfo(result.data);
      else console.warn(`[providers] ${result.error.kind}: ${result.error.message}; using the server default`);
    });
    return () => controller.abort();
  }, []);
  return info;
}
