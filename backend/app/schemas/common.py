from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    """No type coercion, no unknown fields."""

    model_config = ConfigDict(strict=True, extra="forbid")
