import time


class Deadline:
    """Total time budget for one request, shared by every provider call in it."""

    def __init__(self, total_s: float):
        self._end = time.monotonic() + total_s

    def left(self) -> float:
        return max(0.0, self._end - time.monotonic())
