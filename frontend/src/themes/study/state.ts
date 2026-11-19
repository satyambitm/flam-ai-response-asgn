/** Study-session interaction state: flashcard review + quiz rounds. Pure, so it's tested without React. */

import type { components } from "../../core/api-types";

export type StudySet = components["schemas"]["StudySet"];
export type Skill = components["schemas"]["QuizQuestion"]["skill"];

export interface StudyState {
  mode: "cards" | "quiz";
  // flashcards
  cards: string[]; // every card id, original order
  deck: string[]; // card ids in the current review pass
  index: number;
  flipped: boolean;
  hinted: boolean;
  known: ReadonlySet<string>;
  marked: ReadonlySet<string>; // cards given a verdict this pass; the pass is done when it covers the deck
  // quiz: one question at a time, each locked once answered
  questions: string[]; // every question id, original order
  answerKey: Readonly<Record<string, number>>;
  round: string[]; // question ids in the current round
  answers: Readonly<Record<string, number>>;
  at: number; // index into round; round.length means the round is over
}

export type StudyAction =
  | { type: "mode"; mode: StudyState["mode"] }
  | { type: "flip" }
  | { type: "hint" }
  | { type: "move"; by: 1 | -1 }
  | { type: "mark"; known: boolean }
  | { type: "reviewUnknown" }
  | { type: "resetCards" }
  | { type: "answer"; questionId: string; option: number }
  | { type: "next" }
  | { type: "retryWrong" }
  | { type: "restartQuiz" };

export function initStudy(data: StudySet): StudyState {
  const cards = data.flashcards.map((c) => c.id);
  return {
    mode: cards.length ? "cards" : "quiz",
    ...freshPass(cards),
    cards,
    known: new Set(),
    questions: data.quiz.map((q) => q.id),
    answerKey: Object.fromEntries(data.quiz.map((q) => [q.id, q.answerIndex])),
    round: data.quiz.map((q) => q.id),
    answers: {},
    at: 0,
  };
}

function freshPass(deck: string[]) {
  return { deck, index: 0, flipped: false, hinted: false, marked: new Set<string>() };
}

export const deckDone = (s: StudyState) => s.deck.length > 0 && s.deck.every((id) => s.marked.has(id));
export const roundDone = (s: StudyState) => s.at >= s.round.length;

export function wrongIds(state: StudyState): string[] {
  return state.round.filter((id) => state.answers[id] !== state.answerKey[id]);
}

export function studyReducer(state: StudyState, action: StudyAction): StudyState {
  switch (action.type) {
    case "mode":
      return { ...state, mode: action.mode };

    case "flip":
      return { ...state, flipped: !state.flipped };

    case "hint":
      return { ...state, hinted: true };

    case "move": {
      const index = Math.min(Math.max(state.index + action.by, 0), state.deck.length - 1);
      return { ...state, index, flipped: false, hinted: false };
    }

    case "mark": {
      const id = state.deck[state.index];
      if (id === undefined) return state;
      const known = new Set(state.known);
      if (action.known) known.add(id);
      else known.delete(id);
      const marked = new Set(state.marked).add(id);
      // the next card without a verdict, wrapping, so skipped cards come back before the pass ends
      const n = state.deck.length;
      const ahead = Array.from({ length: n }, (_, k) => (state.index + 1 + k) % n);
      const index = ahead.find((i) => !marked.has(state.deck[i])) ?? state.index;
      return { ...state, known, marked, index, flipped: false, hinted: false };
    }

    case "reviewUnknown": {
      const deck = state.deck.filter((id) => !state.known.has(id));
      return deck.length ? { ...state, ...freshPass(deck) } : state;
    }

    case "resetCards":
      return { ...state, ...freshPass(state.cards), known: new Set() };

    case "answer": {
      const current = state.round[state.at];
      if (action.questionId !== current || current in state.answers) return state;
      return { ...state, answers: { ...state.answers, [current]: action.option } };
    }

    case "next":
      return state.round[state.at] in state.answers ? { ...state, at: state.at + 1 } : state;

    case "retryWrong": {
      const round = wrongIds(state);
      if (!roundDone(state) || !round.length) return state;
      const answers = Object.fromEntries(Object.entries(state.answers).filter(([id]) => !round.includes(id)));
      return { ...state, round, answers, at: 0 };
    }

    case "restartQuiz":
      return { ...state, round: state.questions, answers: {}, at: 0 };
  }
}
