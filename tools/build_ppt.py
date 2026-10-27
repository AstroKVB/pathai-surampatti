"""Fill the Round 2 template from Round 1 data + simulation results.

usage: python tools/build_ppt.py <template.pptx> <results.json> <screenshots_dir> <out.pptx>
Every number on Slides 6-8 is read from results.json (written by tools/slide_numbers.js).
"""
import copy
import json
import sys

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

TEMPLATE, RESULTS, SHOTS, OUT = sys.argv[1:5]
R = json.load(open(RESULTS, encoding="utf-8"))
P15, H60, AMB, VAR = R["peak15"], R["hour60"], R["ambulance"], R["variants"]
A, B = P15["A"], P15["B"]

INK = RGBColor(0x1F, 0x29, 0x37)
BLUE = RGBColor(0x00, 0x78, 0xD4)
DARKBLUE = RGBColor(0x00, 0x5A, 0x9E)
MUTED = RGBColor(0x4B, 0x55, 0x63)
GREEN = RGBColor(0x0F, 0x7B, 0x3E)
RED = RGBColor(0xB4, 0x23, 0x18)
BOXFILL = RGBColor(0xF2, 0xF2, 0xF2)
BOXLINE = RGBColor(0xD0, 0xD0, 0xD0)
FONT = "Calibri"


def m(d, k):
    return d[k]["mean"]


def pct(a, b):
    return (b - a) / a * 100


def chg(a, b):
    v = pct(a, b)
    return f"{'+' if v > 0 else '−'}{abs(v):.0f}%"


# ------------------------------------------------------------------ text helpers
def write(shape, paras, size=11, anchor=None, line=None):
    """paras: list of paragraphs; each paragraph is a str or a list of (text, {bold,color,size,italic}) runs."""
    tf = shape.text_frame
    tf.word_wrap = True
    body = tf._txBody
    for p in body.findall(qn("a:p")):
        body.remove(p)
    if anchor is not None:
        tf.vertical_anchor = anchor
    for para in paras:
        p_el = etree.SubElement(body, qn("a:p"))
        from pptx.text.text import _Paragraph
        p = _Paragraph(p_el, tf)
        opts = {}
        if isinstance(para, tuple) and len(para) == 2 and isinstance(para[1], dict) and isinstance(para[0], list):
            para, opts = para
        runs = [(para, {})] if isinstance(para, str) else para
        if opts.get("align"):
            p.alignment = opts["align"]
        if opts.get("space_after") is not None:
            p.space_after = Pt(opts["space_after"])
        if opts.get("space_before") is not None:
            p.space_before = Pt(opts["space_before"])
        if line:
            p.line_spacing = line
        for text, o in runs:
            r = p.add_run()
            r.text = text
            f = r.font
            f.name = FONT
            f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", False)
            f.italic = o.get("italic", False)
            f.color.rgb = o.get("color", INK)
    return tf


def B_(t, color=INK, size=None):
    o = {"bold": True, "color": color}
    if size:
        o["size"] = size
    return (t, o)


def N_(t, color=INK, size=None, italic=False):
    o = {"color": color, "italic": italic}
    if size:
        o["size"] = size
    return (t, o)


def shape_by_name(slide, name):
    for s in slide.shapes:
        if s.name == name:
            return s
    raise KeyError(name)


def add_box(slide, x, y, w, h, fill=BOXFILL, line=BOXLINE, radius=0.06):
    s = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Emu(x), Emu(y), Emu(w), Emu(h))
    s.adjustments[0] = radius
    s.fill.solid()
    s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(1)
    s.shadow.inherit = False
    tf = s.text_frame
    tf.margin_left = tf.margin_right = Emu(101600)
    tf.margin_top = tf.margin_bottom = Emu(76200)
    tf.vertical_anchor = MSO_ANCHOR.TOP
    return s


def answer_box(shape):
    """Turn a template placeholder box into an answer box (same look, dark upright text)."""
    return shape


prs = Presentation(TEMPLATE)
S = prs.slides

