#!/usr/bin/env python3
"""Builds docs/database/DATABASE_ERD.drawio from docs/database/schema-snapshot.json.

The snapshot is exported from the PostgreSQL catalog of a database built from supabase/migrations (whose
fingerprint was verified identical to production). Every table, column, type, nullability, key and foreign
key in the physical pages therefore comes from the catalog; only positions, colours and wording live here.
The script fails if the snapshot contains a table or foreign key that no page shows.

Usage: python3 -I scripts/database/erd.py
"""
import json
import re
import os
import sys
from xml.sax.saxutils import quoteattr

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SNAPSHOT = os.path.join(ROOT, "docs", "database", "schema-snapshot.json")
OUTPUT = os.path.join(ROOT, "docs", "database", "DATABASE_ERD.drawio")

FONT = "fontFamily=Helvetica;"
AREAS = {
    "auth": ("Authentication", "#2B4C7E", "#EEF3FA"),
    "tourism": ("Tourism information", "#1F5C46", "#EDF6F1"),
    "publication": ("Publication and history", "#8A5A00", "#FBF5E8"),
    "itinerary": ("Itinerary", "#7A2E46", "#F9EEF2"),
    "infra": ("Migration infrastructure (not business data)", "#5B6472", "#F3F4F6"),
}
TABLE_AREA = {
    "account": "auth", "account_session": "auth", "recovery_code": "auth", "auth_throttle": "auth",
    "tourism_record": "tourism", "record_version": "publication", "record_state": "publication",
    "version_destination": "publication", "record_activity": "publication",
    "itinerary": "itinerary", "itinerary_entry": "itinerary", "schema_migration": "infra",
}
TYPE_NAMES = {"timestamp with time zone": "timestamptz"}
W, HEAD, ROW = 260, 30, 22


def wrap(text, width, size=10):
    """Breaks text into lines that fit `width` px, so labels stay plain SVG text (no foreignObject)."""
    limit = max(10, int(width / (size * 0.56)))
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split(" "):
            if line and len(line) + 1 + len(word) > limit:
                lines.append(line)
                line = word
            else:
                line = f"{line} {word}" if line else word
        lines.append(line)
    return "\n".join(lines)


class Page:
    def __init__(self, ident, name, width=1169, height=827):
        self.ident, self.name, self.width, self.height = ident, name, width, height
        self.cells, self.count = [], 0

    def add(self, value, style, x=0, y=0, w=0, h=0, parent="1", ident=None, vertex=True, edge=None):
        self.count += 1
        ident = ident or f"{self.ident}-{self.count}"
        if vertex and "whiteSpace=wrap;" in style:
            size = int(re.search(r"fontSize=(\d+)", style).group(1)) if "fontSize=" in style else 11
            spacing = 20 if "spacing=10" in style else 8
            value = wrap(value, w - spacing, size)
            style = style.replace("whiteSpace=wrap;", "")
        if vertex:
            geom = f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
            self.cells.append(f'<mxCell id="{ident}" value={quoteattr(value)} style="{style}" vertex="1" parent="{parent}">{geom}</mxCell>')
        else:
            source, target, points, *rest = edge
            offset = f' x="{rest[0]}"' if rest and rest[0] is not None else ""
            pts = "".join(f'<mxPoint x="{px}" y="{py}"/>' for px, py in points)
            geom = f'<mxGeometry{offset} relative="1" as="geometry">{f"<Array as=\"points\">{pts}</Array>" if pts else ""}</mxGeometry>'
            self.cells.append(f'<mxCell id="{ident}" value={quoteattr(value)} style="{style}" edge="1" parent="1" source="{source}" target="{target}">{geom}</mxCell>')
        return ident

    def xml(self):
        body = "".join(self.cells)
        return (f'<diagram id="{self.ident}" name={quoteattr(self.name)}><mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" '
                f'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{self.width}" pageHeight="{self.height}" '
                f'math="0" shadow="0" background="#FFFFFF"><root><mxCell id="0"/><mxCell id="1" parent="0"/>{body}</root></mxGraphModel></diagram>')


