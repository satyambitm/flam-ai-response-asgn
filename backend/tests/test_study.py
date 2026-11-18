import json

import pytest
from pydantic import ValidationError

from app.core import pipeline
from app.core.errors import AppError, ErrorKind
from app.providers.base import Completion
from app.providers.mock import Fault, MockProvider
from app.themes.study import MAX_CARDS, StudySet, StudyTheme

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
    assert [(q.question, q.options, q.answerIndex) for q in data.quiz] == [("Q1", ["a", "b"], 1)]
    assert all(len(x.id) == 8 for x in [*data.flashcards, *data.quiz])


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
    assert env.meta.repaired and env.data.quiz[0].answerIndex == 0


@pytest.mark.parametrize(
    ("fault", "kind"), [(Fault.EMPTY, ErrorKind.EMPTY), (Fault.WRONG_SHAPE, ErrorKind.INVALID_SHAPE)]
)
async def test_mock_faults_work_for_study(fault, kind):
    with pytest.raises(AppError) as exc:
        await pipeline.generate(THEME, "cells", [MockProvider(fault, THEME.example)], total_s=30, provider_s=20)
    assert exc.value.kind is kind
