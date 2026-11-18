import { type Dispatch, type KeyboardEvent, useMemo, useReducer } from "react";
import { initStudy, type StudyAction, studyReducer, type StudySet, type StudyState, wrongIds } from "./state";

export function StudyView({ data }: { data: StudySet }) {
  const [state, dispatch] = useReducer(studyReducer, data, initStudy);

  return (
    <article className="study">
      <header className="study-head">
        <h2>{data.topic}</h2>
        {data.summary && <p>{data.summary}</p>}
      </header>
      <div className="segmented" role="tablist" aria-label="Study mode">
        <ModeTab mode="cards" state={state} dispatch={dispatch} label={`Flashcards (${data.flashcards.length})`} />
        <ModeTab mode="quiz" state={state} dispatch={dispatch} label={`Quiz (${data.quiz.length})`} />
      </div>
      {state.mode === "cards" ? (
        <Flashcards data={data} state={state} dispatch={dispatch} />
      ) : (
        <Quiz data={data} state={state} dispatch={dispatch} />
      )}
    </article>
  );
}

interface Part {
  data: StudySet;
  state: StudyState;
  dispatch: Dispatch<StudyAction>;
}

function ModeTab({ mode, label, state, dispatch }: Omit<Part, "data"> & { mode: StudyState["mode"]; label: string }) {
  const active = state.mode === mode;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "segment active" : "segment"}
      onClick={() => dispatch({ type: "mode", mode })}
    >
      {label}
    </button>
  );
}

function Flashcards({ data, state, dispatch }: Part) {
  const byId = useMemo(() => new Map(data.flashcards.map((c) => [c.id, c])), [data]);
  if (!state.deck.length) return <p className="muted">No flashcards in this set. Try the quiz.</p>;

  const card = byId.get(state.deck[state.index])!;
  const knownInDeck = state.deck.filter((id) => state.known.has(id)).length;
  const ahead = Math.min(2, state.deck.length - state.index - 1);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") dispatch({ type: "move", by: 1 });
    if (e.key === "ArrowLeft") dispatch({ type: "move", by: -1 });
  };

  return (
    <div className="flashcards" onKeyDown={onKeyDown}>
      <div className="deck-status">
        <p aria-live="polite">
          Card {state.index + 1} of {state.deck.length}, {knownInDeck} known
        </p>
        <ol className="pips" aria-hidden="true">
          {state.deck.map((id, i) => (
            <li
              key={id}
              className={[state.known.has(id) && "known", i === state.index && "current"].filter(Boolean).join(" ")}
            />
          ))}
        </ol>
      </div>
      <div className="stack" data-ahead={ahead}>
        {/* keyed by card so a new card mounts face-up instead of rotating back and showing its answer */}
        <button
          key={card.id}
          type="button"
          className={state.flipped ? "flashcard flipped" : "flashcard"}
          onClick={() => dispatch({ type: "flip" })}
          aria-label={
            state.flipped
              ? `Answer: ${sentence(card.back)} Click to show question.`
              : `Question: ${sentence(card.front)} Click to reveal answer.`
          }
        >
          <span className="face front">
            <span className="face-side">Question</span>
            <span className="face-text">{card.front}</span>
          </span>
          <span className="face back">
            <span className="face-side">Answer</span>
            <span className="face-text">{card.back}</span>
          </span>
        </button>
      </div>
      <div className="deck-controls">
        <button
          type="button"
          className="icon"
          aria-label="Previous card"
          onClick={() => dispatch({ type: "move", by: -1 })}
          disabled={state.index === 0}
        >
          <Chevron flip />
        </button>
        <button type="button" onClick={() => dispatch({ type: "mark", known: false })}>
          Still learning
        </button>
        <button type="button" className="primary" onClick={() => dispatch({ type: "mark", known: true })}>
          Got it
        </button>
        <button
          type="button"
          className="icon"
          aria-label="Next card"
          onClick={() => dispatch({ type: "move", by: 1 })}
          disabled={state.index === state.deck.length - 1}
        >
          <Chevron />
        </button>
      </div>
      <p className="kbd-hint">
        <kbd>Space</kbd> flips the card, <kbd>←</kbd> <kbd>→</kbd> move between cards
      </p>
      <div className="deck-links">
        <button
          type="button"
          className="link"
          onClick={() => dispatch({ type: "reviewUnknown" })}
          disabled={knownInDeck === 0 || knownInDeck === state.deck.length}
        >
          Review only cards I'm still learning
        </button>
        {state.deck.length !== state.cards.length && (
          <button type="button" className="link" onClick={() => dispatch({ type: "resetCards" })}>
            Back to all {state.cards.length} cards
          </button>
        )}
      </div>
    </div>
  );
}

/** "Where?" stays as is, "Mitochondria" becomes "Mitochondria." so the label never reads "Where?." */
function sentence(text: string): string {
  return /[.?!]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className={flip ? "mirrored" : undefined}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Quiz({ data, state, dispatch }: Part) {
  const byId = useMemo(() => new Map(data.quiz.map((q) => [q.id, q])), [data]);
  if (!state.round.length) return <p className="muted">No quiz questions in this set. Try the flashcards.</p>;

  const answered = state.round.filter((id) => id in state.answers).length;
  const wrong = state.checked ? wrongIds(state) : [];
  const retrying = state.round.length < data.quiz.length;

  return (
    <div className="quiz">
      {retrying && <p className="muted">Retrying the {state.round.length} you missed.</p>}
      <ol>
        {state.round.map((id) => {
          const q = byId.get(id)!;
          const chosen = state.answers[id];
          return (
            <li key={id}>
              <fieldset disabled={state.checked}>
                <legend>{q.question}</legend>
                {q.options.map((option, i) => {
                  const verdict = !state.checked ? "" : i === q.answerIndex ? "correct" : i === chosen ? "wrong" : "";
                  return (
                    <label key={i} className={`option ${verdict}`}>
                      <input
                        type="radio"
                        name={id}
                        checked={chosen === i}
                        onChange={() => dispatch({ type: "answer", questionId: id, option: i })}
                      />
                      {option}
                      {verdict === "correct" && <span className="visually-hidden"> (correct answer)</span>}
                      {verdict === "wrong" && <span className="visually-hidden"> (your answer, incorrect)</span>}
                    </label>
                  );
                })}
              </fieldset>
              {state.checked && q.explanation && <p className="muted explanation">{q.explanation}</p>}
            </li>
          );
        })}
      </ol>
      {state.checked ? (
        <div className="quiz-footer">
          <ol className="tally" aria-hidden="true">
            {state.round.map((id) => (
              <li key={id} className={wrong.includes(id) ? "wrong" : "correct"} />
            ))}
          </ol>
          <p className="score" role="status">
            Score: {state.round.length - wrong.length} / {state.round.length}
          </p>
          <div className="actions">
            {wrong.length > 0 && (
              <button type="button" className="primary" onClick={() => dispatch({ type: "retryWrong" })}>
                Retry {wrong.length} wrong
              </button>
            )}
            <button type="button" onClick={() => dispatch({ type: "restartQuiz" })}>
              Restart quiz
            </button>
          </div>
        </div>
      ) : (
        <div className="quiz-footer">
          <span className="muted">
            {answered} of {state.round.length} answered
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: "check" })}
            disabled={answered < state.round.length}
          >
            Check answers
          </button>
        </div>
      )}
    </div>
  );
}
