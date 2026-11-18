"""Run: cd pipeline && python3 -m pytest test_languages.py (or python3 test_languages.py)."""
import languages as L


def test_tr_falls_back_to_english_then_french_and_counts():
    L.fallen_back.clear()
    assert L.tr({"fr": "a", "en": "b", "de": "c"}, "de") == "c"
    assert L.tr({"fr": "a", "en": "b"}, "de") == "b"
    assert L.tr({"fr": "a"}, "de") == "a"
    assert L.fallen_back == {"de": 2}


def test_row_follows_build_order():
    t = {"fr": "a", "en": "b", "de": "c"}
    assert L.row(t) == [t[c] for c in L.BUILD]


def test_fill_missing_uses_english():
    locas = [{1: "fr1"}, {1: "en1", 2: "en2"}, {}]
    assert L.BUILD == ("fr", "en", "de")
    L.fill_missing(locas)
    assert locas[0][2] == "en2" and locas[2] == {1: "en1", 2: "en2"} and locas[0][1] == "fr1"


def test_every_build_language_has_a_game_name():
    assert all(c in L.GAME_NAMES for c in L.BUILD) and L.BUILD[L.FR] == "fr" and L.BUILD[L.EN] == "en"


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
    print("ok")