def title(page, heading, subtitle):
    page.add(heading, f"text;html=0;align=left;verticalAlign=top;fontSize=20;fontStyle=1;fontColor=#1A1A1A;{FONT}", 30, 14, 1100, 28)
    page.add(subtitle, f"text;html=0;align=left;verticalAlign=top;fontSize=11;fontColor=#555555;{FONT}", 30, 42, 1100, 18)


def area(page, key, x, y, w, h, label=None, dashed=False):
    name, stroke, fill = AREAS[key]
    page.add("", f"rounded=1;arcSize=2;html=0;fillColor={fill};strokeColor={stroke};strokeWidth=1;opacity=100;{'dashed=1;' if dashed else ''}", x, y, w, h)
    page.add((label or name).upper(), f"text;html=0;align=left;verticalAlign=bottom;fontSize=10;fontStyle=1;fontColor={stroke};{FONT}", x + 10, y + h - 22, w - 20, 18)


class Schema:
    def __init__(self, path):
        data = json.load(open(path))
        self.tables = {t["name"]: t for t in data["tables"]}
        self.constraints = [c for c in data["constraints"]]
        self.fks = [c for c in self.constraints if c["type"] == "f"]

    def short(self, rel):
        return rel.split(".", 1)[1]

    def keys(self, table):
        marks = {c["name"]: [] for c in self.tables[table]["columns"]}
        for kind, label in (("p", "PK"), ("f", "FK"), ("u", "UK")):
            for c in self.constraints:
                if c["type"] == kind and self.short(c["table"]) == table:
                    for col in c["columns"]:
                        if label not in marks[col] and not (label == "UK" and "PK" in marks[col]):
                            marks[col].append(label)
        return {col: " ".join(m) for col, m in marks.items()}


