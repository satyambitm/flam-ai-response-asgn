"""Study assistant: notes or a topic → flashcards + a multiple-choice quiz."""

import random
import re
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.themes.base import Prompt, new_id

MAX_CARDS = 20
MAX_QUESTIONS = 10
SKILLS = ("recall", "apply", "analyze")

_rng = random.Random()
# The UI marks right and wrong itself, so a "Wrong: " lead-in would say it twice.
_VERDICT_PREFIX = re.compile(r"^(?:right|wrong|correct|incorrect)\b[\s:.,!-]*", re.IGNORECASE)


class Flashcard(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = ""
    front: str
    back: str
    hint: str = ""  # a cue toward the answer, never the answer itself
    detail: str = ""  # the why, an example or the mechanism behind the answer
    section: str = ""  # sub-topic; cards sharing one are grouped


class QuizQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = ""
    question: str
    options: list[str] = Field(min_length=2, max_length=6)
    answerIndex: int
    explanation: str = ""
    # One note per option, same order: why it's right, or why it's tempting but wrong.
    rationales: list[str] = []
    skill: Literal["recall", "apply", "analyze"] = "recall"

    @field_validator("skill", mode="before")
    @classmethod
    def _known_skill(cls, v: Any) -> str:
        # An invented label only changes a tag, so it isn't worth a repair round trip.
        v = str(v).strip().lower().replace("analyse", "analyze")
        return v if v in SKILLS else "recall"

    @model_validator(mode="after")
    def _answer_in_range(self) -> Self:
        # Semantic check the JSON schema can't express; its message goes back to the model on repair.
        if not 0 <= self.answerIndex < len(self.options):
            raise ValueError(f"answerIndex {self.answerIndex} is out of range for {len(self.options)} options")
        return self


class StudySet(BaseModel):
    model_config = ConfigDict(extra="ignore")
    topic: str
    summary: str = ""
    flashcards: list[Flashcard]
    quiz: list[QuizQuestion]


class StudyTheme:
    id = "study"
    title = "Study assistant"
    input_hint = "Paste your notes or name a topic, e.g. “Photosynthesis: light reactions vs Calvin cycle”."
    max_input_chars = 4000
    Schema = StudySet
    example = {
        "topic": "Photosynthesis",
        "summary": "How plants turn light, water and CO2 into sugar, in two linked stages.",
        "flashcards": [
            {
                "section": "Light reactions",
                "front": "Where in the chloroplast do the light reactions happen?",
                "back": "In the thylakoid membranes.",
                "hint": "Think of the stacked discs inside the chloroplast.",
                "detail": "Chlorophyll in those membranes absorbs light and drives the electron transport chain.",
            },
            {
                "section": "Calvin cycle",
                "front": "What does the Calvin cycle need from the light reactions?",
                "back": "ATP and NADPH.",
                "hint": "One carries energy, the other carries electrons.",
                "detail": "Both are spent fixing CO2 into G3P, then rebuilt by the light reactions.",
            },
        ],
        "quiz": [
            {
                "question": "A plant is kept in the dark but given plenty of CO2. What stops first?",
                "options": ["Making ATP and NADPH", "Taking up water", "Releasing CO2", "Cell division"],
                "answerIndex": 0,
                "explanation": "The light reactions need light; without their ATP and NADPH the Calvin cycle stalls.",
                "rationales": [
                    "The light reactions make ATP and NADPH, and they need light.",
                    "Roots keep taking up water in the dark.",
                    "Respiration releases CO2 day and night.",
                    "Cell division doesn't depend directly on light.",
                ],
                "skill": "apply",
            }
        ],
    }

    def build_prompt(self, user_input: str) -> Prompt:
        return Prompt(
            system=(
                "You are a study assistant who writes material a good teacher would hand out. "
                "From the user's notes, or the topic they name, write:\n"
                "- summary: one or two plain sentences on what the material covers.\n"
                "- 6-12 flashcards in 2-4 sections (short sub-topic names shared by their cards, in teaching "
                "order). Each card tests one idea. front: a specific question, never yes/no; mix definitions, "
                "causes and effects, comparisons and sequences. back: the answer in under 20 words. hint: a cue "
                "that points toward the answer without giving it away. detail: one sentence of why, an example "
                "or the mechanism, adding something the back doesn't say.\n"
                "- 4-8 multiple-choice questions with 4 options and exactly one correct answer; answerIndex is "
                "its 0-based index. Wrong options must be plausible: common misconceptions, similar in length "
                "and grammar to the answer, never 'all/none of the above'. rationales: one short note per "
                "option, in the same order, saying why it is right or why it is tempting but wrong, without a "
                "'Right:' or 'Wrong:' label. "
                "explanation: the key idea in one sentence. skill: 'recall' for a fact, 'apply' for using it in "
                "a new situation, 'analyze' for comparing or reasoning about causes; include at least one apply "
                "or analyze question.\n"
                "When notes are given, use only facts from them; for a bare topic, use well-established facts and "
                "don't call them 'the notes'. "
                "If it contains nothing that can be studied, return empty flashcards and quiz lists."
            ),
            user=user_input,
        )

    def normalize(self, data: StudySet) -> StudySet:
        cards = [
            Flashcard(
                id=new_id(),
                front=front,
                back=back,
                hint="" if (hint := c.hint.strip()).lower() == back.lower() else hint,  # a hint can't be the answer
                detail=c.detail.strip(),
                section=c.section.strip(),
            )
            for c in data.flashcards
            if (front := c.front.strip()) and (back := c.back.strip())
        ]
        questions = [_clean_question(q) for q in data.quiz]
        return StudySet(
            topic=data.topic.strip() or "Study set",
            summary=data.summary.strip(),
            flashcards=_group_by_section(cards[:MAX_CARDS]),
            quiz=[q for q in questions if q is not None][:MAX_QUESTIONS],
        )

    def is_empty(self, data: StudySet) -> bool:
        return not data.flashcards and not data.quiz


def _group_by_section(cards: list[Flashcard]) -> list[Flashcard]:
    """Cards of one section sit together, sections in first-seen order, so the deck reads chapter by chapter."""
    first: dict[str, int] = {}
    for i, c in enumerate(cards):
        first.setdefault(c.section, i)
    return sorted(cards, key=lambda c: first[c.section])  # stable: card order within a section is kept


def _clean_question(q: QuizQuestion, rng: random.Random = _rng) -> QuizQuestion | None:
    """Drop a question rather than guess: blank text or blank options would shift answerIndex.

    Options are shuffled because models put the right answer in the same slot far more often than chance.
    """
    options = [o.strip() for o in q.options]
    if not q.question.strip() or not all(options) or len(set(options)) != len(options):
        return None
    rationales = [_VERDICT_PREFIX.sub("", r.strip(), count=1) for r in q.rationales]
    if len(rationales) != len(options) or not all(rationales):
        rationales = []  # misaligned notes would explain the wrong option
    order = list(range(len(options)))
    rng.shuffle(order)
    return QuizQuestion(
        id=new_id(),
        question=q.question.strip(),
        options=[options[i] for i in order],
        answerIndex=order.index(q.answerIndex),
        explanation=q.explanation.strip(),
        rationales=[rationales[i] for i in order] if rationales else [],
        skill=q.skill,
    )
