"""Serialisierung + Qualitaetspruefung fuer die neu geschriebenen Quizfragen.

Dieses Modul *generiert keine Inhalte*. Es nimmt handgeschriebene Fragen in
kompakter Form entgegen, schreibt sie in das JSON-Format aus dem README und
prueft sie danach gegen die Regeln, die wir mit dem Nutzer vereinbart haben:
100 Fragen je Datei (32 single / 32 multiple / 36 text), kein Laengenbias,
keine Schablonen, keine Dubletten.

Aufruf pro Datei:  python3 .quiz-rebuild/src_<name>.py
"""

import json
import os
import re
import statistics
import subprocess
import sys
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUIZ_DIR = os.path.join(REPO, "src", "quizzes")

TARGET = {"single": 32, "multiple": 32, "text": 36}

# Deutsche Woerter, in denen ae/oe/ue/ss voellig korrekt sind - alles andere in
# den DE-Feldern gilt als ASCII-Umschrift und wird abgelehnt. Ein deutscher
# Pruefungstrainer, der Umlaute als ae/oe/ue ausschreibt, sieht kaputt aus.
UMLAUT_OK = (
    "neu", "genau", "dauer", "aktuell", "manuell", "virtuell", "individuell",
    "eventuell", "quell", "queue", "quer", "frequenz", "sequenz", "konsequen",
    "teuer", "feuer", "true", "uniqu", "bequem", "abenteuer", "treu", "trauer", "bauer", "mauer", "sauer",
    "zuerst", "einstreu", "auer", "auen", "statuen", "akku", "vakuum", "kontinu",
    "influen", "issue", "queri", "query", "request", "guest", "does", "goes", "value",
)
UMLAUT_OK_SS = (
    "adress", "address", "access", "anschluss", "aussage", "einfluss", "dass",
    "muss", "lass", "laess", "pass", "fass", "mess", "gemessen", "klass",
    "ergebnis", "verzeichnis", "schluss", "schluess", "wessen", "sodass",
    "beeinfluss", "umfass", "massen", "prozess", "interess", "kompress",
    "ssh", "ssid", "ssl", "assembl", "session", "kassen", "wasser", "besser",
    "bass", "russ", "diskussion", "professionell", "essenz", "ressource",
)

# --- Autorenformat -------------------------------------------------------
# Die Optionsreihenfolge ist in DE und EN identisch, deshalb reicht ein Index
# fuer die richtige Antwort und der Builder zieht sich beide Sprachen daraus.


def S(qid, q_de, opts_de, correct, expl_de, q_en, opts_en, expl_en):
    """Single choice: genau eine richtige Option (correct = Index)."""
    return {
        "_t": "single", "id": qid,
        "q": (q_de, q_en), "o": (list(opts_de), list(opts_en)),
        "a": correct, "e": (expl_de, expl_en),
    }


def _vary_shapes(items):
    """Variiert die Anzahl richtiger Antworten ueber alle multiple-Fragen.

    Ohne das haetten alle multiple-Fragen dieselbe Zahl richtiger Optionen und
    "immer vier anklicken" waere eine Strategie ganz ohne Fachwissen. Entfernt
    werden nur *richtige* Optionen vom Ende des richtigen Blocks - die falschen
    bleiben an ihrer Stelle, damit Erklaerungen, die sich auf "die letzten
    beiden Aussagen" beziehen, weiterhin stimmen.

    Reihum statt per Hash, damit die drei Formen exakt gleich haeufig auftreten;
    bei nur 32 Fragen je Datei streut ein Hash zu stark.
    """
    n = 0
    for it in items:
        if it["_t"] != "multiple":
            continue
        drop = n % 3
        n += 1
        if drop == 0 or len(it["a"]) - drop < 2:
            continue
        de, en, corr = _drop_correct(it["o"][0], it["o"][1], it["a"], drop)
        it["o"] = (de, en)
        it["a"] = corr
    return items


def _drop_correct(opts_de, opts_en, correct, drop):
    removed = set(correct[-drop:])
    keep_idx = [i for i in range(len(opts_de)) if i not in removed]
    remap = {old: new for new, old in enumerate(keep_idx)}
    return ([opts_de[i] for i in keep_idx],
            [opts_en[i] for i in keep_idx],
            [remap[i] for i in correct[:-drop]])


def M(qid, q_de, opts_de, correct, expl_de, q_en, opts_en, expl_en):
    """Multiple choice: mehrere richtige Optionen (correct = Index-Tupel)."""
    return {
        "_t": "multiple", "id": qid,
        "q": (q_de, q_en), "o": (list(opts_de), list(opts_en)),
        "a": list(correct), "e": (expl_de, expl_en),
    }