def table(page, schema, name, x, y, stub=None, note=None, W=W):
    area_key = TABLE_AREA[name]
    _, stroke, _ = AREAS[area_key]
    columns = schema.tables[name]["columns"]
    keys = schema.keys(name)
    if stub:
        columns = [c for c in columns if c["name"] in stub]
    h = HEAD + ROW * len(columns)
    dashed = "dashed=1;" if stub or area_key == "infra" else ""
    label = f"stis.{name}" + (" (reference)" if stub else "")
    container = page.add(label, f"swimlane;html=0;startSize={HEAD};fontStyle=1;fontSize=12;fontColor=#FFFFFF;fillColor={stroke};strokeColor={stroke};"
                         f"swimlaneFillColor=#FFFFFF;collapsible=0;rounded=0;{dashed}{FONT}", x, y, W, h, ident=f"{page.ident}-{name}")
    for i, column in enumerate(columns):
        key = keys[column["name"]]
        fill = "#F6F7F9" if i % 2 else "#FFFFFF"
        bold = 1 if "PK" in key else 0
        row = page.add(column["name"], f"text;html=0;align=left;verticalAlign=middle;spacingLeft=36;fontSize=11;fontStyle={bold};fillColor={fill};"
                       f"strokeColor=none;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;{FONT}", 0, HEAD + ROW * i, W, ROW,
                       parent=container, ident=f"{page.ident}-{name}-{column['name']}")
        page.add(key, f"text;html=0;align=center;verticalAlign=middle;fontSize=9;fontStyle=1;fontColor={stroke};connectable=0;{FONT}",
                 0, HEAD + ROW * i, 34, ROW, parent=container)
        kind = TYPE_NAMES.get(column["type"], column["type"])
        if column.get("identity") == "a":
            kind += " (id)"
        page.add(kind, f"text;html=0;align=right;verticalAlign=middle;spacingRight=2;fontSize=9;fontColor=#444444;connectable=0;fontFamily=Courier New;",
                 W - 104, HEAD + ROW * i, 72, ROW, parent=container)
        if column["nullable"]:
            page.add("NULL", f"text;html=0;align=center;verticalAlign=middle;fontSize=8;fontStyle=2;fontColor=#8A8A8A;connectable=0;{FONT}",
                     W - 32, HEAD + ROW * i, 32, ROW, parent=container)
    if note:
        page.add(note, f"text;html=0;align=left;verticalAlign=top;fontSize=9;fontStyle=2;fontColor=#555555;whiteSpace=wrap;{FONT}", x, y + h + 2, W, 30)
    return {"x": x, "y": y, "h": h, "rows": {c["name"]: y + HEAD + ROW * i + ROW // 2 for i, c in enumerate(columns)}}


MARKS = {"one": "ERmandOne", "zeroOne": "ERzeroToOne", "many": "ERzeroToMany", "oneMany": "ERoneToMany"}


def relation(page, source, target, child, parent, points=(), exit_side=1, entry=None, label="", optional=False, one_to_one=False, label_at=-0.55):
    """An FK edge from a child row to a parent row/table, with the cardinalities PostgreSQL enforces."""
    start = MARKS["zeroOne"] if one_to_one else MARKS["many"]
    end = MARKS["zeroOne"] if optional else MARKS["one"]
    style = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;endArrow={end};startArrow={start};endFill=0;startFill=0;endSize=10;startSize=10;"
             f"strokeColor=#3A3A3A;strokeWidth=1.2;fontSize=9;fontColor=#333333;labelBackgroundColor=#FFFFFF;{FONT}")
    if isinstance(exit_side, tuple):
        style += f"exitX={exit_side[0]};exitY={exit_side[1]};exitDx=0;exitDy=0;"
    elif exit_side is not None:
        style += f"exitX={exit_side};exitY=0.5;exitDx=0;exitDy=0;"
    if entry:
        style += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
    page.add(label, style, vertex=False, edge=(source, target, points, label_at if label else None))
    return (child, parent)


def legend(page, x, y, w=540):
    page.add("", f"rounded=1;arcSize=3;html=0;fillColor=#FFFFFF;strokeColor=#BBBBBB;", x, y, w, 132)
    page.add("NOTATION", f"text;html=0;align=left;verticalAlign=top;fontSize=10;fontStyle=1;fontColor=#333333;{FONT}", x + 12, y + 8, 200, 16)
    samples = [("ERmandOne", "exactly one"), ("ERzeroToOne", "zero or one"), ("ERzeroToMany", "zero or more")]
    for i, (mark, text) in enumerate(samples):
        sy = y + 38 + i * 26
        a = page.add("", "point;html=0;strokeColor=none;fillColor=none;", x + 16, sy, 1, 1)
        b = page.add("", "point;html=0;strokeColor=none;fillColor=none;", x + 76, sy, 1, 1)
        page.add("", f"html=0;endArrow={mark};endFill=0;endSize=10;startArrow=none;strokeColor=#3A3A3A;strokeWidth=1.2;", vertex=False, edge=(a, b, []))
        page.add(text, f"text;html=0;align=left;verticalAlign=middle;fontSize=10;{FONT}", x + 86, sy - 9, 120, 18)
    lines = ["PK primary key · FK foreign key · UK unique · bold = key column",
             "NULL = nullable; every other column is NOT NULL",
             "Line ends show cardinality enforced by PostgreSQL constraints",
             "Labels or FK note: composite keys, ON DELETE (default NO ACTION)",
             "Dashed table = shown in full on another page"]
    for i, text in enumerate(lines):
        page.add(text, f"text;html=0;align=left;verticalAlign=middle;fontSize=10;fontColor=#333333;{FONT}", x + 214, y + 24 + i * 20, w - 224, 18)


def physical_accounts(schema):
    page = Page("p2", "2 Physical: accounts and itineraries")
    title(page, "STIS database · physical design 1 of 2: accounts and itineraries",
          "Schema stis on Supabase PostgreSQL 17.11 (production, verified 25 Nov 2026). Generated from the catalog snapshot docs/database/schema-snapshot.json.")
    area(page, "auth", 16, 72, 568, 560)
    area(page, "itinerary", 592, 72, 568, 370)
    x1, x2, x3, x4 = 30, 310, 606, 890
    s = table(page, schema, "account_session", x1, 100)
    r = table(page, schema, "recovery_code", x1, 320)
    table(page, schema, "auth_throttle", x1, 470, note="Keys are SHA-256 digests of the throttled email or client; deliberately not linked to accounts.")
    a = table(page, schema, "account", x2, 100)
    i = table(page, schema, "itinerary", x3, 100)
    e = table(page, schema, "itinerary_entry", x4, 100)
    t = table(page, schema, "tourism_record", x4, 470, stub={"id", "kind"}, note="Full definition on page 3. (record_id, kind) references the UK (id, kind).")
    done = [
        relation(page, "p2-account_session-account_id", "p2-account-id", "account_session", "account",
                 [(x1 + W + 10, s["rows"]["account_id"]), (x1 + W + 10, a["rows"]["id"])], entry=(0, 0.5)),
        relation(page, "p2-recovery_code-account_id", "p2-account-id", "recovery_code", "account",
                 [(x1 + W + 10, r["rows"]["account_id"]), (x1 + W + 10, a["rows"]["id"])], entry=(0, 0.5)),
        relation(page, "p2-itinerary-owner_id", "p2-account-id", "itinerary", "account",
                 [(x3 - 23, i["rows"]["owner_id"]), (x3 - 23, a["rows"]["id"])], exit_side=0, entry=(1, 0.5), optional=True),
        relation(page, "p2-itinerary_entry-itinerary_id", "p2-itinerary-id", "itinerary_entry", "itinerary",
                 [(x4 - 12, e["rows"]["itinerary_id"]), (x4 - 12, i["rows"]["id"])], exit_side=0, entry=(1, 0.5)),
        relation(page, "p2-itinerary_entry-record_id", "p2-tourism_record-id", "itinerary_entry", "tourism_record",
                 [(x4 + W + 12, e["rows"]["record_id"]), (x4 + W + 12, t["rows"]["id"])], exit_side=1, entry=(1, 0.5)),
    ]
    page.add("", "rounded=1;arcSize=4;html=0;fillColor=#FFFFFF;strokeColor=#BBBBBB;", x2, 420, 262, 196)
    page.add("FOREIGN KEYS ON THIS PAGE", f"text;html=0;align=left;verticalAlign=top;fontSize=10;fontStyle=1;fontColor=#333333;{FONT}", x2 + 10, 428, 240, 16)
    fk_lines = ["account_session.account_id → account.id",
                "   ON DELETE CASCADE",
                "recovery_code.account_id → account.id",
                "   ON DELETE CASCADE",
                "itinerary.owner_id (NULL) → account.id",
                "   ON DELETE CASCADE",
                "itinerary_entry.itinerary_id → itinerary.id",
                "   ON DELETE CASCADE",
                "itinerary_entry (record_id, kind) →",
                "   tourism_record (id, kind) · NO ACTION"]
    for k, text in enumerate(fk_lines):
        page.add(text, f"text;html=0;align=left;verticalAlign=middle;fontSize=9;fontColor=#333333;{FONT}", x2 + 10, 448 + k * 16, 246, 15)
    page.add("Ownership rules (checked by the API, not by RLS): an itinerary is opened by its owner's session (owner_id) or by the holder of the guest token "
             "(guest_digest); share_digest grants a read-only view. Tokens are stored only as SHA-256 digests. CHECK: owner_id or guest_digest must be set.",
             f"text;html=0;align=left;verticalAlign=top;fontSize=10;fontColor=#333333;whiteSpace=wrap;{FONT}", 606, 450, 270, 150)
    legend(page, 606, 640, 548)
    page.add("Session, recovery-code and guest/share tokens are random 256-bit (sessions, links) or 80-bit (recovery codes) values; only digests are stored. "
             "Passwords are scrypt hashes.", f"text;html=0;align=left;verticalAlign=top;fontSize=10;fontColor=#333333;whiteSpace=wrap;{FONT}", 30, 640, 540, 40)
    return page, done


def physical_publication(schema):
    page = Page("p3", "3 Physical: tourism information, publication, history")
    title(page, "STIS database · physical design 2 of 2: tourism information, publication and history",
          "Every save adds a record_version; record_state points at the current draft and the published version. Publication history is append-only for the API role.")
    w = 250
    area(page, "tourism", 16, 72, 282, 196)
    area(page, "publication", 306, 72, 580, 490)
    area(page, "infra", 16, 628, 282, 132, dashed=True)
    x1, x2, x3, x4 = 30, 320, 624, 905
    t = table(page, schema, "tourism_record", x1, 100, W=w, note="UK (id, kind) lets itinerary_entry check the category.")
    st = table(page, schema, "record_state", x2, 100, W=w,
               note="(record_id, draft) and (record_id, published) each reference record_version (record_id, version).")
    v = table(page, schema, "record_version", x3, 100, W=w)
    act = table(page, schema, "record_activity", x2, 320, W=w)
    vd = table(page, schema, "version_destination", x3, 320, W=w)
    acc = table(page, schema, "account", x4, 470, W=w, stub={"id", "display_name"}, note="Full definition on page 2.")
    table(page, schema, "schema_migration", x1, 650, W=w)
    rows = lambda tb, col: tb["rows"][col]
    frac = lambda tb, y: round((y - tb["y"]) / tb["h"], 3)
    done = [
        relation(page, "p3-record_state-record_id", "p3-tourism_record-id", "record_state", "tourism_record", [], exit_side=0, entry=(1, 0.5), one_to_one=True),
        relation(page, "p3-record_state-draft", "p3-record_version", "record_state", "record_version", [], exit_side=1,
                 entry=(0, frac(v, rows(st, "draft"))), one_to_one=True),
        relation(page, "p3-record_state-published", "p3-record_version", "record_state", "record_version", [], exit_side=1,
                 entry=(0, frac(v, rows(st, "published"))), one_to_one=True, optional=True),
        relation(page, "p3-record_version-record_id", "p3-tourism_record", "record_version", "tourism_record",
                 [(x3 - 18, rows(v, "record_id")), (x3 - 18, 88), (x1 + 125, 88)], exit_side=0, entry=(0.5, 0)),
        relation(page, "p3-version_destination", "p3-record_version", "version_destination", "record_version", [], exit_side=(0.5, 0),
                 entry=(0.5, 1), label="(record_id, version)", label_at=0),
        relation(page, "p3-version_destination-destination_id", "p3-tourism_record", "version_destination", "tourism_record",
                 [(x3 - 18, rows(vd, "destination_id")), (x3 - 18, 296), (304, 296), (304, rows(t, "created_at"))], exit_side=0,
                 entry=(1, frac(t, rows(t, "created_at"))), label="destination_id", label_at=0.1),
        relation(page, "p3-record_activity-record_id", "p3-tourism_record", "record_activity", "tourism_record",
                 [(22, rows(act, "record_id")), (22, 170)], exit_side=0, entry=(0, frac(t, 170))),
        relation(page, "p3-record_version-author_id", "p3-account-id", "record_version", "account",
                 [(x4 - 11, rows(v, "author_id")), (x4 - 11, rows(acc, "id"))], exit_side=1, entry=(0, 0.5), optional=True, label="SET NULL", label_at=0.6),
        relation(page, "p3-record_activity-actor_id", "p3-account", "record_activity", "account",
                 [(x2 + w + 14, rows(act, "actor_id")), (x2 + w + 14, 532), (x4 - 30, 532)], exit_side=1, entry=(0, frac(acc, 532)), optional=True,
                 label="SET NULL", label_at=0.3),
    ]
    page.add("API role privileges: SELECT and INSERT only on tourism_record, record_version, version_destination and record_activity (append-only); "
             "SELECT, INSERT, UPDATE, DELETE on record_state; SELECT only on schema_migration.",
             f"text;html=0;align=left;verticalAlign=top;fontSize=10;fontColor=#333333;whiteSpace=wrap;{FONT}", 318, 572, 560, 40)
    legend(page, 318, 640, 548)
    return page, done


def concept_box(page, ident, area_key, name, text, x, y, w=170, h=64, dashed=False):
    _, stroke, _ = AREAS[area_key]
    box = page.add(name, f"swimlane;html=0;startSize=24;fontStyle=1;fontSize=12;fontColor=#FFFFFF;fillColor={stroke};strokeColor={stroke};"
                   f"swimlaneFillColor=#FFFFFF;collapsible=0;rounded=1;arcSize=6;{'dashed=1;' if dashed else ''}{FONT}", x, y, w, h, ident=f"p1-{ident}")
    page.add(text, f"text;html=0;align=center;verticalAlign=middle;fontSize=10;fontColor=#333333;whiteSpace=wrap;connectable=0;{FONT}",
             4, 24, w - 8, h - 26, parent=box)
    return box


def link(page, a, b, start, end, label, points=(), exit=None, entry=None, label_at=None):
    style = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;startArrow={MARKS[start]};endArrow={MARKS[end]};startFill=0;endFill=0;startSize=10;endSize=10;"
             f"strokeColor=#3A3A3A;strokeWidth=1.2;fontSize=10;fontStyle=2;fontColor=#333333;labelBackgroundColor=#FFFFFF;{FONT}")
    if exit:
        style += f"exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;"
    if entry:
        style += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
    page.add(label, style, vertex=False, edge=(a, b, list(points), label_at))