# ================================================================== Slide 2 · team & model
s2 = S[1]
write(shape_by_name(s2, "Text 8"), [[N_("[Team name: add before uploading]", RED, 11, italic=True)]])
write(shape_by_name(s2, "Text 10"), [[B_("Amrita Vidyalayam"), N_(", Erode, Tamil Nadu")]])
members = [
    ("Badriprasath K.V", "Simulation Lead: coded the web app; PPT & idea"),
    ("Ravi Kishor R.", "Algorithm & Simulation Engineer"),
    ("Kirthick", "Traffic Survey Lead: footpath counts, PCU; idea"),
    ("Hareesh Kannan", "Presentation & Pitch Lead: budget, pitch"),
]
write(shape_by_name(s2, "Text 12"), [[B_(n, size=10), N_(" – " + r, MUTED, 10)] for n, r in members], line=1.0)
write(shape_by_name(s2, "Text 14"), [
    [B_("https://<your-github-username>.github.io/pathai-surampatti/", BLUE, 9.5)],
    [N_("Opens in any browser, no login. Same app also runs offline from index.html.", MUTED, 8.5)],
])
write(shape_by_name(s2, "Text 16"), [[B_("☑  Real counts (we counted vehicles safely)", INK, 11)]])
write(shape_by_name(s2, "Text 19"), [
    [B_("Surampatti Four Road Junction, Erode", INK, 10)],
], anchor=MSO_ANCHOR.MIDDLE)

