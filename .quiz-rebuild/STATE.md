# Quiz-Neuschrieb — Arbeitsstand

> **Autoritatives Repo: `/home/liforra/projects/quiz`** (vom Nutzer am 2026-08-17
> bestätigt). `/home/liforra/quiz` ist ein veralteter Checkout, 6 Commits
> zurück, ohne `.env.local` — dort **nicht** weiterarbeiten.

**Wenn diese Session abbricht: hier weiterlesen, dann bei der ersten Datei mit
Status `offen` weitermachen.** Fertige Dateien sind bereits nach
`src/quizzes/` geschrieben und müssen nicht neu gebaut werden.

## Auftrag (vom Nutzer bestätigt)

Alle 1000 Fragen der 10 Standard-Quizze neu schreiben — die alten waren zu
großen Teilen Generator-Ausschuss (418x die Schablone „Welche Aufgabe hat X im
Bereich Y?" mit identischem Erklärungssatz).

Vorgaben:

- **100 Fragen pro Datei**, Split **32 single / 32 multiple / 36 text**
  (Text bewusst etwas stärker — ausdrücklicher Wunsch des Nutzers)
- **~60 % Szenario** („Ein Kunde meldet…, was prüfst du zuerst?"),
  **~40 % Fakten/Rechnen** — beides **kurz und knackig**. Explizite Ansage:
  zu lange Fragen demotivieren genauso wie schlechte.
- **Neue IDs** (Schema `<präfix>-r<NN>`, `r` = rewrite). Alte IDs nicht
  wiederverwenden, damit die Per-Frage-Statistik nicht falsch zugeordnet wird.
- **Nicht erratbar**: kein Längenbias, keine Strohmann-Distraktoren.
- Jede Frage vollständig DE + EN übersetzt.

## Sicherung der alten Fragen

git-Tag **`quizzes-v1-alt`** → `bcc0902`. Verifiziert: alle 10 Dateien mit je
100 Fragen aus dem git-Objekt lesbar.

```bash
git checkout quizzes-v1-alt -- src/quizzes/          # alles zurück
git show quizzes-v1-alt:src/quizzes/ap2-datenbanken.json   # einzeln ansehen
```

## Arbeitsweise

Inhalte werden **von Hand geschrieben** (kein Autogenerator — vom Nutzer
abgelehnt). `qlib.py` ist reine Serialisierung + Qualitätsprüfung: es nimmt die
handgeschriebenen Fragen in Kompaktform, schreibt das JSON aus dem README und
bricht ab, wenn eine Regel verletzt ist.

Pro Datei existiert `src_<name>.py` mit den Fragen. Bauen:

```bash
python3 .quiz-rebuild/src_ap1-netzwerktechnik.py
```

`qlib.py` bricht mit Exit 1 ab (und schreibt **nicht**), wenn:
Typ-Split ≠ 32/32/36 · IDs doppelt oder aus der alten Version · doppelte
Fragetexte/Erklärungen · gleicher Fragebeginn >4x · gleicher Erklärungs-
Schlusssatz >2x · Längenverhältnis richtige/falsche Option außerhalb
0.90–1.10 · „längste Option ist richtig" in >32 % der MC-Fragen · answer nicht
in options · fehlende EN-Übersetzung.

## Fortschritt

| # | Datei | Kategorie | ID-Präfix | Status |
|---|---|---|---|---|
| 1 | ap1-netzwerktechnik.json | Netzwerktechnik | `ap1-net-r` | **fertig** |
| 2 | ap1-it-sicherheit.json | IT-Sicherheit & Datenschutz | `ap1-sec-r` | **fertig** |
| 3 | ap1-hardware-arbeitsplatz.json | Hardware & Arbeitsplatz | `ap1-hw-r` | **fertig** |
| 4 | ap1-softwareentwicklung.json | Softwareentwicklung | `ap1-swe-r` | **fertig** |
| 5 | ap1-wirtschaft-projektmanagement.json | Wirtschaft & Projektmanagement | `ap1-wpm-r` | **fertig** |
| 6 | ap2-netzwerke-subnetting.json | Netzwerke & Subnetting | `ap2-net-r` | **fertig** |
| 7 | ap2-datenbanken.json | Datenbanken | `ap2-db-r` | **fertig** |
| 8 | ap2-it-sicherheit.json | IT-Sicherheit & Netzwerksicherheit | `ap2-sec-r` | **fertig** |
| 9 | ap2-serverdienste-virtualisierung.json | Serverdienste & Virtualisierung | `ap2-srv-r` | **fertig** |
| 10 | ap2-speicher-backup.json | Speicher & Backup | `ap2-sto-r` | **fertig** |

Status: `offen` → `fertig`. Diese Tabelle nach jeder fertigen Datei aktualisieren.

## Nachträglich gefundener Fehler (behoben)

Beim ersten Durchlauf hatten **318 von 320** multiple-Fragen exakt 4 richtige
Antworten von 6 - damit wäre "immer vier anklicken" eine Strategie ganz ohne
Fachwissen gewesen. `_vary_shapes()` in `qlib.py` verteilt die Formen jetzt
reihum gleichmäßig auf 6/4, 5/3 und 4/2 (Optionen/richtig); eine harte Prüfung
lehnt jede Datei ab, in der eine Form über 45 % kommt. Entfernt werden dabei
nur *richtige* Optionen vom Ende - die falschen bleiben an ihrer Position,
damit Erklärungen mit Bezug auf "die letzten beiden Aussagen" gültig bleiben.

## Nicht vergessen

- Kein `GROQ_API_KEY` lokal → Textfragen sind Selbstbewertungs-Karteikarten.
  Deshalb nur **kurze, exakt prüfbare** Textantworten (`/26`, `13`, `NAT`),
  keine Aufsätze.
- `src/app.tsx:95` mischt die Optionen bei jedem Rendern → Reihenfolge in der
  JSON ist egal, **Längenbias** ist das reale Erratbarkeits-Leck.
- README ist korrigiert (100 Fragen je Datei, 32/32/36) und `npm run build`
  läuft fehlerfrei durch.
