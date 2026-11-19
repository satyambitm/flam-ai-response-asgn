import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { deckDone, initStudy, roundDone, type StudyAction, studyReducer, type StudySet, wrongIds } from "./state";
import { StudyView } from "./View";

const card = (id: string, front: string, back: string, section = "Energy") => ({
  id,
  front,
  back,
  section,
  hint: `${front} hint`,
  detail: `${back} detail`,
});

const DATA: StudySet = {
  topic: "Cells",
  summary: "Basics",
  flashcards: [
    card("c1", "Powerhouse?", "Mitochondria"),
    card("c2", "Glycolysis where?", "Cytoplasm"),
    card("c3", "ETC where?", "Inner membrane", "Membranes"),
  ],
  quiz: [
    {
      id: "q1",
      question: "Krebs cycle site?",
      options: ["Matrix", "Nucleus"],
      answerIndex: 0,
      explanation: "In the matrix.",
      rationales: ["It runs in the matrix.", "The nucleus holds DNA."],
      skill: "recall",
    },
    {
      id: "q2",
      question: "Glycolysis net ATP?",
      options: ["2", "36"],
      answerIndex: 0,
      explanation: "",
      rationales: [],
      skill: "apply",
    },
  ],
};

const run = (...actions: StudyAction[]) => actions.reduce(studyReducer, initStudy(DATA));
const mark = (known: boolean): StudyAction => ({ type: "mark", known });

describe("studyReducer: flashcards", () => {
  it("flips, and moving clamps to the deck and resets the flip and hint", () => {
    expect(run({ type: "flip" }).flipped).toBe(true);
    const s = run({ type: "flip" }, { type: "hint" }, { type: "move", by: -1 });
    expect([s.index, s.flipped, s.hinted]).toEqual([0, false, false]);
    expect(run({ type: "move", by: 1 }, { type: "move", by: 1 }, { type: "move", by: 1 }).index).toBe(2);
  });

  it("marking moves to the next unmarked card, wrapping back to skipped ones", () => {
    const s = run({ type: "move", by: 1 }, mark(true), mark(false));
    expect([s.index, deckDone(s)]).toEqual([0, false]); // c2 and c3 marked; c1 was skipped
    const done = studyReducer(s, mark(true));
    expect(deckDone(done)).toBe(true);
    expect([...done.known].sort()).toEqual(["c1", "c2"]);
  });

  it("review-unknown starts a new pass over the cards still learning; reset restores everything", () => {
    const s = run(mark(true), mark(false), mark(true));
    const review = studyReducer(s, { type: "reviewUnknown" });
    expect(review).toMatchObject({ deck: ["c2"], index: 0 });
    expect(deckDone(review)).toBe(false);
    const reset = studyReducer(review, { type: "resetCards" });
    expect(reset).toMatchObject({ deck: ["c1", "c2", "c3"], index: 0 });
    expect([reset.known.size, reset.marked.size]).toEqual([0, 0]);
  });

  it("review-unknown is a no-op when every card is known", () => {
    const all = run(mark(true), mark(true), mark(true));
    expect(studyReducer(all, { type: "reviewUnknown" })).toBe(all);
  });
});

describe("studyReducer: quiz", () => {
  const answer = (questionId: string, option: number): StudyAction => ({ type: "answer", questionId, option });
  const next: StudyAction = { type: "next" };

  it("answers lock at once, and only the current question can be answered", () => {
    const s = run(answer("q2", 0), answer("q1", 1), answer("q1", 0));
    expect(s.answers).toEqual({ q1: 1 });
  });

  it("can't move on until the current question is answered", () => {
    expect(run(next).at).toBe(0);
    expect(run(answer("q1", 0), next).at).toBe(1);
  });

  it("retry-wrong re-tests only the wrong questions, keeping right answers", () => {
    const done = run(answer("q1", 0), next, answer("q2", 1), next);
    expect([roundDone(done), wrongIds(done)]).toEqual([true, ["q2"]]);
    const retry = studyReducer(done, { type: "retryWrong" });
    expect(retry).toMatchObject({ round: ["q2"], at: 0, answers: { q1: 0 } });
    const again = [answer("q2", 0), next].reduce(studyReducer, retry);
    expect(wrongIds(again)).toEqual([]);
  });

  it("retry-wrong does nothing mid-round", () => {
    const s = run(answer("q1", 1));
    expect(studyReducer(s, { type: "retryWrong" })).toBe(s);
  });

  it("restart brings back every question in the original order", () => {
    const s = run(answer("q1", 1), next, answer("q2", 1), next, { type: "retryWrong" }, { type: "restartQuiz" });
    expect(s).toMatchObject({ round: ["q1", "q2"], answers: {}, at: 0 });
  });

  it("starts in quiz mode when there are no flashcards", () => {
    expect(initStudy({ ...DATA, flashcards: [] }).mode).toBe("quiz");
  });
});

describe("StudyView", () => {
  it("shows a hint, flips to the answer with its detail, and marks the card known", async () => {
    render(<StudyView data={DATA} />);
    await userEvent.click(screen.getByRole("button", { name: "Show a hint" }));
    expect(screen.getByText("Powerhouse? hint")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Question: Powerhouse\?/ }));
    expect(screen.getByText("Mitochondria detail")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByText("1 of 3 known")).toBeInTheDocument();
  });

  it("ends a pass with a summary that offers the cards still learning", async () => {
    render(<StudyView data={DATA} />);
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    await userEvent.click(screen.getByRole("button", { name: "Still learning" }));
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByText("1 card still to learn")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review the 1 still learning" }));
    expect(screen.getByText("0 of 1 known")).toBeInTheDocument();
  });

  it("marks each answer at once with its rationale, then grades the round and retries the miss", async () => {
    render(<StudyView data={DATA} />);
    await userEvent.click(screen.getByRole("tab", { name: "Quiz (2)" }));
    await userEvent.click(screen.getByLabelText("Matrix"));
    expect(screen.getByRole("status")).toHaveTextContent("Correct.");
    expect(screen.getByText("The nucleus holds DNA.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next question" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Next question" }));

    await userEvent.keyboard("2"); // picks the second option, "36"
    expect(screen.getByRole("status")).toHaveTextContent("Not quite. The answer is 2.");
    await userEvent.click(screen.getByRole("button", { name: "See results" }));
    expect(screen.getByRole("status", { name: "Score: 1 out of 2" })).toBeInTheDocument();
    expect(screen.getByText("Glycolysis net ATP?")).toBeInTheDocument(); // listed as missed

    await userEvent.click(screen.getByRole("button", { name: "Retry the 1 missed" }));
    expect(screen.getByText("Question 1 of 1, retrying the ones you missed")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("2"));
    await userEvent.click(screen.getByRole("button", { name: "See results" }));
    expect(screen.getByRole("status", { name: "Score: 1 out of 1" })).toBeInTheDocument();
  });
});

describe("StudyView mode tabs", () => {
  it("switches mode with the arrow keys", async () => {
    render(<StudyView data={DATA} />);
    screen.getByRole("tab", { name: "Flashcards (3)" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Quiz (2)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Quiz" })).toBeInTheDocument();
    expect(screen.getByText(/Question 1 of 2/)).toBeInTheDocument();
  });
});