def conceptual():
    page = Page("p1", "1 Conceptual model")
    title(page, "STIS database · conceptual model (full system, PostgreSQL)",
          "Business entities and their relationships, with the table that stores each one. The AS03 assessment build uses a separate SQLite design and is not shown here.")
    area(page, "auth", 16, 72, 452, 410)
    area(page, "tourism", 474, 300, 432, 150)
    area(page, "publication", 230, 496, 690, 300)
    area(page, "itinerary", 920, 72, 236, 330)
    area(page, "infra", 930, 640, 226, 156, dashed=True)
    ses = concept_box(page, "session", "auth", "Sign-in session", "Server-side session [account_session]", 36, 112, 160, 64)
    rec = concept_box(page, "recovery", "auth", "Recovery code", "One-time recovery [recovery_code]", 36, 232, 160, 64)
    concept_box(page, "throttle", "auth", "Sign-in throttle", "Failed-attempt counter; unlinked by design [auth_throttle]", 36, 360, 160, 76)
    acc = concept_box(page, "account", "auth", "Account", "Tourist, staff member or administrator [account]", 296, 112, 160, 210)
    tr = concept_box(page, "record", "tourism", "Tourism record", "Destination, event, accommodation, transport, dining or visitor guidance [tourism_record]",
                     500, 330, 360, 80)
    ver = concept_box(page, "version", "publication", "Record version", "Immutable content snapshot [record_version]", 260, 524, 160, 72)
    sta = concept_box(page, "state", "publication", "Publication state", "Current draft and published version [record_state]", 520, 524, 160, 72)
    dst = concept_box(page, "destlink", "publication", "Destination link", "Version → related destination [version_destination]", 740, 524, 160, 72)
    actv = concept_box(page, "activity", "publication", "Activity entry", "Created, saved, published, withdrawn [record_activity]", 260, 680, 160, 72)
    iti = concept_box(page, "itinerary", "itinerary", "Itinerary", "Multi-day trip; owned or guest; shareable [itinerary]", 940, 112, 196, 76)
    stop = concept_box(page, "stop", "itinerary", "Itinerary stop", "A planned record on a day and time [itinerary_entry]", 940, 300, 196, 72)
    concept_box(page, "migration", "infra", "Schema migration", "Applied migration versions; no relationships [schema_migration]", 945, 668, 196, 72, dashed=True)
    link(page, ses, acc, "many", "one", "belongs to", [], exit=(1, 0.5), entry=(0, 0.19))
    link(page, rec, acc, "many", "one", "belongs to", [], exit=(1, 0.5), entry=(0, 0.76))
    link(page, iti, acc, "many", "zeroOne", "owned by (guest trips have no owner)", [], exit=(0, 0.33), entry=(1, 0.21))
    link(page, stop, iti, "many", "one", "is part of", [], exit=(0.5, 0), entry=(0.5, 1))
    link(page, stop, tr, "many", "one", "plans", [], exit=(0, 0.33), entry=(1, 0.3))
    link(page, ver, acc, "many", "zeroOne", "authored by", [(340, 450), (376, 450)], exit=(0.5, 0), entry=(0.5, 1))
    link(page, actv, acc, "many", "zeroOne", "performed by", [(240, 716), (240, 300)], exit=(0, 0.5), entry=(0, 0.895), label_at=0.1)
    link(page, ver, tr, "many", "one", "revises", [(410, 470), (540, 470)], exit=(0.94, 0), entry=(0.11, 1))
    link(page, sta, tr, "zeroOne", "one", "tracks", [], exit=(0.5, 0), entry=(0.39, 1))
    link(page, sta, ver, "zeroOne", "one", "current draft", [], exit=(0, 0.3), entry=(1, 0.3))
    link(page, sta, ver, "zeroOne", "zeroOne", "published", [], exit=(0, 0.78), entry=(1, 0.78))
    link(page, dst, ver, "many", "one", "belongs to", [(820, 630), (340, 630)], exit=(0.5, 1), entry=(0.5, 1), label_at=0.3)
    link(page, dst, tr, "many", "one", "points at a destination", [], exit=(0.375, 0), entry=(0.83, 1))
    link(page, actv, tr, "many", "one", "is logged for", [(910, 716), (910, 396)], exit=(1, 0.5), entry=(1, 0.825), label_at=-0.3)
    page.add("Notes", f"text;html=0;align=left;verticalAlign=top;fontSize=11;fontStyle=1;{FONT}", 930, 420, 220, 18)
    page.add("A tourism record is never deleted: withdrawal clears its published version, so trips keep the stop and show it as unavailable.\n"
             "Deleting an account removes its sessions, recovery codes and owned trips; history keeps the change without the author.\n"
             "Crow's foot marks show the cardinality PostgreSQL enforces.",
             f"text;html=0;align=left;verticalAlign=top;fontSize=9;fontColor=#333333;whiteSpace=wrap;{FONT}", 930, 440, 226, 190)
    return page


