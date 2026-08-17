#!/usr/bin/env python3
"""Ersetzt ASCII-Umschrift durch echte Umlaute/Eszett in einer Quelldatei.

Bewusst eine kuratierte Wortliste statt einer Regel wie ue->ue: sonst wuerden
legitime Woerter wie neue, genauer, Leasedauer, aktuell, Quelladresse oder
englische Begriffe wie query/guest/does zerstoert.

Aufruf: python3 .quiz-rebuild/fix_umlaute.py <quelldatei.py> [...]
"""
import re
import sys

MAP = {
    # -- ae -> ae
    "Abzueglich": "Abzüglich", "Ausfaelle": "Ausfälle", "Bestaetigung": "Bestätigung",
    "Bestaetigungen": "Bestätigungen", "Daempfung": "Dämpfung", "Domaene": "Domäne",
    "Domaenen": "Domänen", "Eintraege": "Einträge", "Endgeraete": "Endgeräte",
    "Faelschen": "Fälschen", "Gaeste": "Gäste", "Gaestebereich": "Gästebereich",
    "Gaestetrennung": "Gästetrennung", "Gastgeraet": "Gastgerät", "Gebaeuden": "Gebäuden",
    "Gebaeudeverkabelung": "Gebäudeverkabelung", "Gehaeuse": "Gehäuse",
    "Gehaeusefarbe": "Gehäusefarbe", "Gehaeuses": "Gehäuses", "Geraet": "Gerät",
    "Geraete": "Geräte", "Geraets": "Geräts", "Buerogeraete": "Bürogeräte",
    "Haelfte": "Hälfte", "Kanaele": "Kanäle", "Kapazitaet": "Kapazität",
    "Kollisionszaehler": "Kollisionszähler", "Laenge": "Länge", "Naehe": "Nähe",
    "Praefixlaenge": "Präfixlänge", "Primaer": "Primär", "Primaerbereich": "Primärbereich",
    "Prioritaet": "Priorität", "Sekundaer": "Sekundär", "Sekundaerbereich": "Sekundärbereich",
    "Signalverstaerker": "Signalverstärker", "Tertiaer": "Tertiär",
    "Tertiaerbereich": "Tertiärbereich", "Verlaesslichkeit": "Verlässlichkeit",
    "Verstaerken": "Verstärken", "Waende": "Wände", "Kollisionsdomaene": "Kollisionsdomäne",
    "Kollisionsdomaenen": "Kollisionsdomänen",
    "abhaelt": "abhält", "aenderbar": "änderbar", "aendern": "ändern", "aendert": "ändert",
    "auffaellig": "auffällig", "bestaetigt": "bestätigt", "daempfen": "dämpfen",
    "enthaelt": "enthält", "ergaeben": "ergäben", "faehiger": "fähiger", "faellt": "fällt",
    "gewaehlt": "gewählt", "gewaehlten": "gewählten", "glaettet": "glättet",
    "grundsaetzlich": "grundsätzlich", "haengen": "hängen", "haeufiger": "häufiger",
    "haeufigsten": "häufigsten", "kaeme": "käme", "laedt": "lädt", "laengere": "längere",
    "laengeres": "längeres", "laesst": "lässt", "laeuft": "läuft", "naechsten": "nächsten",
    "regulaere": "reguläre", "schwaechste": "schwächste", "schwaechstes": "schwächstes",
    "selbstverstaendlich": "selbstverständlich", "spaet": "spät", "spaetere": "spätere",
    "staendig": "ständig", "stoert": "stört", "taeglich": "täglich",
    "tatsaechlich": "tatsächlich", "tatsaechlichen": "tatsächlichen", "traegt": "trägt",
    "unabhaengig": "unabhängig", "unveraendert": "unverändert", "verschaerft": "verschärft",
    "verspaetete": "verspätete", "vollstaendig": "vollständig", "vollstaendige": "vollständige",
    "Vollstaendigkeit": "Vollständigkeit", "waehlst": "wählst", "waehlt": "wählt",
    "waehrend": "während", "waere": "wäre", "waeren": "wären", "zaehlen": "zählen",
    "zaehlt": "zählt", "zerfaellt": "zerfällt", "zufaelligen": "zufälligen",
    "zufaelliges": "zufälliges", "zusaetzlich": "zusätzlich", "zusaetzliche": "zusätzliche",
    "zusaetzlichen": "zusätzlichen", "zusammenhaengende": "zusammenhängende",
    "zustaendigen": "zuständigen", "zuverlaessig": "zuverlässig",
    # -- oe -> oe
    "Aufloesung": "Auflösung", "Bildschirmaufloesung": "Bildschirmauflösung",
    "Bloecke": "Blöcke", "Bloecken": "Blöcken", "Nullbloecken": "Nullblöcken",
    "Gruende": "Gründe", "Hoehere": "Höhere", "Loesung": "Lösung",
    "Moeglichkeit": "Möglichkeit", "Namensaufloesung": "Namensauflösung",
    "Netzwerkstoerung": "Netzwerkstörung", "Netzzugehoerigkeit": "Netzzugehörigkeit",
    "Passwoerter": "Passwörter", "Routeroberflaeche": "Routeroberfläche",
    "Stoerfelder": "Störfelder", "Stoerfestigkeit": "Störfestigkeit", "Stoerung": "Störung",
    "Stoerungen": "Störungen", "Verzoegerung": "Verzögerung",
    "aufloesen": "auflösen", "benoetigt": "benötigt", "erhoehen": "erhöhen",
    "erhoeht": "erhöht", "erschoepften": "erschöpften", "gehoeren": "gehören",
    "gehoert": "gehört", "gewoehnliche": "gewöhnliche", "hoechstens": "höchstens",
    "hoechstnummerierten": "höchstnummerierten", "hoehere": "höhere", "hoeheren": "höheren",
    "hoeherer": "höherer", "koennen": "können", "loesen": "lösen", "loest": "löst",
    "moeglich": "möglich", "noetig": "nötig", "oeffentliche": "öffentliche",
    "oeffentlichen": "öffentlichen", "stoeren": "stören", "unnoetig": "unnötig",
    "voellig": "völlig",
    # -- ue -> ue
    "Abkuerzung": "Abkürzung", "Bandbreitenbuendelung": "Bandbreitenbündelung",
    "Bituebertragung": "Bitübertragung", "Buendelung": "Bündelung", "Buero": "Büro",
    "Fuer": "Für", "Gefuehl": "Gefühl", "Gegenstueck": "Gegenstück",
    "Internetuebergang": "Internetübergang", "Netzuebergang": "Netzübergang",
    "Puenktlichkeit": "Pünktlichkeit", "Schluessel": "Schlüssel", "Teilstueck": "Teilstück",
    "Uebertragungsfrequenz": "Übertragungsfrequenz", "Verschluesselung": "Verschlüsselung",
    "Ueber": "Über", "Uebersetzung": "Übersetzung", "Uebersicht": "Übersicht",
    "Uebergang": "Übergang", "Uebertragung": "Übertragung", "Uebung": "Übung",
    "Ueberblick": "Überblick", "Ueberpruefung": "Überprüfung", "Ueberwachung": "Überwachung",
    "Uebersprechen": "Übersprechen", "Uebertragungsraten": "Übertragungsraten",
    "verstaerkt": "verstärkt", "Wofuer": "Wofür", "dafuer": "dafür", "druecken": "drücken", "erfuellt": "erfüllt",
    "fuehren": "führen", "fuehrt": "führt", "fuer": "für", "gegenueber": "gegenüber",
    "geprueft": "geprüft", "gepruefte": "geprüfte", "gueltig": "gültig",
    "gueltige": "gültige", "guenstigere": "günstigere", "kuerzere": "kürzere",
    "kuerzeren": "kürzeren", "nuetzliche": "nützliche", "pruefen": "prüfen",
    "pruefst": "prüfst", "prueft": "prüft", "ueber": "über",
    "ueberbrueckbare": "überbrückbare", "ueberbrueckt": "überbrückt",
    "ueberfluessig": "überflüssig", "ueberfuellt": "überfüllt", "ueberlappen": "überlappen",
    "uebernimmt": "übernimmt", "ueberschneidungsfreie": "überschneidungsfreie",
    "uebersetzt": "übersetzt", "ueberspringen": "überspringen", "uebertraegt": "überträgt",
    "uebertragen": "übertragen", "ueberzaehlige": "überzählige", "ueblich": "üblich",
    "uebliche": "übliche", "ueblicherweise": "üblicherweise", "uebliches": "übliches",
    "uebrig": "übrig", "unerwuenschten": "unerwünschten", "ungeschuetzt": "ungeschützt",
    "unverschluesselte": "unverschlüsselte", "unverschluesseltes": "unverschlüsseltes",
    "verschluesseln": "verschlüsseln", "verschluesselte": "verschlüsselte", "wuerde": "würde",
    "zurueck": "zurück",
    # -- ss -> ss
    "Ausschliesslich": "Ausschließlich", "ausschliesslich": "ausschließlich",
    "Aussenbereich": "Außenbereich", "ausserhalb": "außerhalb", "draussen": "draußen",
    "Massnahmen": "Maßnahmen", "heisst": "heißt", "gross": "groß", "grosse": "große",
    "grossen": "großen", "Groesse": "Größe", "Groessere": "Größere", "groesser": "größer",
    "groesste": "größte", "vergroessern": "vergrößern",
    "Gleichmaessige": "Gleichmäßige", "regelmaessig": "regelmäßig",
    "standardmaessig": "standardmäßig", "unverhaeltnismaessig": "unverhältnismäßig",
}

PATTERN = re.compile(r"\b(" + "|".join(sorted(MAP, key=len, reverse=True)) + r")\b")


def fix(path):
    text = open(path, encoding="utf-8").read()
    new, n = PATTERN.subn(lambda m: MAP[m.group(0)], text)
    if n:
        open(path, "w", encoding="utf-8").write(new)
    print(f"{path}: {n} Ersetzungen")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        fix(p)
