"""Writes the public pages of the Kanam Logistics site.

Run from the project folder:  python3 tools/pages.py   (needs: pip install beautifulsoup4)

Every headline, paragraph, list item, eyebrow and button in <main> gets a
data-c key (page.section.element, e.g. index.s1.h1). The portal's Pages tab
lists them, and text saved there replaces the text written here. Keep a
section's elements in the same order when editing this file, or saved text
may land on a different element."""
import os
from bs4 import BeautifulSoup
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ICON = {
    "truck": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    "grain": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V8"/><path d="M12 8c0-2.5 1.5-4.5 3.5-5 .3 2.5-1 4.5-3.5 5zM12 8c0-2.5-1.5-4.5-3.5-5-.3 2.5 1 4.5 3.5 5zM12 13c1-2 3-3 5-3-.2 2.3-2.2 3.6-5 3zM12 13c-1-2-3-3-5-3 .2 2.3 2.2 3.6 5 3zM12 18c1-2 3-3 5-3-.2 2.3-2.2 3.6-5 3zM12 18c-1-2-3-3-5-3 .2 2.3 2.2 3.6 5 3z"/></svg>',
    "road": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 21M16 3l4 18M12 4v2M12 10v3M12 17v3"/></svg>',
    "shield": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
    "clock": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    "pin": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    "phone": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
    "mail": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    "tag": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    "digger": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h12M3 18v-3h9v3"/><circle cx="5" cy="19.5" r="1"/><circle cx="10" cy="19.5" r="1"/><path d="M7 15v-3h4l1 3M11 12l5-7 4 4-2 3"/><path d="M20 9v4l-2 1"/></svg>',
    "chat": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>',
}

SKIP_ATTRS = {"data-s", "data-tel", "data-mail", "data-products", "data-projects", "data-faqs",
              "data-news", "data-team", "data-testimonials", "data-equipment", "data-companies", "id"}
INLINE_OK = {"br", "strong", "b", "em"}

def add_keys(body, page_key):
    """Give each editable piece of text in the page a data-c key."""
    soup = BeautifulSoup(body, "html.parser")
    for si, section in enumerate([t for t in soup.find_all(recursive=False) if t.name], start=1):
        counts = {}
        for el in section.find_all(["h1", "h2", "h3", "p", "li", "span", "a"]):
            classes = el.get("class") or []
            if el.name == "span" and "eyebrow" not in classes:
                continue
            if el.name == "a" and not ({"btn", "more"} & set(classes)):
                continue
            if el.find_parent(["form"]) or el.find_parent(class_=["filter", "img-ph"]) or el.find_parent(attrs={"data-c": True}):
                continue
            if any(a in el.attrs for a in SKIP_ATTRS - {"id"}) or any(
                    c.name and (c.name not in INLINE_OK or any(a in c.attrs for a in SKIP_ATTRS)) for c in el.descendants):
                continue
            if not el.get_text(strip=True):
                continue
            kind = "eyebrow" if el.name == "span" else ("btn" if "btn" in classes else "link") if el.name == "a" else el.name
            counts[kind] = counts.get(kind, 0) + 1
            el["data-c"] = f"{page_key}.s{si}.{kind}-{counts[kind]}"
    return str(soup)

def page(file, title, desc, body, form=False):
    body = add_keys(body.strip(), file.replace(".html", ""))
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/site.css">
</head>
<body data-page="{file}">
<main id="main">
{body.strip()}
</main>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3"></script>
<script src="js/config.js"></script>
<script src="js/data.js"></script>
<script src="js/md.js"></script>
<script src="js/site.js"></script>
</body>
</html>
"""
    open(os.path.join(ROOT, file), "w").write(html)

def quote_form(heading, anchor, default_kind="Rice order", intro=""):
    kinds = ["Rice order", "Supplies & delivery", "Road works", "Machinery hire", "Hardware & glass", "Other"]
    opts = "".join(f'<option{" selected" if k == default_kind else ""}>{k}</option>' for k in kinds)
    return f"""