def T(qid, q_de, ans_de, expl_de, q_en, ans_en, expl_en):
    """Freitext: kurze, exakt pruefbare Antwort."""
    return {
        "_t": "text", "id": qid,
        "q": (q_de, q_en), "o": None,
        "a": (ans_de, ans_en), "e": (expl_de, expl_en),
    }


# --- Serialisierung ------------------------------------------------------

def _to_json(item, cat_de, cat_en):
    t = item["_t"]
    out = {
        "id": item["id"],
        "type": t,
        "category": cat_de,
        "question": item["q"][0],
    }
    tr = {"question": item["q"][1]}

    if t == "text":
        out["answer"] = item["a"][0]
        tr["answer"] = item["a"][1]
    else:
        de, en = item["o"]
        out["options"] = de
        tr["options"] = en
        if t == "single":
            out["answer"] = de[item["a"]]
            tr["answer"] = en[item["a"]]
        else:
            out["answer"] = [de[i] for i in item["a"]]
            tr["answer"] = [en[i] for i in item["a"]]

    out["explanation"] = item["e"][0]
    tr["explanation"] = item["e"][1]
    tr["category"] = cat_en
    out["translations"] = {"en": tr}
    return out


# --- Pruefungen ----------------------------------------------------------

def _de_text(q):
    """Alle deutschsprachigen Felder einer Frage."""
    out = [q["question"], q["explanation"]]
    out += q.get("options") or []
    a = q["answer"]
    out += a if isinstance(a, list) else [a]
    return out


def _umlaut_errors(questions):
    """Findet ASCII-Umschrift statt echter Umlaute in den deutschen Feldern.

    Geprueft wird auf der Originalschreibweise: nur ein echter Kleinbuchstaben-
    Digraph zaehlt. Dadurch bleiben Abkuerzungen wie PoE oder AES unbehelligt,
    in denen auf den Kleinbuchstaben ein Grossbuchstabe folgt.
    """
    bad = {}
    for q in questions:
        for word in re.findall(r"[A-Za-zÄÖÜäöüß]+", " ".join(_de_text(q))):
            low = word.lower()
            digraph = re.search(r"ae|oe|ue", word) or re.match(r"(Ae|Oe|Ue)", word)
            if digraph and not any(ok in low for ok in UMLAUT_OK):
                bad.setdefault(word, q["id"])
            elif "ss" in low and not any(ok in low for ok in UMLAUT_OK_SS) and re.search(
                    r"gross|heiss|ausser|draussen|massnahm|maessig|schliesslich", low):
                bad.setdefault(word, q["id"])
    return bad


