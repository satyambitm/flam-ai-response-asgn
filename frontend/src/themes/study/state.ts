/** Study-session interaction state: flashcard review + quiz rounds. Pure, so it's tested without React. */

import type { components } from "../../core/api-types";

export type StudySet = components["schemas"]["StudySet"];

export interface StudyState {
  mode: "cards" | "quiz";
  // flashcards
  cards: string[]; // every card id, original order
  deck: string[]; // card ids in the current review pass
  index: number;
  flipped: boolean;
  known: ReadonlySet<string>;
  // quiz
  answerKey: Readonly<Record<string, number>>;
  round: string[]; // question ids in the current round
  answers: Readonly<Record<string, number>>;
  checked: boolean;
}

export type StudyAction =
  | { type: "mode"; mode: StudyState["mode"] }
  | { type: "flip" }
  | { type: "move"; by: 1 | -1 }
  | { type: "mark"; known: boolean }
  | { type: "reviewUnknown" }
  | { type: "resetCards" }
  | { type: "answer"; questionId: string; option: number }
  | { type: "check" }
  | { type: "retryWrong" }
  | { type: "restartQuiz" };

export function initStudy(data: StudySet): StudyState {
  return {
    mode: data.flashcards.length ? "cards" : "quiz",
    cards: data.flashcards.map((c) => c.id),
    deck: data.flashcards.map((c) => c.id),
    index: 0,
    flipped: false,
    known: new Set(),
    answerKey: Object.fromEntries(data.quiz.map((q) => [q.id, q.answerIndex])),
    round: data.quiz.map((q) => q.id),
    answers: {},
    checked: false,
  };
}

export function wrongIds(state: StudyState): string[] {
  return state.round.filter((id) => state.answers[id] !== state.answerKey[id]);
}

export function studyReducer(state: StudyState, action: StudyAction): StudyState {
  switch (action.type) {
    case "mode":
      return { ...state, mode: action.mode };

    case "flip":
      return { ...state, flipped: !state.flipped };

    case "move": {
      const index = Math.min(Math.max(state.index + action.by, 0), state.deck.length - 1);
      return { ...state, index, flipped: false };
    }

    case "mark": {
      const id = state.deck[state.index];
      if (id === undefined) return state;
      const known = new Set(state.known);
      if (action.known) known.add(id);
      else known.delete(id);
      const index = Math.min(state.index + 1, state.deck.length - 1);
      return { ...state, known, index, flipped: false };
    }

    case "reviewUnknown": {
      const deck = state.deck.filter((id) => !state.known.has(id));
      return deck.length ? { ...state, deck, index: 0, flipped: false } : state;
    }

    case "resetCards":
      return { ...state, deck: state.cards, index: 0, flipped: false, known: new Set() };

    case "answer":
      if (state.checked || !state.round.includes(action.questionId)) return state;
      return { ...state, answers: { ...state.answers, [action.questionId]: action.option } };

    case "check":
      return state.round.every((id) => id in state.answers) ? { ...state, checked: true } : state;

    case "retryWrong": {
      const round = wrongIds(state);
      if (!state.checked || !round.length) return state;
      const answers = Object.fromEntries(Object.entries(state.answers).filter(([id]) => !round.includes(id)));
      return { ...state, round, answers, checked: false };
    }

    case "restartQuiz":
      return { ...state, round: Object.keys(state.answerKey), answers: {}, checked: false };
  }
}