<form class="quote" id="quote-form" novalidate>
  <span id="{anchor}" style="position:relative;top:-90px"></span>
  <h2>{heading}</h2>
  {f'<p class="muted" style="margin:0">{intro}</p>' if intro else ''}
  <label>What do you need?
    <select name="kind">{opts}</select>
  </label>
  <div class="row2 rice-only">
    <label>Bag size <select name="product"></select></label>
    <label>How many bags? <input name="quantity" inputmode="numeric" maxlength="60" placeholder="e.g. 4"></label>
  </div>
  <div class="row2 hire-only" hidden>
    <label>Machine <select name="machine"></select></label>
    <label>For how long? <input name="hire_for" maxlength="60" placeholder="e.g. 3 days"></label>
  </div>
  <div class="row2">
    <label>Your name <input name="name" required maxlength="120" autocomplete="name"></label>
    <label>Phone <input name="phone" required type="tel" minlength="7" maxlength="30" autocomplete="tel" placeholder="07XX XXX XXX"></label>
  </div>
  <label>Email <span class="opt">(optional)</span> <input name="email" type="email" maxlength="200" autocomplete="email"></label>
  <label>Details <span class="opt">(delivery place, dates, anything else)</span> <textarea name="message" maxlength="3000"></textarea></label>
  <label class="hp" aria-hidden="true">Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label>
  <button class="btn btn-navy" type="submit">Send</button>
  <p id="quote-status" class="form-status" role="status" aria-live="polite"></p>
</form>"""

# Browsers' own "required" bubbles are skipped (novalidate) so the form can be checked
# by site.js? No: keep it simple and let the browser check required fields.
def fix_validation(s):
    return s.replace(' novalidate', '')

CTA = """
<section>
  <div class="wrap">
    <div class="cta-band">
      <div>
        <h2>Need goods sourced, moved or delivered?</h2>
        <p>Tell us what you need and where. We will get back to you with a price.</p>
      </div>
      <div class="hero-actions" style="margin:0">
        <a class="btn" href="contact.html#quote">Get a quote</a>
        <a class="btn btn-ghost" data-wa target="_blank" rel="noopener" hidden>WhatsApp us</a>
      </div>
    </div>
  </div>
</section>"""

SERVICES_CARDS = f"""
<div class="grid grid-4">
  <article class="card">
    <div class="icon">{ICON['truck']}</div>
    <h3>Supplies & delivery</h3>
    <p>Foodstuff and other goods for hospitals, schools and institutions, delivered on schedule.</p>
    <a class="more" href="services.html#supplies">How it works →</a>
  </article>
  <article class="card">
    <div class="icon">{ICON['grain']}</div>
    <h3>Pishori rice</h3>
    <p>Aromatic Pishori rice sourced at the farm gate, sorted and packed in 5, 10 and 25 kg bags.</p>
    <a class="more" href="rice.html">See prices →</a>
  </article>
  <article class="card">
    <div class="icon">{ICON['road']}</div>
    <h3>Road works</h3>
    <p>Rural road maintenance (grading, gravelling, drainage) for public authorities.</p>
    <a class="more" href="services.html#roads">Our road works →</a>
  </article>
  <article class="card">
    <div class="icon">{ICON['digger']}</div>
    <h3>Machinery hire</h3>
    <p>Hire our motor grader, and soon our excavator, with an experienced operator.</p>
    <a class="more" href="services.html#hire">See machines and rates →</a>
  </article>
</div>"""

# ------------------------------ Home ------------------------------
page("index.html", "Kanam Logistics Limited – Supplies, Pishori rice & road works",
     "Kanam Logistics Limited sources, moves and delivers for Western Kenya: institutional supplies, Pishori rice and rural road works.",
f"""
<section class="hero">
  <div class="wrap">
    <span class="eyebrow">Kanam Logistics Limited</span>
    <h1>Sourced right.<br>Delivered on time.</h1>
    <p class="lead" data-s="tagline"></p>
    <div class="hero-actions">
      <a class="btn" href="rice.html">Order Pishori rice</a>
      <a class="btn btn-ghost" href="contact.html#quote">Get a quote</a>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">What we do</span>
      <h2>Three ways we get things where they need to be</h2>
    </div>
    {SERVICES_CARDS}
  </div>
