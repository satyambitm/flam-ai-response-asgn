import { type Dispatch, type KeyboardEvent, useMemo, useReducer } from "react";
import { initStudy, type StudyAction, studyReducer, type StudySet, type StudyState, wrongIds } from "./state";

export function StudyView({ data }: { data: StudySet }) {
  const [state, dispatch] = useReducer(studyReducer, data, initStudy);

  return (
    <article className="card study">
      <h2>{data.topic}</h2>
      {data.summary && <p className="muted">{data.summary}</p>}
      <div className="tabs" role="tablist" aria-label="Study mode">
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
      className={active ? "tab active" : "tab"}
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
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") dispatch({ type: "move", by: 1 });
    if (e.key === "ArrowLeft") dispatch({ type: "move", by: -1 });
  };

  return (
    <div className="flashcards" onKeyDown={onKeyDown}>
      <p className="muted" aria-live="polite">
        Card {state.index + 1} of {state.deck.length} · {knownInDeck} known
      </p>
      <button
        type="button"
        className={state.flipped ? "flashcard flipped" : "flashcard"}
        onClick={() => dispatch({ type: "flip" })}
        aria-label={
          state.flipped
            ? `Answer: ${card.back}. Click to show question.`
            : `Question: ${card.front}. Click to reveal answer.`
        }
      >
        <span className="flashcard-side">{state.flipped ? "Answer" : "Question"}</span>
        <span className="flashcard-text">{state.flipped ? card.back : card.front}</span>
        <span className="flashcard-hint">{state.flipped ? "tap to see question" : "tap to reveal"}</span>
      </button>
      <div className="row">
        <button type="button" onClick={() => dispatch({ type: "move", by: -1 })} disabled={state.index === 0}>
          ← Prev
        </button>
        <button type="button" onClick={() => dispatch({ type: "mark", known: false })}>
          Still learning
        </button>
        <button type="button" className="primary" onClick={() => dispatch({ type: "mark", known: true })}>
          Got it
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "move", by: 1 })}
          disabled={state.index === state.deck.length - 1}
        >
          Next →
        </button>
      </div>
      <div className="row">
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

function Quiz({ data, state, dispatch }: Part) {
  const byId = useMemo(() => new Map(data.quiz.map((q) => [q.id, q])), [data]);
  if (!state.round.length) return <p className="muted">No quiz questions in this set. Try the flashcards.</p>;

  const answered = state.round.filter((id) => id in state.answers).length;
  const wrong = state.checked ? wrongIds(state) : [];
  const retrying = state.round.length < data.quiz.length;

  return (
    <div className="quiz">
      {retrying && <p className="muted">Retrying {state.round.length} question(s) you missed.</p>}
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
        <div className="row">
          <p className="score" role="status">
            Score: {state.round.length - wrong.length} / {state.round.length}
          </p>
          {wrong.length > 0 && (
            <button type="button" className="primary" onClick={() => dispatch({ type: "retryWrong" })}>
              Retry {wrong.length} wrong
            </button>
          )}
          <button type="button" onClick={() => dispatch({ type: "restartQuiz" })}>
            Restart quiz
          </button>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: "check" })}
            disabled={answered < state.round.length}
          >
            Check answers
          </button>
          <span className="muted">
            {answered} / {state.round.length} answered
          </span>
        </div>
      )}
    </div>
  );
}
