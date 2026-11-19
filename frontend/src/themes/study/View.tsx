import {
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  deckDone,
  initStudy,
  roundDone,
  type Skill,
  type StudyAction,
  studyReducer,
  type StudySet,
  type StudyState,
  wrongIds,
} from "./state";
import { Segmented } from "../../ui/Segmented";

type Card = StudySet["flashcards"][number];
type Question = StudySet["quiz"][number];

const SKILL: Record<Skill, string> = { recall: "Recall", apply: "Apply", analyze: "Analyze" };

export function StudyView({ data }: { data: StudySet }) {
  const [state, dispatch] = useReducer(studyReducer, data, initStudy);
  const panelId = useId();

  return (
    <article className="study">
      <header className="study-head">
        <p className="crumbs" aria-hidden="true">
          Study <span>/</span> {data.flashcards.length} cards <span>/</span> {data.quiz.length} questions
        </p>
        <h2>{data.topic}</h2>
        {data.summary && <p>{data.summary}</p>}
      </header>
      <Segmented
        label="Study mode"
        className="modes"
        options={[
          { value: "cards", label: `Flashcards (${data.flashcards.length})`, controls: panelId },
          { value: "quiz", label: `Quiz (${data.quiz.length})`, controls: panelId },
        ]}
        value={state.mode}
        onChange={(mode) => dispatch({ type: "mode", mode })}
      />
      <div id={panelId} role="tabpanel" aria-label={state.mode === "cards" ? "Flashcards" : "Quiz"}>
        {state.mode === "cards" ? (
          <Flashcards data={data} state={state} dispatch={dispatch} />
        ) : (
          <Quiz data={data} state={state} dispatch={dispatch} />
        )}
      </div>
    </article>
  );
}

interface Part {
  data: StudySet;
  state: StudyState;
  dispatch: Dispatch<StudyAction>;
}

/* flashcards */