</section>

<section class="alt">
  <div class="wrap grid-2 grid">
    <div>
      <span class="eyebrow">Why Kanam</span>
      <h2>A supplier institutions can count on</h2>
      <p class="muted" data-s="mission"></p>
      <ul class="ticks">
        <li>Registered Kenyan company, Reg. no. <span data-s="reg_no"></span></li>
        <li>Trusted with public contracts by KERRA and JOOTRH</li>
        <li>Our own sourcing: we buy at the farm gate and pack ourselves</li>
        <li>Delivery across <span data-s="delivery_areas"></span></li>
      </ul>
    </div>
    <div class="stats">
      <div class="stat"><b data-s="year_registered"></b><span>Year registered</span></div>
      <div class="stat"><b data-s="roads_done"></b><span>Road maintenance contracts</span></div>
      <div class="stat"><b data-s="years_supplying"></b><span>Supplying institutions</span></div>
      <div class="stat"><b>5 · 10 · 25 kg</b><span>Pishori rice bags</span></div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Pishori rice</span>
      <h2>Fresh stock, fair prices</h2>
      <p class="muted">Sorted and packed by us. Order by phone, WhatsApp or the form, and we deliver.</p>
    </div>
    <div class="products" data-products="compact"></div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Our work</span>
      <h2>Recent projects</h2>
    </div>
    <div class="projects" data-projects="3"></div>
    <p style="margin-top:24px"><a class="btn btn-navy btn-sm" href="projects.html">All projects</a></p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Clients</span>
      <h2>Who we have worked with</h2>
    </div>
    <div class="clients">
      <div class="client"><div class="mark">KeRRA</div><div><strong>Kenya Rural Roads Authority</strong><p>Rural road maintenance</p></div></div>
      <div class="client"><div class="mark">JOOTRH</div><div><strong>Jaramogi Oginga Odinga Teaching & Referral Hospital</strong><p>Foodstuff supply & delivery</p></div></div>
    </div>
  </div>
</section>

<section class="alt" data-hide-empty hidden>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Testimonials</span>
      <h2>What our customers say</h2>
    </div>
    <div class="testimonials" data-testimonials></div>
  </div>
</section>

<section data-hide-empty hidden>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">News</span>
      <h2>Latest from Kanam</h2>
    </div>
    <div class="posts" data-news="3"></div>
    <p style="margin-top:24px"><a class="btn btn-navy btn-sm" href="news.html">All news</a></p>
  </div>
</section>

<section class="alt" data-hide-empty hidden>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Our companies</span>
      <h2>One family of companies</h2>
      <p class="muted">Kanam Logistics and its sister companies: road works, machinery, supplies and hardware, under one roof.</p>
    </div>
    <div class="co-cards" data-companies></div>
  </div>
