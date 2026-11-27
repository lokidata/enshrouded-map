"""Property-based fuzzing of the add-on manifest parser: arbitrary JSON in, a list or None out."""

from hypothesis import given
from hypothesis import strategies as st

from app.core.addons import parse_manifest

json_values = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False) | st.text(),
    lambda children: (
        st.lists(children, max_size=5) | st.dictionaries(st.text(), children, max_size=5)
    ),
    max_leaves=30,
)


@given(json_values)
def test_parse_manifest_never_raises(raw: object) -> None:
    result = parse_manifest("demo", raw)
    assert result is None or isinstance(result, list)