function Flashcards({ data, state, dispatch }: Part) {
  const byId = useMemo(() => new Map(data.flashcards.map((c) => [c.id, c])), [data]);
  if (!state.deck.length) return <p className="muted">No flashcards in this set. Try the quiz.</p>;

  const knownInDeck = state.deck.filter((id) => state.known.has(id)).length;
  const status = (
    <div className="deck-status">
      <p aria-live="polite">
        {deckDone(state)
          ? `Pass complete, ${knownInDeck} of ${state.deck.length} known`
          : `${knownInDeck} of ${state.deck.length} known`}
      </p>
      <Pips deck={state.deck} byId={byId} state={state} />
    </div>
  );
  if (deckDone(state)) {
    return (
      <div className="flashcards">
        {status}
        <DeckSummary state={state} dispatch={dispatch} known={knownInDeck} />
      </div>
    );
  }

  const card = byId.get(state.deck[state.index])!;
  const left = state.deck.filter((id) => !state.marked.has(id)).length - 1;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") dispatch({ type: "move", by: 1 });
    if (e.key === "ArrowLeft") dispatch({ type: "move", by: -1 });
    if (e.key.toLowerCase() === "h" && card.hint && !state.flipped) dispatch({ type: "hint" });
  };

  return (
    <div className="flashcards" onKeyDown={onKeyDown}>
      {status}
      <Tilt className="stack" data-ahead={Math.min(2, left)}>
        {/* keyed by card so a new card mounts face-up instead of rotating back and showing its answer */}
        <button
          key={card.id}
          type="button"
          className={state.flipped ? "flashcard flipped" : "flashcard"}
          onClick={() => dispatch({ type: "flip" })}
          aria-label={
            state.flipped
              ? `Answer: ${sentence(card.back)} ${card.detail} Click to show question.`
              : `Card ${state.index + 1} of ${state.deck.length}. Question: ${sentence(card.front)}${state.hinted ? ` Hint: ${card.hint}` : ""} Click to reveal answer.`
          }
        >
          <span className="face front">
            <span className="card-head">
              <span>{card.section || data.topic}</span>
              <span>
                {state.index + 1} / {state.deck.length}
              </span>
            </span>
            <span className="card-body">
              <span className="card-main">{card.front}</span>
              {state.hinted && <span className="card-note">{card.hint}</span>}
            </span>
          </span>
          <span className="face back">
            <span className="card-head">
              <span>{card.section || data.topic}</span>
              <span>Answer</span>
            </span>
            <span className="card-body">
              <span className="card-main">{card.back}</span>
              {card.detail && <span className="card-note">{card.detail}</span>}
            </span>
          </span>
        </button>
      </Tilt>
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
      <div className="deck-links">
        {card.hint && (
          <button
            type="button"
            className="link"
            onClick={() => dispatch({ type: "hint" })}
            disabled={state.hinted || state.flipped}
          >
            Show a hint
          </button>
        )}
        <p className="kbd-hint">
          <kbd>Space</kbd> flips, <kbd>←</kbd> <kbd>→</kbd> move
          {card.hint && (
            <>
              , <kbd>H</kbd> hints
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** One pip per card, in runs per section so the deck's chapters show at a glance. */
function Pips({ deck, byId, state }: { deck: string[]; byId: Map<string, Card>; state: StudyState }) {
  const runs: { section: string; ids: string[] }[] = [];
  for (const id of deck) {
    const section = byId.get(id)!.section;
    if (runs.at(-1)?.section === section) runs.at(-1)!.ids.push(id);
    else runs.push({ section, ids: [id] });
  }
  return (
    <div className="pips" aria-hidden="true">
      {runs.map((run, r) => (
        <ol key={r} title={run.section || undefined}>
          {run.ids.map((id) => (
            <li
              key={id}
              className={[
                state.known.has(id) ? "known" : state.marked.has(id) && "learning",
                deck[state.index] === id && !deckDone(state) && "current",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </ol>
      ))}
    </div>
  );
}

function DeckSummary({ state, dispatch, known }: Omit<Part, "data"> & { known: number }) {
  const learning = state.deck.length - known;
  return (
    <div className="slip paper">
      <p className="slip-title">
        {learning ? `${learning} ${learning === 1 ? "card" : "cards"} still to learn` : "You know every card"}
      </p>
      <p className="slip-text">
        You marked {known} of {state.deck.length} as known in this pass.
      </p>
      <div className="slip-actions">
        {learning > 0 && (
          <button type="button" className="primary" onClick={() => dispatch({ type: "reviewUnknown" })}>
            Review the {learning} still learning
          </button>
        )}
        <button type="button" onClick={() => dispatch({ type: "resetCards" })}>
          Start over with all {state.cards.length}
        </button>
      </div>
    </div>
  );
}

/**
 * Parallax for a mouse: the deck leans toward the pointer and the cards beneath, set deeper in CSS,
 * slide against it. Written straight to CSS variables so a pointer move never re-renders React.
 */
function Tilt({ className, children, ...rest }: { className: string; children: ReactNode; "data-ahead": number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lean = (x: number, y: number) => {
    ref.current?.style.setProperty("--lean-x", x.toFixed(3));
    ref.current?.style.setProperty("--lean-y", y.toFixed(3));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    lean((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
  };
  return (
    <div className="deck-space">
      <div ref={ref} className={className} onPointerMove={onPointerMove} onPointerLeave={() => lean(0, 0)} {...rest}>
        {children}
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

/* quiz */

function Quiz({ data, state, dispatch }: Part) {
  const byId = useMemo(() => new Map(data.quiz.map((q) => [q.id, q])), [data]);
  if (!state.round.length) return <p className="muted">No quiz questions in this set. Try the flashcards.</p>;
  if (roundDone(state)) return <Results byId={byId} state={state} dispatch={dispatch} total={data.quiz.length} />;

  const id = state.round[state.at];
  return (
    <div className="quiz">
      <div className="quiz-progress">
        <p>
          Question {state.at + 1} of {state.round.length}
          {state.round.length < data.quiz.length && ", retrying the ones you missed"}
        </p>
        <ol className="tally" aria-hidden="true">
          {state.round.map((qid, i) => (
            <li
              key={qid}
              className={
                !(qid in state.answers)
                  ? i === state.at
                    ? "current"
                    : ""
                  : state.answers[qid] === state.answerKey[qid]
                    ? "correct"
                    : "wrong"
              }
            />
          ))}
        </ol>
      </div>
      <QuestionCard
        key={id}
        q={byId.get(id)!}
        chosen={state.answers[id]}
        last={state.at === state.round.length - 1}
        dispatch={dispatch}
      />
    </div>
  );
}

function QuestionCard({
  q,
  chosen,
  last,
  dispatch,
}: {
  q: Question;
  chosen: number | undefined;
  last: boolean;
  dispatch: Dispatch<StudyAction>;
}) {
  const answered = chosen !== undefined;
  const sheetRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => claimFocus(sheetRef.current), []);
  // the options lock once answered, so keyboard focus moves on to the one thing left to do
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);
  const choose = (option: number) => dispatch({ type: "answer", questionId: q.id, option });
  const onKeyDown = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (!answered && n >= 1 && n <= q.options.length) choose(n - 1);
  };

  return (
    <div ref={sheetRef} tabIndex={-1} className="question paper" onKeyDown={onKeyDown}>
      <fieldset disabled={answered}>
        <legend>
          <span className={`skill ${q.skill}`}>{SKILL[q.skill]}</span>
          <span className="question-text">{q.question}</span>
        </legend>
        {q.options.map((option, i) => {
          const verdict = !answered ? "" : i === q.answerIndex ? "correct" : i === chosen ? "wrong" : "other";
          return (
            <label key={i} className={`option ${verdict}`}>
              <input type="radio" name={q.id} checked={chosen === i} onChange={() => choose(i)} />
              <span className="option-text">
                {option}
                {verdict === "correct" && <span className="visually-hidden"> (correct answer)</span>}
                {verdict === "wrong" && <span className="visually-hidden"> (your answer, incorrect)</span>}
                {answered && q.rationales[i] && <span className="rationale">{q.rationales[i]}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="visually-hidden" role="status">
        {answered && (chosen === q.answerIndex ? "Correct." : `Not quite. The answer is ${q.options[q.answerIndex]}.`)}
      </p>
      {answered ? (
        <div className="question-after">
          {q.explanation && <p className="takeaway">{q.explanation}</p>}
          <button ref={nextRef} type="button" className="primary" onClick={() => dispatch({ type: "next" })}>
            {last ? "See results" : "Next question"}
          </button>
        </div>
      ) : (
        <p className="kbd-hint">
          Pick an answer, or press <kbd>1</kbd>–<kbd>{q.options.length}</kbd>
        </p>
      )}
    </div>
  );
}

/** A new sheet takes focus only when the button that led to it is gone, never from a control still on screen. */
function claimFocus(el: HTMLElement | null) {
  if (document.activeElement === document.body) el?.focus();
}

function Results({
  byId,
  state,
  dispatch,
  total,
}: Omit<Part, "data"> & { byId: Map<string, Question>; total: number }) {
  const slipRef = useRef<HTMLDivElement>(null);
  useEffect(() => claimFocus(slipRef.current), []);
  const wrong = wrongIds(state);
  const right = state.round.length - wrong.length;
  const skills = (Object.keys(SKILL) as Skill[])
    .map((skill) => {
      const ids = state.round.filter((id) => byId.get(id)!.skill === skill);
      return { skill, of: ids.length, right: ids.filter((id) => !wrong.includes(id)).length };
    })
    .filter((s) => s.of > 0);

  return (
    <div ref={slipRef} tabIndex={-1} className="slip paper results">
      <div className="grade" role="status" aria-label={`Score: ${right} out of ${state.round.length}`}>
        <span className="grade-score">
          {right}
          <span>/{state.round.length}</span>
        </span>
        {/* a red-pen ring, drawn once, the way a marked paper comes back */}
        <svg className="grade-ring" viewBox="0 0 160 110" aria-hidden="true">
          <path
            pathLength={1}
            d="M118 18C96 4 42 6 20 30 2 50 12 86 52 98c38 11 88 2 100-28 9-24-8-44-40-54-20-6-46-5-66 3"
          />
        </svg>
      </div>
      <div className="results-body">
        <p className="slip-title">
          {wrong.length ? `${wrong.length} to go over` : "Every answer right"}
          {state.round.length < total && " in this retry"}
        </p>
        <dl className="by-skill">
          {skills.map((s) => (
            <div key={s.skill}>
              <dt>{SKILL[s.skill]}</dt>
              <dd>
                {s.right} of {s.of}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {wrong.length > 0 && (
        <ol className="missed">
          {wrong.map((id) => {
            const q = byId.get(id)!;
            return (
              <li key={id}>
                <p className="missed-q">{q.question}</p>
                <s className="missed-chosen">
                  <span className="visually-hidden">You chose </span>
                  {q.options[state.answers[id]]}
                </s>
                <p className="missed-right">
                  <span className="visually-hidden">Answer: </span>
                  {q.options[q.answerIndex]}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <div className="slip-actions">
        {wrong.length > 0 && (
          <button type="button" className="primary" onClick={() => dispatch({ type: "retryWrong" })}>
            Retry the {wrong.length} missed
          </button>
        )}
        <button type="button" onClick={() => dispatch({ type: "restartQuiz" })}>
          Restart quiz
        </button>
      </div>
    </div>
  );
}