</section>
{CTA}
""")

# ------------------------------ About ------------------------------
page("about.html", "About us – Kanam Logistics Limited",
     "Who we are: a registered Kenyan company in supplies, delivery, Pishori rice trading and rural road works.",
f"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">About us</span>
    <h1>Built on getting the job done</h1>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap grid grid-2">
    <div>
      <h2>Our story</h2>
      <p data-s="about"></p>
      <p>Every line of our business comes down to the same thing: getting the right goods, or the right work, to where it is needed, on time and at a fair price. That is what logistics means to us.</p>
    </div>
    <div class="img-ph"><span>Photo: the team, the office or a delivery vehicle</span></div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">What drives us</span>
      <h2>Our mission</h2>
      <p class="muted" data-s="mission"></p>
    </div>
    <div class="grid grid-4">
      <div class="card"><div class="icon">{ICON['clock']}</div><h3>On time</h3><p>We agree a date and keep it.</p></div>
      <div class="card"><div class="icon">{ICON['shield']}</div><h3>Honest</h3><p>Clear prices, proper receipts, no surprises.</p></div>
      <div class="card"><div class="icon">{ICON['tag']}</div><h3>Fair prices</h3><p>We source directly, so you don't pay for middlemen.</p></div>
      <div class="card"><div class="icon">{ICON['pin']}</div><h3>Local</h3><p>We know Western Kenya's roads, markets and people.</p></div>
    </div>
  </div>
</section>

<section data-hide-empty hidden>
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Our team</span>
      <h2>The people behind Kanam</h2>
    </div>
    <div class="team" data-team></div>
  </div>
</section>

<section>
  <div class="wrap grid grid-2">
    <div>
      <h2>Company details</h2>
      <ul class="contact-list">
        <li><span class="icon">{ICON['shield']}</span><div><b>Registered name</b>Kanam Logistics Limited</div></li>
        <li><span class="icon">{ICON['shield']}</span><div><b>Registration number</b><span data-s="reg_no"></span></div></li>
        <li><span class="icon">{ICON['tag']}</span><div><b>KRA PIN</b><span data-s="kra_pin"></span></div></li>
        <li><span class="icon">{ICON['clock']}</span><div><b>Registered in</b><span data-s="year_registered"></span></div></li>
        <li><span class="icon">{ICON['chat']}</span><div><b>Directors</b><span data-s="directors"></span></div></li>
      </ul>
    </div>
    <div class="card">
      <h3>Documents for tenders</h3>
      <p class="muted">Procurement officers: we can share these on request.</p>
      <ul class="ticks">
        <li>Certificate of incorporation</li>
        <li>KRA PIN and tax compliance certificate</li>
        <li>Company profile and past contracts</li>
        <li><span class="ph">[Any others, e.g. AGPO certificate, NCA registration]</span></li>
      </ul>
      <a class="btn btn-sm btn-navy" href="contact.html?kind=Other#quote">Request documents</a>
    </div>
  </div>
</section>
{CTA}
""")

