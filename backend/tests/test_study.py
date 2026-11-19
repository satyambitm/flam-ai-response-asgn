import json
import random

import pytest
from pydantic import ValidationError

from app.core import pipeline
from app.core.errors import AppError, ErrorKind
from app.providers.base import Completion
from app.providers.mock import Fault, MockProvider
from app.themes.study import MAX_CARDS, QuizQuestion, StudySet, StudyTheme, _clean_question

THEME = StudyTheme()


def question(**overrides) -> dict:
    return {"question": "Q?", "options": ["a", "b", "c", "d"], "answerIndex": 0} | overrides


def study(**overrides) -> dict:
    return {"topic": "T", "flashcards": [{"front": "f", "back": "b"}], "quiz": [question()]} | overrides


def test_answer_index_out_of_range_is_a_validation_error_with_a_useful_message():
    with pytest.raises(ValidationError, match="answerIndex 4 is out of range for 4 options"):
        StudySet.model_validate(study(quiz=[question(answerIndex=4)]))


@pytest.mark.parametrize("options", [["only one"], ["a", "b", "c", "d", "e", "f", "g"]])
def test_option_count_is_bounded(options):
    with pytest.raises(ValidationError):
        StudySet.model_validate(study(quiz=[question(options=options)]))


def test_normalize_trims_assigns_ids_and_drops_unusable_items():
    raw = StudySet.model_validate(
        study(
            topic="  ",
            flashcards=[{"front": " f ", "back": " b "}, {"front": "x", "back": "  "}],
            quiz=[
                question(question=" Q1 ", options=[" a ", "b"], answerIndex=1),
                question(options=["a", " "]),  # blank option would shift answerIndex: dropped
                question(options=["a", "a"]),  # duplicate options: dropped
                question(question="  "),
            ],
        )
    )
    data = THEME.normalize(raw)
    assert data.topic == "Study set"
    assert [(c.front, c.back) for c in data.flashcards] == [("f", "b")]
    [q] = data.quiz
    assert (q.question, sorted(q.options), q.options[q.answerIndex]) == ("Q1", ["a", "b"], "b")
    assert all(len(x.id) == 8 for x in [*data.flashcards, *data.quiz])


def test_shuffle_keeps_the_answer_and_each_rationale_on_its_option():
    q = QuizQuestion.model_validate(question(answerIndex=2, rationales=["no a", "no b", "yes c", "no d"]))
    positions = set()
    for seed in range(40):
        out = _clean_question(q, random.Random(seed))
        assert out.options[out.answerIndex] == "c"
        assert [r.split()[1] for r in out.rationales] == out.options
        positions.add(out.answerIndex)
    assert positions == {0, 1, 2, 3}  # the right answer moves between slots


def test_verdict_lead_ins_are_stripped_from_rationales():
    q = question(options=["a", "b"], rationales=["Right: because x", "Wrong - rightly tempting"])
    out = _clean_question(QuizQuestion.model_validate(q))
    assert sorted(out.rationales) == ["because x", "rightly tempting"]


@pytest.mark.parametrize("rationales", [["only one"], ["a", "", "c", "d"]])
def test_misaligned_rationales_are_dropped_not_the_question(rationales):
    out = _clean_question(QuizQuestion.model_validate(question(rationales=rationales)))
    assert out is not None and out.rationales == []


@pytest.mark.parametrize(("raw", "skill"), [("Apply", "apply"), ("analyse", "analyze"), ("evaluate", "recall")])
def test_unknown_skill_labels_fall_back_instead_of_failing(raw, skill):
    assert QuizQuestion.model_validate(question(skill=raw)).skill == skill


def test_cards_are_grouped_by_section_in_first_seen_order_and_hints_never_repeat_the_answer():
    cards = [
        {"front": "1", "back": "x", "section": "A"},
        {"front": "2", "back": "y", "section": "B", "hint": " Y "},
        {"front": "3", "back": "z", "section": "A", "hint": "starts with z"},
    ]
    data = THEME.normalize(StudySet.model_validate(study(flashcards=cards)))
    assert [(c.front, c.section) for c in data.flashcards] == [("1", "A"), ("3", "A"), ("2", "B")]
    assert [c.hint for c in data.flashcards] == ["", "starts with z", ""]


def test_example_is_a_valid_study_set():
    data = THEME.normalize(StudySet.model_validate(THEME.example))
    assert all(c.hint and c.detail and c.section for c in data.flashcards)
    assert all(len(q.rationales) == len(q.options) for q in data.quiz)


def test_normalize_caps_list_sizes():
    raw = StudySet.model_validate(study(flashcards=[{"front": str(i), "back": "b"} for i in range(30)]))
    assert len(THEME.normalize(raw).flashcards) == MAX_CARDS


def test_empty_when_no_cards_and_no_questions():
    assert THEME.is_empty(THEME.normalize(StudySet.model_validate(study(flashcards=[], quiz=[]))))
    assert not THEME.is_empty(THEME.normalize(StudySet.model_validate(study(flashcards=[]))))


async def test_out_of_range_answer_goes_through_repair():
    class Bad:
        name, model = "scripted", "m"
        calls = 0

        async def generate(self, **kwargs):

            self.calls += 1
            bad = study(quiz=[question(answerIndex=9)])
            return Completion(json.dumps(bad if self.calls == 1 else study()))

    env = await pipeline.generate(THEME, "cells", [Bad()], total_s=30, provider_s=20)
    [q] = env.data.quiz
    assert env.meta.repaired and q.options[q.answerIndex] == "a"


@pytest.mark.parametrize(
    ("fault", "kind"), [(Fault.EMPTY, ErrorKind.EMPTY), (Fault.WRONG_SHAPE, ErrorKind.INVALID_SHAPE)]
)
async def test_mock_faults_work_for_study(fault, kind):
    with pytest.raises(AppError) as exc:
        await pipeline.generate(THEME, "cells", [MockProvider(fault, THEME.example)], total_s=30, provider_s=20)
    assert exc.value.kind is kind
