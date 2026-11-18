import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { initStudy, type StudyAction, studyReducer, type StudySet, wrongIds } from "./state";
import { StudyView } from "./View";

const DATA: StudySet = {
  topic: "Cells",
  summary: "Basics",
  flashcards: [
    { id: "c1", front: "Powerhouse?", back: "Mitochondria" },
    { id: "c2", front: "Glycolysis where?", back: "Cytoplasm" },
    { id: "c3", front: "ETC where?", back: "Inner membrane" },
  ],
  quiz: [
    {
      id: "q1",
      question: "Krebs cycle site?",
      options: ["Matrix", "Nucleus"],
      answerIndex: 0,
      explanation: "In the matrix.",
    },
    { id: "q2", question: "Glycolysis net ATP?", options: ["2", "36"], answerIndex: 0, explanation: "" },
  ],
};

const run = (...actions: StudyAction[]) => actions.reduce(studyReducer, initStudy(DATA));

describe("studyReducer: flashcards", () => {
  it("flips, and moving clamps to the deck and resets the flip", () => {
    expect(run({ type: "flip" }).flipped).toBe(true);
    const s = run({ type: "flip" }, { type: "move", by: -1 });
    expect([s.index, s.flipped]).toEqual([0, false]);
    expect(run({ type: "move", by: 1 }, { type: "move", by: 1 }, { type: "move", by: 1 }).index).toBe(2);
  });

  it("marking advances; review-unknown narrows the deck; reset restores the original order", () => {
    const s = run({ type: "mark", known: true }, { type: "mark", known: false });
    expect([...s.known]).toEqual(["c1"]);
    const review = studyReducer(s, { type: "reviewUnknown" });
    expect(review.deck).toEqual(["c2", "c3"]);
    expect(studyReducer(review, { type: "resetCards" })).toMatchObject({ deck: ["c1", "c2", "c3"], index: 0 });
    expect(studyReducer(review, { type: "resetCards" }).known.size).toBe(0);
  });

  it("review-unknown is a no-op when every card is known", () => {
    const all = run({ type: "mark", known: true }, { type: "mark", known: true }, { type: "mark", known: true });
    expect(studyReducer(all, { type: "reviewUnknown" })).toBe(all);
  });
});

describe("studyReducer: quiz", () => {
  const answer = (questionId: string, option: number): StudyAction => ({ type: "answer", questionId, option });

  it("can't check until every question is answered", () => {
    expect(run(answer("q1", 0), { type: "check" }).checked).toBe(false);
    expect(run(answer("q1", 0), answer("q2", 1), { type: "check" }).checked).toBe(true);
  });

  it("answers are locked after checking", () => {
    const s = run(answer("q1", 0), answer("q2", 1), { type: "check" }, answer("q2", 0));
    expect(s.answers.q2).toBe(1);
  });

  it("retry-wrong re-tests only the wrong questions, keeping right answers", () => {
    const checked = run(answer("q1", 0), answer("q2", 1), { type: "check" });
    expect(wrongIds(checked)).toEqual(["q2"]);
    const retry = studyReducer(checked, { type: "retryWrong" });
    expect(retry).toMatchObject({ round: ["q2"], checked: false, answers: { q1: 0 } });
    const again = [answer("q2", 0), { type: "check" } as StudyAction].reduce(studyReducer, retry);
    expect(wrongIds(again)).toEqual([]);
  });

  it("restart brings back every question", () => {
    const s = run(answer("q1", 1), answer("q2", 1), { type: "check" }, { type: "retryWrong" }, { type: "restartQuiz" });
    expect(s).toMatchObject({ round: ["q1", "q2"], answers: {}, checked: false });
  });

  it("starts in quiz mode when there are no flashcards", () => {
    expect(initStudy({ ...DATA, flashcards: [] }).mode).toBe("quiz");
  });
});

describe("StudyView", () => {
  it("flips a card and marks it known", async () => {
    render(<StudyView data={DATA} />);
    await userEvent.click(screen.getByRole("button", { name: /Question: Powerhouse\?/ }));
    expect(screen.getByText("Mitochondria")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByText("Card 2 of 3, 1 known")).toBeInTheDocument();
  });

  it("takes the quiz, shows the score and retries the wrong one", async () => {
    render(<StudyView data={DATA} />);
    await userEvent.click(screen.getByRole("tab", { name: "Quiz (2)" }));
    await userEvent.click(screen.getByLabelText("Matrix"));
    await userEvent.click(screen.getByLabelText("36"));
    await userEvent.click(screen.getByRole("button", { name: "Check answers" }));
    expect(screen.getByRole("status")).toHaveTextContent("Score: 1 / 2");
    expect(screen.getByText("In the matrix.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry 1 wrong" }));
    expect(screen.queryByText("Krebs cycle site?")).toBeNull();
    await userEvent.click(screen.getByLabelText("2"));
    await userEvent.click(screen.getByRole("button", { name: "Check answers" }));
    expect(screen.getByRole("status")).toHaveTextContent("Score: 1 / 1");
  });
});
