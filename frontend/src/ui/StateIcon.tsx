/** The glyph at the head of an error or empty card, in a tinted tile. */
export function StateIcon({ kind }: { kind: "error" | "empty" }) {
  return (
    <span className={`state-icon ${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
        {kind === "error" ? (
          <>
            <path d="M12 3.5 21.5 20h-19L12 3.5Z" strokeLinejoin="round" />
            <path d="M12 10v4.5M12 17.2v.1" strokeLinecap="round" />
          </>
        ) : (
          <>
            <rect x="4" y="5" width="16" height="14" rx="2.5" />
            <path d="M8 10h8M8 14h5" strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}