# ------------------------------ Services ------------------------------
page("services.html", "Services – Kanam Logistics Limited",
     "Institutional supplies and delivery, Pishori rice trading, rural road maintenance and machinery hire (grader, excavator) in Western Kenya.",
f"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">Services</span>
    <h1>What we can do for you</h1>
    <p class="muted" style="max-width:620px">Whether it is a hospital kitchen that needs stocking, a family that wants good rice, or a rural road that needs fixing, we take it from start to finish.</p>
  </div>
</section>

<div class="wrap">
  <div class="service" id="supplies">
    <div>
      <span class="eyebrow">Supplies & delivery</span>
      <h2>Foodstuff and goods for institutions</h2>
      <p>We supply hospitals, schools and other institutions with foodstuff and general goods, delivered on the schedule you set. We have supplied Jaramogi Oginga Odinga Teaching & Referral Hospital (JOOTRH).</p>
      <ul class="ticks">
        <li>Cereals, rice, pulses and other foodstuff</li>
        <li>Scheduled deliveries: daily, weekly or monthly</li>
        <li>Delivery notes and invoices for your records</li>
        <li>Tender and LPO/LSO ready</li>
      </ul>
      <a class="btn btn-navy" href="contact.html?kind=Supplies%20%26%20delivery#quote">Request a supply quote</a>
    </div>
    <div class="service-img"><div class="img-ph"><span>Photo: a delivery to an institution</span></div></div>
  </div>

  <div class="service" id="rice">
    <div>
      <span class="eyebrow">Rice trading</span>
      <h2>Pishori rice, from the farm to you</h2>
      <p>We buy Pishori rice directly from growers, have it sorted and packed, and transport it ourselves. Shops, hotels, schools and families get good rice at a fair price.</p>
      <ul class="ticks">
        <li>5, 10 and 25 kg bags</li>
        <li>Wholesale prices for shops and institutions</li>
        <li>Delivery across <span data-s="delivery_areas"></span></li>
      </ul>
      <a class="btn btn-navy" href="rice.html">See prices and order</a>
    </div>
    <div class="service-img"><div class="img-ph"><span>Photo: Pishori rice bags</span></div></div>
  </div>

  <div class="service" id="roads">
    <div>
      <span class="eyebrow">Road works</span>
      <h2>Rural road maintenance</h2>
      <p>We carry out maintenance on rural roads for public authorities, including contracts with the Kenya Rural Roads Authority (KERRA).</p>
      <ul class="ticks">
        <li>Grading and reshaping</li>
        <li>Murram gravelling and spot improvement</li>
        <li>Drainage: culverts, mitre drains and side drains</li>
        <li>Bush clearing and routine maintenance</li>
      </ul>
      <a class="btn btn-navy" href="contact.html?kind=Road%20works#quote">Talk to us about a contract</a>
    </div>
    <div class="service-img"><div class="img-ph"><span>Photo: a road before and after</span></div></div>
  </div>

  <div class="service service-wide" id="hire">
    <div>
      <span class="eyebrow">Machinery hire</span>
      <h2>Heavy machinery for hire</h2>
      <p>Hire our machines for road works, site levelling, drainage and earthworks. Every machine comes with an experienced operator.</p>
      <div class="machines" data-equipment></div>
      <p class="muted small">Rates exclude fuel unless stated. Ask us about longer hire periods and transport to your site.</p>
      <a class="btn btn-navy" href="contact.html?kind=Machinery%20hire#quote">Ask about machinery hire</a>
    </div>
  </div>
</div>
{CTA}
""")

# ------------------------------ Rice ------------------------------
page("rice.html", "Pishori rice – Kanam Logistics Limited",
     "Buy aromatic Pishori rice in 5, 10 and 25 kg bags. Sorted, packed and delivered by Kanam Logistics.",
fix_validation(f"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">Pishori rice</span>
    <h1>Aromatic Pishori rice, delivered</h1>
    <p class="muted" style="max-width:620px">Sourced from growers, sorted and packed by us. Pick a bag size and order by the form, phone or WhatsApp.</p>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div class="products" data-products></div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <div class="section-head"><h2>How ordering works</h2></div>
    <ol class="steps">
      <li><h3>Order</h3><p>Use the form below, call <a data-tel data-s="phone"></a>, or WhatsApp us.</p></li>
      <li><h3>Confirm</h3><p>We call you back to confirm the price, delivery place and time.</p></li>
      <li><h3>Receive & pay</h3><p>We deliver. Payment: <span data-s="payment"></span>.</p></li>
    </ol>
    <p class="muted" style="margin-top:20px">We deliver across <span data-s="delivery_areas"></span>. Buying for a shop, school or hotel? Ask for wholesale prices.</p>
  </div>
</section>

<section>
  <div class="wrap grid grid-2">
    {quote_form("Order rice", "order", "Rice order")}
    <div>
      <h2>Questions?</h2>
      <ul class="contact-list">
        <li><span class="icon">{ICON['phone']}</span><div><b>Call</b><a data-tel data-s="phone"></a></div></li>
        <li><span class="icon">{ICON['chat']}</span><div><b>WhatsApp</b><span data-s="whatsapp"></span></div></li>
        <li><span class="icon">{ICON['clock']}</span><div><b>Hours</b><span data-s="hours"></span></div></li>
      </ul>
      <div class="img-ph" style="margin-top:24px"><span>Photo: rice being sorted and packed</span></div>
    </div>
  </div>
</section>
"""), form=True)

