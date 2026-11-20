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


def test_split_keeps_every_language_and_walks_like_js():
    import split_languages as S
    n = 3
    out = [[] for _ in range(n)]
    data = {"b": {"name": ["b1", "b2", "b3"]}, "2": {"text": ["a", "b", "c"], "tags": ["x", "y", "z"]}, "1": {"desc": ["d", "e", "f"]}}
    base = S.split_value(data, "", n, out)
    assert list(base) == ["1", "2", "b"]  # array indexes first, like JS
    assert base["1"]["desc"] == ["", "", ""] and base["2"]["tags"] == ["x", "y", "z"]
    kept = S.split_value({"stats": [{"name": ["h", "i", "j"]}]}, "", n, [[] for _ in range(n)])
    assert kept == {"stats": [{"name": ["h", "i", "j"]}]}  # stat lines stay whole
    assert out == [["d", "a", "b1"], ["e", "b", "b2"], ["f", "c", "b3"]]



def test_split_refuses_a_file_that_is_already_split(tmp_path):
    import json
    import split_languages as S
    f = tmp_path / "x"
    (tmp_path / "x.json").write_text(json.dumps({"name": ["a", "b", "c"]}))
    S.split_file(str(f), L.BUILD)
    try:
        S.split_file(str(f), L.BUILD)
    except SystemExit:
        assert json.loads((tmp_path / "x.fr.json").read_text()) == ["a"]  # the texts were not overwritten
    else:
        raise AssertionError("split twice should refuse")


if __name__ == "__main__":
    import pathlib, tempfile
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(pathlib.Path(tempfile.mkdtemp())) if f.__code__.co_argcount else f()
    print("ok")