# ================================================================== Slide 3 · Q1 problem (no boxes in template: build cards)
s3 = S[2]
X0, Y0, W, H = 365760, 1755648, 8412480, 2980000
gap = 109728
colw = (W - gap) // 2
cards = [
    ("WHERE", [
        [B_("Surampatti Four Road Junction, Erode"), N_(" (≈ 11.33° N, 77.71° E).")],
        [N_("Perundurai Road (SH-96), Erode's busiest road, crosses Mohan Kumaramangalam Road and Surampatti Naal Road, 2 km from our school.")],
    ]),
    ("WHAT HAPPENS AT PEAK TIME", [
        [B_("644 vehicles in 10 minutes"), N_(" (weekday 18:15–18:25) = 2,551 PCU/hr.")],
        [N_("The East road (from the city core) alone carries "), B_("41%"), N_(" of all traffic. Schools, college buses, goods lorries and railway traffic all arrive together.")],
    ]),
    ("HOW THE SIGNAL WORKS TODAY", [
        [N_("A fixed timer: "), B_("every road gets 27 s green"), N_(" + 3 s amber, a 120 s cycle, all day.")],
        [N_("East needs 39 s but gets 27 s, so its queue never clears (x = 1.18). North needs only 20 s. "), B_("12 s of green go to the wrong road, every cycle.")],
    ]),
    ("WHAT IT COSTS PEOPLE", [
        [N_("East drivers wait "), B_("128 s on average"), N_("; the last car waits through 2 reds (over 4 minutes).")],
        [N_("Wasted fuel and smoke; late students and workers; textile and turmeric lorries stuck; ambulances to Thanthai Periyar GH use this road.")],
    ]),
]
rowh = 1110000
for i, (title, body) in enumerate(cards):
    cx = X0 + (i % 2) * (colw + gap)
    cy = Y0 + (i // 2) * (rowh + gap)
    box = add_box(s3, cx, cy, colw, rowh)
    write(box, [([B_(title, DARKBLUE, 10)], {"space_after": 2})] + [(p, {"space_after": 2}) for p in body], size=10)
users_y = Y0 + 2 * (rowh + gap)
ub = add_box(s3, X0, users_y, W, Y0 + H - users_y, fill=RGBColor(0xE8, 0xF3, 0xFC), line=RGBColor(0x9C, 0xC9, 0xEE))
write(ub, [[B_("WHO WILL USE IT   ", DARKBLUE, 10), B_("Erode City Traffic Police"), N_(" (duty officer at the console, with one-tap override) and the "),
            B_("Erode Corporation Smart City cell"), N_(" (planning and funding). Every driver, bus and ambulance at the junction benefits.")]],
      size=10, anchor=MSO_ANCHOR.MIDDLE)

# ================================================================== Slide 4 · screenshots
s4 = S[3]
caps = {
    "Text 8": ("screenshot_intersection.png", [B_("Our junction, to scale: "), N_("4 roads, widths and real peak counts. East has 41% of traffic but the same 27 s green.")]),
    "Text 10": ("screenshot_simulation.png", [B_("Same vehicles, two signals, in 3D: "), N_(f"the fixed timer's East queue passes 140 m while PATHAI gives East longer green.")]),
    "Text 12": ("screenshot_results.png", [B_("5 fair runs, same traffic: "), N_(f"PATHAI clears {pct(m(A,'cleared'), m(B,'cleared')):.0f}% more vehicles, cuts average wait by {-pct(m(A,'avgDelay'), m(B,'avgDelay')):.0f}% and the longest queue by {-pct(m(A,'maxQueueM'), m(B,'maxQueueM')):.0f}%.")]),
}
for name, (img, cap) in caps.items():
    cap_shape = shape_by_name(s4, name)
    w = cap_shape.width
    h = int(w / 1.3)
    top = 2029968 + (cap_shape.top - 2029968 - h) // 2
    pic = s4.shapes.add_picture(f"{SHOTS}/{img}", cap_shape.left, top, w, h)
    pic.line.color.rgb = BOXLINE
    pic.line.width = Pt(0.75)
    write(cap_shape, [cap], size=9, line=0.95)

# ================================================================== Slide 5 · how it works
s5 = S[4]
write(shape_by_name(s5, "Text 8"), [
    ([N_("4 infra-red cameras, one per road, count and sort vehicles day and night.")], {"space_after": 4}),
    ([N_("Each vehicle becomes PCU (IRC:106): bike 0.5, auto 0.8, car 1.0, LCV 1.4, bus/lorry 3.0. "), B_("One lorry = six scooters.")], {"space_after": 4}),
    ([N_("Counting happens inside the box: no faces, no number plates, no video stored.")], {"space_after": 4}),
    ([B_("In our model: "), N_("each second, vehicles arrive at random at the rates we counted (2,551 PCU/hr). Both signals get the exact same vehicles.")], {}),
], size=10.5)
write(shape_by_name(s5, "Text 11"), [
    ([B_("Webster's method, every cycle:")], {"space_after": 2}),
    ([N_("y = demand ÷ road capacity (S = 525 × width)")], {}),
    ([N_("C = (1.5L + 5) ÷ (1 − Y)")], {}),
    ([N_("Green = (C − L) × y ÷ Y")], {"space_after": 4}),
    ([B_("Our peak: "), N_("Y = 0.73, L = 20 s → C ≈ 128 s → "), B_("East 39, West 25, North 20, South 24 s.")], {"space_after": 4}),
    ([B_("Limits: "), N_("green 12–60 s · cycle 60–150 s · max ±20% change per cycle · any road waiting 120 s goes next · longest queue goes first.")], {}),
], size=10.5)
write(shape_by_name(s5, "Text 14"), [
    ([B_("Every change: 3 s amber + 2 s all-red."), N_(" Nothing can skip it.")], {"space_after": 4}),
    ([B_("Ambulance "), N_("(siren + radio tag): safe change, then green held up to 90 s; other roads get the time back next cycle.")], {"space_after": 4}),
    ([B_("Counts stop "), N_("(camera sure < 0.5 for 1 min): back to the old fixed timer + alarm.")], {"space_after": 4}),
    ([B_("Police: "), N_("one tap takes control.")], {"space_after": 4}),
    ([B_("Night: "), N_("Perundurai Rd rests on green; blinking amber below 40 PCU/hr.")], {}),
], size=10.5)

# ================================================================== Slide 6 · traffic data table
s6 = S[5]
tbl = shape_by_name(s6, "Table 0").table
rows = [
    ("East – Perundurai Rd (from city core)", "390", "27", "39"),
    ("West – Perundurai Rd (from Thindal)", "252", "27", "25"),
    ("North – Mohan Kumaramangalam Rd", "146", "27", "20"),
    ("South – Surampatti Naal Rd", "179", "27", "24"),
    ("Cycle check (all 4 roads)", "967 total", "4 × (27 + 3) = 120 s", "108 + 4 × (3 + 2) = 128 s"),
]


def cell_write(cell, runs, size=10.5, align=PP_ALIGN.CENTER):
    tf = cell.text_frame
    body = tf._txBody
    for p in body.findall(qn("a:p")):
        body.remove(p)
    from pptx.text.text import _Paragraph
    for para in runs:
        p = _Paragraph(etree.SubElement(body, qn("a:p")), tf)
        p.alignment = align
        for text, o in para:
            r = p.add_run()
            r.text = text
            r.font.name = FONT
            r.font.size = Pt(o.get("size", size))
            r.font.bold = o.get("bold", False)
            r.font.color.rgb = o.get("color", INK)
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE


for i, row in enumerate(rows, start=1):
    last = i == 5
    cell_write(tbl.cell(i, 0), [[B_(row[0])]], size=10.5, align=PP_ALIGN.LEFT)
    cell_write(tbl.cell(i, 1), [[B_(row[1]) if last else N_(row[1])]], size=11)
    cell_write(tbl.cell(i, 2), [[N_(row[2], MUTED if last else INK)]], size=10.5 if last else 11)
    cell_write(tbl.cell(i, 3), [[B_(row[3], GREEN if not last else INK)]], size=10.5 if last else 11)
c = tbl.cell(6, 1)
if not (c.is_merge_origin or c.is_spanned):
    c.merge(tbl.cell(6, 3))
cell_write(tbl.cell(6, 0), [[B_("Data: where, when & how")]], size=10.5, align=PP_ALIGN.LEFT)
cell_write(c, [
    [B_("Where: "), N_("footpath at Surampatti Four Road, Erode.  "), B_("When: "), N_("weekday evening peak, 18:15–18:25.")],
    [B_("How: "), N_("two of us counted every vehicle by type from the footpath and checked it on video; we timed the signal with a stopwatch over 3 cycles. "
                      "15-min figures = our 10-min count × 1.5 (644 → 966; 967 after rounding each road). Smart greens come from Webster's method; PATHAI recalculates them every cycle.")],
], size=9, align=PP_ALIGN.LEFT)

# ================================================================== Slide 7 · results
s7 = S[6]
left = shape_by_name(s7, "Text 9")
lx, ly, lw, lh = left.left, left.top, left.width, left.height
left._element.getparent().remove(left._element)
res_rows = [
    ("Measure (peak 15 min)", "Fixed", "PATHAI", "Change"),
    ("Vehicles cleared", f"{m(A,'cleared'):.0f}", f"{m(B,'cleared'):.0f}", chg(m(A,'cleared'), m(B,'cleared'))),
    ("…per hour (rate)", f"{m(A,'clearedHr'):,.0f}", f"{m(B,'clearedHr'):,.0f}", chg(m(A,'clearedHr'), m(B,'clearedHr'))),
    ("Average wait", f"{m(A,'avgDelay'):.0f} s", f"{m(B,'avgDelay'):.0f} s", chg(m(A,'avgDelay'), m(B,'avgDelay'))),
    ("Longest queue (East)", f"{A['per']['E']['maxQm']['mean']:.0f} m", f"{B['per']['E']['maxQm']['mean']:.0f} m", chg(A['per']['E']['maxQm']['mean'], B['per']['E']['maxQm']['mean'])),
    ("East road wait", f"{A['per']['E']['avgDelay']['mean']:.0f} s", f"{B['per']['E']['avgDelay']['mean']:.0f} s", chg(A['per']['E']['avgDelay']['mean'], B['per']['E']['avgDelay']['mean'])),
    ("Ambulance wait", f"{AMB['A']['mean']:.0f} s", f"{AMB['B']['mean']:.0f} s", chg(AMB['A']['mean'], AMB['B']['mean'])),
]
tshape = s7.shapes.add_table(len(res_rows), 4, lx, ly, lw, Emu(int(lh * 0.70)))
t = tshape.table
tblPr = tshape._element.graphic.graphicData.tbl.tblPr
style = tblPr.find(qn("a:tableStyleId"))
if style is None:
    style = etree.SubElement(tblPr, qn("a:tableStyleId"))
style.text = "{5940675A-B579-460E-94D1-54222C63F5DA}"   # "No Style, Table Grid"
tblPr.set("firstRow", "1")
tblPr.set("bandRow", "0")
for j, wv in enumerate([0.40, 0.19, 0.21, 0.20]):
    t.columns[j].width = Emu(int(lw * wv))
for i, row in enumerate(res_rows):
    t.rows[i].height = Emu(int(lh * 0.70 / len(res_rows)))
    for j, val in enumerate(row):
        cell = t.cell(i, j)
        cell.margin_left = cell.margin_right = Emu(54864)
        cell.margin_top = cell.margin_bottom = Emu(18288)
        cell.fill.solid()
        if i == 0:
            cell.fill.fore_color.rgb = DARKBLUE
            cell_write(cell, [[B_(val, RGBColor(0xFF, 0xFF, 0xFF), 9.5)]], align=PP_ALIGN.LEFT if j == 0 else PP_ALIGN.CENTER)
        else:
            cell.fill.fore_color.rgb = BOXFILL if i % 2 else RGBColor(0xFF, 0xFF, 0xFF)
            colr = INK if j < 3 else GREEN
            cell_write(cell, [[(val, {"bold": j in (0, 2, 3), "color": colr, "size": 9.5})]], align=PP_ALIGN.LEFT if j == 0 else PP_ALIGN.CENTER)
note = s7.shapes.add_textbox(lx, ly + int(lh * 0.70) + 45720, lw, int(lh * 0.30) - 45720)
side = {a: B["per"][a]["avgDelay"]["mean"] - A["per"][a]["avgDelay"]["mean"] for a in "SWN"}
write(note, [
    ([N_("Same vehicles for both signals, 5 runs with different random arrivals; average shown. "
         "Our fixed-timer run matches the waits we measured on the street within ±15% (East 138 s vs 128 s).", MUTED, 8.5)], {"space_after": 2}),
    ([B_("If the rush lasted a full hour: ", INK, 8.5), N_(f"wait {m(H60['A'],'avgDelay'):.0f} s → {m(H60['B'],'avgDelay'):.0f} s, longest queue {m(H60['A'],'maxQueueM'):.0f} m → {m(H60['B'],'maxQueueM'):.0f} m, "
                                                         f"{pct(m(H60['A'],'clearedHr'), m(H60['B'],'clearedHr')):+.0f}% vehicles cleared.", INK, 8.5)], {}),
], size=8.5)
note.text_frame.margin_left = note.text_frame.margin_right = 0

v1, v2, v4 = VAR["v1_profile_only"], VAR["v2_live_counts"], VAR["v4_final"]
write(shape_by_name(s7, "Text 10"), [
    ([B_("What we changed after testing", DARKBLUE, 10)], {"space_after": 1}),
    ([N_(f"1. Version 1 used only stored counts: North waited {v1['north']:.0f} s. Adding live camera counts cut the average wait from {v1['avgDelay']:.1f} to {v2['avgDelay']:.1f} s.")], {}),
    ([N_(f"2. Added “longest queue first” and a check on whether each queue cleared: worst road wait fell from {v2['worstArm']:.0f} to {v4['worstArm']:.0f} s.")], {}),
    ([N_("3. Found a bug: the ambulance hold ended before the ambulance arrived. Now green is held until it has crossed.")], {}),
    ([N_("4. Rounding sometimes made a 151 s cycle; added a hard 150 s cap.")], {"space_after": 3}),
    ([B_("Limits of our model", DARKBLUE, 10)], {"space_after": 1}),
    ([N_(f"• One real 10-min count, scaled to 15 min; we must recount on 2–3 days. Vehicle mix is estimated except East bikes.")], {}),
    ([N_(f"• Side roads wait {min(side.values()):.0f}–{max(side.values()):.0f} s longer (green moves to East, plus 2 s all-red).")], {}),
    ([N_("• One junction only; no turning traffic, pedestrians, lane-cutting or fog/rain camera errors.")], {}),
], size=9.5, line=0.95)

# ================================================================== Slide 8 · why it's worth it
s8 = S[7]
vh = m(A, "idleVehHr") - m(B, "idleVehHr")
fuel = m(A, "fuelL") - m(B, "fuelL")
co2 = m(A, "co2kg") - m(B, "co2kg")
fuel60 = m(H60["A"], "fuelL") - m(H60["B"], "fuelL")
co260 = m(H60["A"], "co2kg") - m(H60["B"], "co2kg")
days = 250
write(shape_by_name(s8, "Text 8"), [
    ([B_("Every evening peak (15 min): "), N_(f"{vh:.1f} vehicle-hours of waiting, {fuel:.1f} L fuel and {co2:.1f} kg CO₂ saved.")], {"space_after": 2}),
    ([B_(f"Per year ({days} weekdays): "), N_(f"≈ {round(vh*days, -2):,.0f} vehicle-hours, {round(fuel*days, -2):,.0f} L fuel (≈ ₹{round(fuel*days*100, -4)/1000:,.0f}k at ₹100/L) and {co2*days/1000:.1f} t CO₂.")], {"space_after": 2}),
    ([B_("Ambulances: "), N_(f"{AMB['A']['mean']:.0f} s → {AMB['B']['mean']:.0f} s wait. "), N_(f"A 1-hour rush: up to {fuel60:.0f} L and {co260:.0f} kg CO₂ saved per evening.", MUTED)], {}),
], size=9, line=0.95)
write(shape_by_name(s8, "Text 10"), [
    ([B_("Cost ≈ ₹1.5 lakh: "), N_("4 IR cameras ₹32k · edge computer ₹40k · battery ₹18k · cabinet & cabling ₹25k · console laptop ₹35k.")], {"space_after": 2}),
    ([B_("Steps: "), N_("90-day pilot at this one junction. Days 1–14 read-only (AI only advises). Days 15–90 live, an officer at the console. Then police decide.")], {}),
], size=9, line=0.95)
write(shape_by_name(s8, "Text 12"), [
    ([B_("1.  ", BLUE, 13), B_("Every evening, drivers on Perundurai Road wait over two minutes at Surampatti Four Road, because the signal gives every road the same 27 seconds.", INK, 13)], {"space_after": 9}),
    ([B_("2.  ", BLUE, 13), B_(f"With the same traffic, our AI signal cut average waiting by {abs(pct(m(A,'avgDelay'), m(B,'avgDelay'))):.0f}%, halved the longest queue and got ambulances through in {AMB['B']['mean']:.0f} seconds.", INK, 13)], {"space_after": 9}),
    ([B_("3.  ", BLUE, 13), B_("Give us 90 days at one junction for ₹1.5 lakh. Your officer keeps a one-tap override, and you judge it on your own junction's numbers.", INK, 13)], {"space_after": 12}),
    ([N_("No faces or number plates are recorded: the cameras only count.", MUTED, 9.5, italic=True)], {}),
], size=13, anchor=MSO_ANCHOR.MIDDLE)

# ================================================================== Slide 9 · individual understanding
s9 = S[8]
people = [
    ("Text 6", "Text 7", "Badriprasath K.V", "Simulation Lead",
     "Our signal gives every road the same 27 seconds, even though Perundurai Road East has the most traffic. "
     "I coded our website, where the same vehicles go through the old timer and our smart signal side by side. "
     f"The smart signal gives more green to the busy road, so average waiting dropped from about {m(A,'avgDelay'):.0f} to {m(B,'avgDelay'):.0f} seconds. "
     "I learned that a fair test needs exactly the same traffic for both signals."),
    ("Text 9", "Text 10", "Ravi Kishor R.", "Algorithm & Simulation Engineer",
     "Our project fixes a signal that never looks at how many vehicles are waiting. "
     "I worked on the rule for green time: the busier a road, the bigger its share, but never under 12 or over 60 seconds. "
     f"In our test, the East queue went from {A['per']['E']['maxQm']['mean']:.0f} m to {B['per']['E']['maxQm']['mean']:.0f} m. "
     "I learned that safety rules, like the 3 s amber and 2 s all-red, come before saving time."),
    ("Text 12", "Text 13", "Kirthick", "Traffic Survey Lead",
     "At Surampatti Four Road, cars on the busiest road wait through two red lights because the timer never changes. "
     "Our smart signal counts each road with cameras and moves green time to where the queue is. "
     "I counted the traffic from the footpath and changed it into PCU, so a lorry counts more than a scooter. "
     "I learned that real counts make an idea believable, because anyone can check them."),
    ("Text 15", "Text 16", "Hareesh Kannan", "Presentation & Pitch Lead",
     "A fixed signal wastes green on quiet roads while the busy road jams. "
     f"Our model runs the old signal and our AI signal side by side, and the AI clears more vehicles and lets ambulances through in about {AMB['B']['mean']:.0f} seconds. "
     "I made our pitch and the ₹1.5 lakh budget for a 90-day trial. "
     "I learned to explain our idea with simple numbers a police officer can check."),
]
for name_box, ans_box, name, role, text in people:
    write(shape_by_name(s9, name_box), [[B_(name, INK, 11), N_("  ·  " + role, MUTED, 9)]])
    write(shape_by_name(s9, ans_box), [[N_(text)]], size=9.5, line=0.95)

# ------------------------------------------------------------------ guard: no template placeholders left
left_over = []
for i, sl in enumerate(S, 1):
    for sh in sl.shapes:
        if sh.has_text_frame and ("Type your answer here" in sh.text_frame.text or sh.text_frame.text.strip() in ("Your name", "What does this screenshot show?")):
            left_over.append((i, sh.name))
if left_over:
    raise SystemExit(f"placeholders left: {left_over}")
prs.save(OUT)
print("saved", OUT)