def _check(questions, filename, old_ids):
    errs, warns = [], []

    bad = _umlaut_errors(questions)
    if bad:
        sample = ", ".join(f"{w} ({i})" for w, i in list(bad.items())[:6])
        errs.append(f"ASCII-Umschrift statt Umlaut/Eszett in {len(bad)} Woertern: {sample}")

    types = Counter(q["type"] for q in questions)
    if len(questions) != 100:
        errs.append(f"{len(questions)} Fragen statt 100")
    for t, want in TARGET.items():
        if types[t] != want:
            errs.append(f"Typ '{t}': {types[t]} statt {want}")

    ids = [q["id"] for q in questions]
    dup = [i for i, c in Counter(ids).items() if c > 1]
    if dup:
        errs.append(f"doppelte ids: {dup}")
    reused = sorted(set(ids) & old_ids)
    if reused:
        errs.append(f"ids aus der alten Version wiederverwendet: {reused[:5]}")

    # Dubletten im Inhalt
    for field, label in ((("question",), "Fragetext"), (("explanation",), "Erklaerung")):
        seen = Counter(q[field[0]].strip().lower() for q in questions)
        d = [k[:50] for k, c in seen.items() if c > 1]
        if d:
            errs.append(f"doppelter {label}: {d[:3]}")

    # Schablonen: gleicher Fragebeginn zu oft
    stems = Counter(" ".join(q["question"].split()[:4]).lower() for q in questions)
    hot = [(k, c) for k, c in stems.items() if c > 4]
    if hot:
        errs.append(f"Schablonen-Fragebeginn (>4x): {hot}")

    # Erklaerungs-Boilerplate: gleicher Schlusssatz zu oft
    tails = Counter()
    for q in questions:
        parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", q["explanation"]) if p.strip()]
        if parts:
            tails[parts[-1].lower()] += 1
    hot = [(k[:45], c) for k, c in tails.items() if c > 2]
    if hot:
        errs.append(f"Boilerplate-Schlusssatz (>2x): {hot}")

    # Laengenbias -- das eigentliche "erratbar"-Leck
    corr, wrong, longest = [], [], 0
    n_mc = 0
    for q in questions:
        if q["type"] == "text":
            if len(q["answer"]) > 70:
                warns.append(f"{q['id']}: Textantwort sehr lang ({len(q['answer'])})")
            continue
        n_mc += 1
        ans = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
        for o in q["options"]:
            (corr if o in ans else wrong).append(len(o))
        mx = max(len(o) for o in q["options"])
        if all(len(a) == mx for a in ans) and len({len(o) for o in q["options"]}) > 1:
            longest += 1

    # Form der multiple-Fragen: kommt eine Kombination zu oft vor, laesst sich
    # die Antwortzahl erraten, ohne die Frage zu lesen.
    shapes = Counter((len(q["options"]), len(q["answer"]))
                     for q in questions if q["type"] == "multiple")
    n_mult = sum(shapes.values())
    if n_mult:
        top, cnt = shapes.most_common(1)[0]
        if cnt / n_mult > 0.45:
            errs.append(f"multiple-Form {top[0]} Optionen/{top[1]} richtig kommt in "
                        f"{cnt/n_mult:.0%} der Faelle vor (Ziel <=45%)")

    ratio = statistics.mean(corr) / statistics.mean(wrong)
    share = longest / n_mc
    if not 0.90 <= ratio <= 1.10:
        errs.append(f"Laengenbias: richtige Optionen {ratio:.2f}x so lang wie falsche (Ziel 0.90-1.10)")
    if share > 0.32:
        errs.append(f"in {share:.0%} der MC-Fragen ist die richtige Option die laengste (Ziel <=32%)")

    # Strukturelle Integritaet
    for q in questions:
        tr = q["translations"]["en"]
        if q["type"] == "text":
            if q.get("options"):
                errs.append(f"{q['id']}: text-Frage mit options")
        else:
            o = q["options"]
            if len(o) != len(set(o)):
                errs.append(f"{q['id']}: doppelte Optionen")
            if len(o) != len(tr["options"]):
                errs.append(f"{q['id']}: EN-Optionen haben andere Anzahl")
            ans = q["answer"] if isinstance(q["answer"], list) else [q["answer"]]
            missing = [a for a in ans if a not in o]
            if missing:
                errs.append(f"{q['id']}: answer nicht in options: {missing}")
            if q["type"] == "single" and isinstance(q["answer"], list):
                errs.append(f"{q['id']}: single mit Listen-answer")
            if q["type"] == "multiple":
                if not isinstance(q["answer"], list) or not 2 <= len(q["answer"]) < len(o):
                    errs.append(f"{q['id']}: multiple braucht 2..n-1 richtige Optionen")
                if len(o) < 4:
                    warns.append(f"{q['id']}: nur {len(o)} Optionen bei multiple")
        for k in ("question", "answer", "explanation", "category"):
            if not tr.get(k):
                errs.append(f"{q['id']}: EN-Uebersetzung fehlt: {k}")
        if len(q["question"]) > 210:
            warns.append(f"{q['id']}: Frage lang ({len(q['question'])} Zeichen)")
        if len(q["explanation"]) < 40:
            warns.append(f"{q['id']}: Erklaerung sehr kurz")

    qlens = [len(q["question"]) for q in questions]
    stats = (f"  Typen {dict(types)} | Frage ⌀{statistics.mean(qlens):.0f} max {max(qlens)} Zeichen\n"
             f"  Optionslaenge richtig/falsch = {ratio:.2f} | laengste-ist-richtig {share:.0%}\n"
             f"  multiple-Formen (Optionen/richtig): {dict(sorted(shapes.items()))}")
    return errs, warns, stats


def build(filename, cat_de, cat_en, items):
    path = os.path.join(QUIZ_DIR, filename)
    # Referenz fuer "keine alten ids wiederverwenden" ist der git-Stand vor dem
    # Neuschrieb, nicht die Datei auf der Platte - sonst meldet ein zweiter Lauf
    # derselben Datei faelschlich ihre eigenen neuen ids als wiederverwendet.
    old_ids = set()
    try:
        blob = subprocess.run(
            ["git", "show", f"quizzes-v1-alt:src/quizzes/{filename}"],
            cwd=REPO, capture_output=True, text=True, check=True).stdout
        old_ids = {q["id"] for q in json.loads(blob)["questions"]}
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        print(f"  ! Warnung: git-Referenz quizzes-v1-alt fuer {filename} nicht lesbar")

    questions = [_to_json(i, cat_de, cat_en) for i in _vary_shapes(items)]
    errs, warns, stats = _check(questions, filename, old_ids)

    print(f"\n=== {filename} ===")
    print(stats)
    for w in warns:
        print(f"  ! {w}")
    if errs:
        print("  ABBRUCH - nicht geschrieben:")
        for e in errs:
            print(f"  X {e}")
        sys.exit(1)

    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"questions": questions}, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"  OK -> src/quizzes/{filename} ({os.path.getsize(path)//1024} KB)")
