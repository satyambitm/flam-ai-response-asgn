from fastapi import APIRouter

from app.api.schemas import Health

router = APIRouter()


@router.get("/health")
def health() -> Health:
    return Health()