# ------------------------------ Projects ------------------------------
page("projects.html", "Projects – Kanam Logistics Limited",
     "Road maintenance, institutional supply and rice trading projects by Kanam Logistics Limited.",
"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">Our work</span>
    <h1>Projects</h1>
    <p class="muted" style="max-width:620px">A record of the roads we have maintained, the institutions we have supplied, and the rice we have moved.</p>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div class="filter" id="project-filter" role="group" aria-label="Filter projects">
      <button type="button" data-cat="all" aria-pressed="true">All</button>
      <button type="button" data-cat="Road works" aria-pressed="false">Road works</button>
      <button type="button" data-cat="Supplies & delivery" aria-pressed="false">Supplies & delivery</button>
      <button type="button" data-cat="Rice trading" aria-pressed="false">Rice trading</button>
    </div>
    <div class="projects" data-projects></div>
  </div>
</section>
""" + CTA)

# ------------------------------ Contact ------------------------------
page("contact.html", "Contact – Kanam Logistics Limited",
     "Call, WhatsApp or send a request to Kanam Logistics Limited for rice orders, supplies and road works.",
fix_validation(f"""
<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">Contact</span>
    <h1>Let's talk</h1>
    <p class="muted" style="max-width:620px">Call, WhatsApp, email or send the form. We usually reply the same day.</p>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap grid grid-2">
    <div>
      <ul class="contact-list">
        <li><span class="icon">{ICON['phone']}</span><div><b>Phone</b><a data-tel data-s="phone"></a></div></li>
        <li><span class="icon">{ICON['chat']}</span><div><b>WhatsApp</b><span data-s="whatsapp"></span></div></li>
        <li><span class="icon">{ICON['mail']}</span><div><b>Email</b><a data-mail data-s="email"></a></div></li>
        <li><span class="icon">{ICON['pin']}</span><div><b>Office</b><span data-s="location"></span><br><span data-s="postal"></span></div></li>
        <li><span class="icon">{ICON['clock']}</span><div><b>Hours</b><span data-s="hours"></span></div></li>
      </ul>
      <p style="margin-top:20px"><a class="btn btn-wa" data-wa target="_blank" rel="noopener" hidden>Chat on WhatsApp</a></p>
      <div class="img-ph map-ph"><span>Map: add a Google Maps link to the office once the location is set</span></div>
    </div>
    {quote_form("Send us a request", "quote", "Supplies & delivery", "For rice, supplies or road works. We will call you back with a price.")}
  </div>
</section>

<section class="alt" data-hide-empty>
  <div class="wrap faq-wrap">
    <div class="section-head">
      <span class="eyebrow">FAQs</span>
      <h2>Frequently asked questions</h2>
    </div>
    <div class="faqs" data-faqs></div>
  </div>
</section>
"""), form=True)

# ------------------------------ News ------------------------------
page("news.html", "News – Kanam Logistics Limited",
     "Company news from Kanam Logistics Limited: new rice stock, completed projects and updates.",
"""
<section class="page-hero" id="news-listing">
  <div class="wrap">
    <span class="eyebrow">News</span>
    <h1>News & updates</h1>
    <p class="muted" style="max-width:620px">New stock, completed projects and what is happening at Kanam Logistics.</p>
    <div class="posts" data-news style="margin-top:32px"></div>
  </div>
</section>

<section class="page-hero" hidden>
  <div class="wrap article-wrap"><article id="article"></article></div>
</section>
""")
page("companies.html", "Our companies – Kanam Logistics Limited",
     "Kanam Logistics Limited and its sister companies: road contracts and machinery, supplies, hardware and glass.",
"""
<section class="page-hero" id="companies-listing">
  <div class="wrap">
    <span class="eyebrow">Our companies</span>
    <h1>One family of companies</h1>
    <p class="muted" style="max-width:620px">Kanam Logistics and its sister companies. Each one is its own registered business, and you can reach all of them through us.</p>
    <div class="co-cards" data-companies style="margin-top:32px"></div>
  </div>
</section>

<section class="page-hero" hidden>
  <div class="wrap"><div id="company"></div></div>
</section>
""")
print("pages written")