def security():
    page = Page("p4", "4 Access and security model")
    title(page, "STIS database · access and security model",
          "Who can reach the stis schema, and where each authorisation rule is enforced (verified against live roles, grants and policies on 25 Nov 2026).")
    def box(text, x, y, w, h, fill, stroke):
        return page.add(text, f"rounded=1;arcSize=6;html=0;whiteSpace=wrap;align=left;verticalAlign=top;spacing=10;fontSize=10;fontColor=#1A1A1A;"
                        f"fillColor={fill};strokeColor={stroke};strokeWidth=1.2;{FONT}", x, y, w, h)
    def arrow(a, b, text="", dashed=False, blocked=False, exit=None, entry=None):
        colour = "#B3261E" if blocked else "#3A3A3A"
        style = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;endArrow={'cross' if blocked else 'block'};endFill=1;endSize=8;strokeColor={colour};"
                 f"strokeWidth=1.4;fontSize=10;fontColor={colour};labelBackgroundColor=#FFFFFF;{'dashed=1;' if dashed else ''}{FONT}")
        if exit:
            style += f"exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;"
        if entry:
            style += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
        page.add(text, style, vertex=False, edge=(a, b, []))
    browser = box("Browser (tourist, staff, administrator, guest)\n\nHolds only an HttpOnly session cookie (Path=/api/, SameSite=Lax, Secure) "
                  "or a guest or share token kept in the URL fragment and sent as an Authorization header.", 30, 90, 300, 120, "#FFFFFF", "#888888")
    api = box("Vercel Function (sin1): STIS API handler\n\nAll per-user authorisation happens here:\n• session lookup by SHA-256 digest; idle and absolute expiry\n"
              "• staff or admin role for records; admin for staff accounts\n• itinerary: owner_id = session account, or guest-token digest\n"
              "• share-token digest gives a read-only view only\n• optimistic revision checks (HTTP 409)\n• transactions with row locks for publish and withdraw\n"
              "• Origin check, JSON-only bodies, size limits, throttling", 410, 90, 360, 220, "#EEF3FA", "#2B4C7E")
    role = box("Database role stis_api (login through the Supavisor pooler)\n\nNot superuser · no BYPASSRLS · inherits no roles · statement_timeout 10s\n"
               "USAGE on schema stis (plus PUBLIC usage of the empty public schema)\nNo readable or writable table outside stis\n"
               "Append-only: no UPDATE or DELETE on tourism_record, record_version, version_destination, record_activity\nSELECT only on schema_migration",
               410, 350, 360, 170, "#FBF5E8", "#8A5A00")
    schema = box("Schema stis (12 tables, owner postgres)\n\nRLS enabled on all 12 tables, one policy each: stis_api_access FOR ALL TO stis_api "
                 "USING (true) WITH CHECK (true). RLS therefore admits only stis_api; it does not separate one user's rows from another's. "
                 "That separation is the API's job.", 410, 570, 360, 140, "#EDF6F1", "#1F5C46")
    data_api = box("Supabase Data API (PostgREST, GraphQL): roles anon, authenticated, service_role\n\nstis is not an exposed schema and none of these roles "
                   "has USAGE on it, so /rest/v1 and GraphQL cannot reach any stis table. service_role has BYPASSRLS but no grant, so it is refused too.",
                   850, 570, 290, 140, "#FFFFFF", "#B3261E")
    owner = box("postgres (schema and table owner, BYPASSRLS)\n\nUsed only for migrations and inspection from the Supabase dashboard or connector; "
                "never by the running application.", 30, 570, 300, 140, "#F3F4F6", "#5B6472")
    box("Review conclusion\n\nThe USING (true) policies are justified by this architecture: the browser never talks to PostgreSQL, and one server role acts for "
        "every user. They are a role gate, not row isolation.\n\nResidual risk: a leaked stis_api credential could read accounts (emails, scrypt hashes) "
        "and change itineraries, but could not rewrite publication history.", 850, 90, 290, 260, "#FFFFFF", "#888888")
    arrow(browser, api, "HTTPS /api/v1", exit=(1, 0.5), entry=(0, 0.27))
    arrow(api, role, "parameterised SQL, one role for every request", exit=(0.5, 1), entry=(0.5, 0))
    arrow(role, schema, "grants + RLS policy", exit=(0.5, 1), entry=(0.5, 0))
    arrow(data_api, schema, "no USAGE: refused", blocked=True, exit=(0, 0.5), entry=(1, 0.5))
    arrow(owner, schema, "migrations", dashed=True, exit=(1, 0.5), entry=(0, 0.5))
    return page


def main():
    schema = Schema(SNAPSHOT)
    p2, rel2 = physical_accounts(schema)
    p3, rel3 = physical_publication(schema)
    shown = {c for c in "".join(p2.cells + p3.cells).split('"') if c.startswith(("p2-", "p3-"))}
    missing = [t for t in schema.tables if f"p2-{t}" not in shown and f"p3-{t}" not in shown]
    drawn = rel2 + rel3
    expected = [(schema.short(f["table"]), schema.short(f["refTable"])) for f in schema.fks]
    unmatched = [pair for pair in expected if pair not in drawn] + [pair for pair in drawn if pair not in expected]
    if missing or unmatched or len(drawn) != len(expected):
        sys.exit(f"diagram does not match the schema: missing tables {missing}, unmatched FKs {unmatched}, drawn {len(drawn)} of {len(expected)}")
    pages = [conceptual(), p2, p3, security()]
    xml = '<mxfile host="STIS erd.py" agent="scripts/database/erd.py" version="24.0.0">' + "".join(p.xml() for p in pages) + "</mxfile>\n"
    open(OUTPUT, "w").write(xml)
    print(f"{OUTPUT}: {len(pages)} pages, {len(schema.tables)} tables, {len(drawn)} of {len(expected)} foreign keys drawn")


main()
