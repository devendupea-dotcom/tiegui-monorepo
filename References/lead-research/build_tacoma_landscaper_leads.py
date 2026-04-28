import csv
import os
import re
import ssl
import time
import urllib.parse
import urllib.request
from html import unescape


OUT_DIR = os.path.dirname(__file__)
CSV_PATH = os.path.join(OUT_DIR, "tacoma-landscaper-leads.csv")
MD_PATH = os.path.join(OUT_DIR, "tacoma-landscaper-leads.md")


CANDIDATES = [
    {"company": "Urban Roots Landscaping Tacoma LLC", "category": "Landscaper", "rating": 4.8, "reviews": 135, "phone": "(253) 292-3839", "website": "http://urbanrootslandscaping.com/"},
    {"company": "Pierce Landscapers & Lawn Care", "category": "Landscaper", "rating": 4.8, "reviews": 44, "phone": "(253) 652-9961", "website": ""},
    {"company": "Father Nature Landscapes of Tacoma, Inc.", "category": "Landscaper", "rating": 4.5, "reviews": 119, "phone": "(253) 761-6437", "website": "https://fnltacoma.com/"},
    {"company": "Royal Landscaping & Hauling", "category": "Landscaper", "rating": 5.0, "reviews": 105, "phone": "(253) 509-1272", "website": "https://royal-junk-removal.com/contact/"},
    {"company": "G&L Landscaping", "category": "Landscape designer", "rating": 4.7, "reviews": 12, "phone": "(253) 283-8738", "website": "https://halcon240624.wixsite.com/mysite"},
    {"company": "Alvin's Landscaping", "category": "Landscaper", "rating": 4.6, "reviews": 40, "phone": "(253) 677-9064", "website": "http://alvinslandscaping.com/"},
    {"company": "Chipo's lawn service", "category": "Lawn care service", "rating": 4.8, "reviews": 61, "phone": "(253) 341-3550", "website": "https://chiposlawnservice.com/"},
    {"company": "Green place Landscaping", "category": "Landscape designer", "rating": 4.8, "reviews": 8, "phone": "(253) 267-9852", "website": "http://www.greenplacelandscaping.net/"},
    {"company": "TG Landscaping Specialist LLC", "category": "Landscaper", "rating": 5.0, "reviews": 2, "phone": "(253) 861-9927", "website": ""},
    {"company": "NORTHWEST LAWN CARE AND LANDSCAPING LLC", "category": "Landscaper", "rating": 4.9, "reviews": 94, "phone": "(253) 820-5647", "website": "http://www.nwlcl.com/"},
    {"company": "Nasim Landscape", "category": "Landscaper", "rating": 4.6, "reviews": 90, "phone": "(253) 988-0165", "website": "http://www.nasimlandscape.com/"},
    {"company": "DG Landscaping LLC", "category": "Landscaper", "rating": 4.4, "reviews": 16, "phone": "(253) 218-1115", "website": "https://dglandscapingllc.com/"},
    {"company": "SS Landscaping Services", "category": "Landscaper", "rating": 3.9, "reviews": 50, "phone": "(253) 535-2922", "website": "http://www.sslandinc.com/"},
    {"company": "Dove Landscaping", "category": "Landscaper", "rating": 5.0, "reviews": 23, "phone": "(253) 778-3242", "website": "http://www.dovelandscapingwa.com/"},
    {"company": "Best Northwestern Landscape CO", "category": "Landscaper", "rating": 4.8, "reviews": 43, "phone": "(253) 590-3800", "website": "http://bestnorthwesternlandscapeco.com/"},
    {"company": "Dominguez landscaping service,LLC", "category": "Landscaper", "rating": 4.6, "reviews": 41, "phone": "(253) 592-1805", "website": "https://dominguezlandscapingservice.com/"},
    {"company": "G&R Landscaping", "category": "Landscape designer", "rating": 5.0, "reviews": 14, "phone": "(253) 293-8681", "website": "https://grlandscapinginc.com/"},
    {"company": "Oscar's Lawn Service Etc", "category": "Lawn care service", "rating": 5.0, "reviews": 8, "phone": "(253) 752-2419", "website": "http://www.oscarslawnserviceetc.com/"},
    {"company": "Lakewood Landscaping LLC", "category": "Landscaper", "rating": 4.7, "reviews": 12, "phone": "(253) 324-4486", "website": "http://www.lakewoodlandscapingwa.com/"},
    {"company": "Markee Ecological Garden Design", "category": "Landscaper", "rating": 5.0, "reviews": 17, "phone": "(206) 228-5794", "website": "https://www.markeegardens.com/"},
    {"company": "Specialized Landscaping", "category": "Landscaper", "rating": 4.4, "reviews": 14, "phone": "(253) 536-9393", "website": "http://www.specializedlandscaping.com/"},
    {"company": "Artist Rock Wall & Landscaping", "category": "Landscape architect", "rating": 4.6, "reviews": 10, "phone": "(253) 226-8531", "website": "http://www.artisticrockwallandlandscaping.com/"},
    {"company": "Victor Landscape Inc", "category": "Landscaper", "rating": 5.0, "reviews": 3, "phone": "(360) 310-8662", "website": ""},
    {"company": "Soundview Landscape & Sprinkler, Co.", "category": "Landscape designer", "rating": 4.0, "reviews": 33, "phone": "(253) 565-8012", "website": "http://www.soundviewls.com/"},
    {"company": "Miguel Banuelos landscaping and lawncare", "category": "Lawn care service", "rating": 5.0, "reviews": 11, "phone": "(253) 348-4059", "website": ""},
    {"company": "Tiger's Landscape & Construction", "category": "Landscape designer", "rating": 5.0, "reviews": 22, "phone": "(253) 330-6435", "website": "http://tigerslcpnw.com/"},
    {"company": "Mario's Landscaping Inc", "category": "Landscaper", "rating": 3.8, "reviews": 5, "phone": "(253) 564-4375", "website": "http://landscapertacoma.com/"},
    {"company": "ARW Landscape Design", "category": "Landscape architect", "rating": 4.8, "reviews": 16, "phone": "(253) 223-1162", "website": "http://www.arwlandscapedesign.com/"},
    {"company": "Poly Care Landscaping", "category": "Landscape architect", "rating": 5.0, "reviews": 1, "phone": "(435) 383-7319", "website": "https://poly-care-landscaping.ueniweb.com/?utm_campaign=gmb"},
    {"company": "True Design Landscape", "category": "Landscape designer", "rating": 5.0, "reviews": 34, "phone": "(253) 278-9573", "website": "https://truedesignlandscape.com/?utm_source=GBP&utm_medium=organic&utm_campaign=website"},
    {"company": "ECO Landscaping LLC", "category": "Lawn care service", "rating": 4.6, "reviews": 21, "phone": "(253) 267-4611", "website": "http://www.ecolandscapingllc.org/"},
    {"company": "Major League Lawn Care", "category": "Lawn care service", "rating": 5.0, "reviews": 2, "phone": "(253) 565-1598", "website": "http://www.lawncarenw.com/"},
    {"company": "finishing touch lawn care tacoma wa", "category": "Lawn care service", "rating": 3.0, "reviews": 2, "phone": "(253) 345-4546", "website": "https://www.lawncaretacomawa.com/contact-page"},
    {"company": "Tacoma Turf Care", "category": "Lawn care service", "rating": 0.0, "reviews": 0, "phone": "(253) 201-3846", "website": "https://tacomalawncareservices.com/"},
    {"company": "Nature's Best Friend", "category": "Lawn care service", "rating": 4.9, "reviews": 7, "phone": "(253) 392-8740", "website": "https://naturesbestfriendllc.com/"},
    {"company": "JPLAWNCAREWA", "category": "Lawn care service", "rating": 5.0, "reviews": 11, "phone": "(253) 414-2301", "website": "https://jplawncarewa.com/"},
    {"company": "Salazar's LANDSCAPING & Lawn Care Services", "category": "Lawn care service", "rating": 4.5, "reviews": 15, "phone": "(253) 590-8370", "website": "https://salazarslandscaping.com/"},
    {"company": "Mr.P's Lawn Care Service", "category": "Lawn care service", "rating": 4.9, "reviews": 57, "phone": "(253) 324-1579", "website": "http://mrpslawncareservice.com/"},
    {"company": "Columbia Landscape and Irrigation LLC", "category": "Landscaper", "rating": 5.0, "reviews": 36, "phone": "(253) 282-5834", "website": "http://columbialandscapellc.com/"},
    {"company": "Outdoor Works LLC", "category": "Landscape designer", "rating": 4.6, "reviews": 34, "phone": "(253) 298-2865", "website": "https://www.outdoorworksllc.com/"},
    {"company": "The Family Landscaping", "category": "Landscaper", "rating": 5.0, "reviews": 3, "phone": "(253) 324-7445", "website": ""},
    {"company": "D.P.M construction & landscaping", "category": "Landscaper", "rating": 5.0, "reviews": 2, "phone": "(253) 304-4844", "website": "https://www.dpmconstructionlandscaping.com/"},
    {"company": "Barretts Landscaping And Construction", "category": "Contractor", "rating": 4.0, "reviews": 4, "phone": "(253) 292-0431", "website": "https://www.barrettslandscape.com/"},
    {"company": "Dream Green Landscapes LLC", "category": "Landscaper", "rating": 5.0, "reviews": 7, "phone": "(253) 797-5567", "website": "https://landscaperstacomawa.com/"},
    {"company": "Tran's Landscaping and Gardening LLC", "category": "Landscape designer", "rating": 4.4, "reviews": 56, "phone": "(253) 984-6802", "website": "http://trans-landscaping.com/"},
    {"company": "Archterra Landscape Services, LLC", "category": "Landscaper", "rating": 4.7, "reviews": 81, "phone": "(253) 215-2023", "website": "http://archterralandscape.com/"},
    {"company": "Pines Landscape", "category": "Landscaper", "rating": 5.0, "reviews": 12, "phone": "(253) 227-7446", "website": "https://www.pineslandscape.com/"},
    {"company": "Landmark Landscaping Inc.", "category": "Landscaper", "rating": 5.0, "reviews": 3, "phone": "(253) 606-5263", "website": "http://www.landmarklandscapinginc.com/"},
    {"company": "Jg landscape LLC", "category": "Landscaper", "rating": 5.0, "reviews": 42, "phone": "(425) 435-7986", "website": "http://jglandscapellc.net/"},
    {"company": "Mago Landscaping Services", "category": "Landscaper", "rating": 4.0, "reviews": 5, "phone": "(253) 287-8090", "website": ""},
    {"company": "JC'S Landscaping", "category": "Landscaper", "rating": 5.0, "reviews": 1, "phone": "(253) 640-6593", "website": ""},
    {"company": "Hastrada Landscape Maintenance Services", "category": "Landscaper", "rating": 5.0, "reviews": 6, "phone": "(253) 330-1751", "website": ""},
    {"company": "Gomez Landscaping & clean up", "category": "Landscaper", "rating": 5.0, "reviews": 3, "phone": "(206) 602-8779", "website": ""},
    {"company": "Memos Landscaping & Construction Inc", "category": "Landscaper", "rating": 5.0, "reviews": 1, "phone": "(253) 255-2743", "website": ""},
]

EMAIL_RE = re.compile(r"([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})", re.I)
HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")
LOCAL_TERMS = ["tacoma", "lakewood", "puyallup", "spanaway", "parkland", "pierce county", "university place", "puget sound"]
CTA_TERMS = ["estimate", "quote", "book", "schedule", "call", "text", "request", "contact", "free estimate", "consultation"]
PLATFORM_MARKERS = {
    "jobber": ["jobber", "getjobber"],
    "housecallpro": ["housecallpro"],
    "ueni": ["ueniweb", "ueni"],
    "wix": ["wix", "wixsite"],
    "squarespace": ["squarespace"],
    "weebly": ["weebly"],
    "wordpress": ["wp-content", "wordpress"],
    "facebook": ["facebook.com"],
}
INVALID_EMAIL_DOMAINS = {"domain.com", "latofonts.com", "g.jh"}
INVALID_EMAILS = {"user@domain.com"}
USER_AGENT = "Mozilla/5.0 (compatible; TieGuiLeadResearch/1.0; +https://tieguisolutions.com)"
SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=12, context=SSL_CONTEXT) as response:
        raw = response.read(300000)
        content_type = response.headers.get("Content-Type", "")
        charset = "utf-8"
        match = re.search(r"charset=([\w-]+)", content_type, re.I)
        if match:
            charset = match.group(1)
        try:
            html = raw.decode(charset, errors="ignore")
        except Exception:
            html = raw.decode("utf-8", errors="ignore")
        return response.geturl(), html


def clean_text(html):
    html = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    html = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.I)
    html = TAG_RE.sub(" ", html)
    html = unescape(html)
    return re.sub(r"\s+", " ", html).strip()


def extract_links(html, base_url):
    links = []
    for href in HREF_RE.findall(html or ""):
        href = unescape(href).strip()
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue
        links.append(urllib.parse.urljoin(base_url, href))
    deduped = []
    for link in links:
        if link not in deduped:
            deduped.append(link)
    return deduped


def analyze_site(url):
    if not url:
        return {
            "final_url": "",
            "email": "",
            "platforms": [],
            "title": "",
            "h1": "",
            "has_form": False,
            "has_tel": False,
            "cta_found": [],
            "local_terms_found": [],
            "word_count": 0,
            "error": "No website linked on Google Maps",
            "jobber_like": False,
            "contact_url": "",
            "status": "no_website",
        }

    base_url = url if url.startswith("http") else f"https://{url}"
    try:
        final_url, html = fetch(base_url)
    except Exception as exc:
        return {
            "final_url": base_url,
            "email": "",
            "platforms": [],
            "title": "",
            "h1": "",
            "has_form": False,
            "has_tel": False,
            "cta_found": [],
            "local_terms_found": [],
            "word_count": 0,
            "error": f"Fetch failed: {type(exc).__name__}",
            "jobber_like": False,
            "contact_url": "",
            "status": "fetch_failed",
        }

    original_host = urllib.parse.urlparse(base_url).netloc.replace("www.", "")
    final_host = urllib.parse.urlparse(final_url).netloc.replace("www.", "")
    redirected_off_domain = bool(original_host and final_host and original_host != final_host)

    text = clean_text(html)
    combined = f"{html} {text} {final_url}".lower()
    emails = {
        match
        for match in EMAIL_RE.findall(f"{html} {text}")
        if not match.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"))
    }
    title_match = TITLE_RE.search(html)
    h1_match = H1_RE.search(html)
    title = clean_text(title_match.group(1)) if title_match else ""
    h1 = clean_text(h1_match.group(1)) if h1_match else ""
    platforms = [name for name, needles in PLATFORM_MARKERS.items() if any(needle in combined for needle in needles)]
    jobber_like = any(name in platforms for name in ("jobber", "housecallpro"))
    cta_found = [term for term in CTA_TERMS if term in combined]
    local_terms_found = [term for term in LOCAL_TERMS if term in combined]
    has_form = "<form" in html.lower()
    has_tel = "tel:" in html.lower()
    contact_url = ""

    if not emails:
        base_host = urllib.parse.urlparse(final_url).netloc
        for link in extract_links(html, final_url):
            parsed = urllib.parse.urlparse(link)
            if parsed.scheme not in ("http", "https"):
                continue
            if parsed.netloc and parsed.netloc != base_host:
                continue
            path = (parsed.path or "").lower()
            if not any(key in path for key in ("contact", "about", "estimate", "quote")):
                continue
            try:
                linked_url, linked_html = fetch(link)
            except Exception:
                continue
            linked_text = clean_text(linked_html)
            contact_url = linked_url
            emails.update(EMAIL_RE.findall(f"{linked_html} {linked_text}"))
            has_form = has_form or ("<form" in linked_html.lower())
            has_tel = has_tel or ("tel:" in linked_html.lower())
            cta_found = sorted(set(cta_found + [term for term in CTA_TERMS if term in linked_html.lower() or term in linked_text.lower()]))
            local_terms_found = sorted(set(local_terms_found + [term for term in LOCAL_TERMS if term in linked_html.lower() or term in linked_text.lower()]))
            if emails:
                break
            time.sleep(0.2)

    email = ""
    for candidate in sorted(emails):
        lowered = candidate.lower()
        if any(bad in lowered for bad in ("example.com", "wix.com", "godaddy.com", "sentry.io")):
            continue
        if lowered in INVALID_EMAILS:
            continue
        domain = lowered.split("@")[-1]
        if domain in INVALID_EMAIL_DOMAINS:
            continue
        email = candidate
        break

    status = "ok"
    if "facebook.com" in final_url.lower():
        status = "social_only"
    elif "wixsite.com" in final_url.lower() or "wix" in platforms:
        status = "template_builder"
    elif "ueni" in platforms:
        status = "template_builder"
    elif redirected_off_domain:
        status = "redirected_off_domain"

    return {
        "final_url": final_url,
        "email": email,
        "platforms": platforms,
        "title": title,
        "h1": h1,
        "has_form": has_form,
        "has_tel": has_tel,
        "cta_found": sorted(set(cta_found)),
        "local_terms_found": sorted(set(local_terms_found)),
        "word_count": len(text.split()),
        "error": f"Redirects off-domain to {final_host}" if redirected_off_domain else "",
        "jobber_like": jobber_like,
        "contact_url": contact_url,
        "status": status,
    }


def google_gap(rating, reviews):
    notes = []
    if reviews == 0:
        notes.append("No Google review volume yet")
    elif reviews < 5:
        notes.append("Very thin Google review base")
    elif reviews < 15:
        notes.append("Review count still light for local search")
    elif reviews < 40:
        notes.append("Can grow review volume and recency")
    if 0 < rating < 4.2:
        notes.append("Rating/consistency issue on Google profile")
    elif 4.2 <= rating < 4.6:
        notes.append("Good enough reputation but still room to improve trust")
    if not notes:
        notes.append("Google profile looks active; website conversion is probably the bigger leak")
    return "; ".join(notes)


def website_gap(candidate, site):
    notes = []
    if not candidate["website"]:
        notes.append("No website linked from Google Maps")
    if site["status"] == "social_only":
        notes.append("Social-only web presence")
    if site["status"] == "template_builder":
        notes.append("Template-builder site that likely undersells the brand")
    if site["status"] == "redirected_off_domain":
        notes.append("Current domain redirects to an unrelated site")
    if site["error"] and candidate["website"]:
        notes.append("Website needs a technical/content audit")
    if candidate["website"] and not site["has_form"] and not any(term in site["cta_found"] for term in ("estimate", "quote", "book", "schedule", "request")):
        notes.append("No clear estimate/quote CTA above the fold")
    if candidate["website"] and not site["has_form"]:
        notes.append("No visible form capture detected")
    if candidate["website"] and not site["email"]:
        notes.append("No public email surfaced")
    if candidate["website"] and not site["local_terms_found"]:
        notes.append("Weak Tacoma/Pierce local SEO language")
    if candidate["website"] and site["word_count"] < 250:
        notes.append("Thin homepage copy")
    return "; ".join(notes[:4]) if notes else "Site has some demand proof but still needs a manual UX review"


def tiegui_angle(candidate, site):
    notes = []
    if not candidate["website"] or site["status"] in ("social_only", "template_builder"):
        notes.append("Rebuild the site into a mobile-first conversion homepage with service-area pages")
    if site["status"] == "redirected_off_domain":
        notes.append("Fix the broken domain and replace it with a real conversion site")
    if not site["has_form"] or not any(term in site["cta_found"] for term in ("estimate", "quote", "book", "schedule", "request")):
        notes.append("Install clear estimate CTA plus faster lead routing")
    notes.append("Add missed-call text-back and quote follow-up automation")
    if candidate["reviews"] < 15 or candidate["rating"] < 4.6 or candidate["reviews"] == 0:
        notes.append("Run review-request automation to improve Google trust")
    return "; ".join(notes[:3])


def fit_score(candidate, site):
    score = 0
    if candidate["reviews"] >= 5:
        score += 2
    if 0 < candidate["reviews"] < 60:
        score += 1
    if candidate["rating"] and candidate["rating"] < 4.6:
        score += 1
    if not candidate["website"]:
        score += 3
    if site["status"] == "redirected_off_domain":
        score += 3
    if site["status"] in ("social_only", "template_builder"):
        score += 2
    if candidate["website"] and not site["has_form"]:
        score += 1
    if candidate["website"] and not any(term in site["cta_found"] for term in ("estimate", "quote", "book", "schedule", "request")):
        score += 2
    if candidate["website"] and not site["local_terms_found"]:
        score += 1
    if site["jobber_like"]:
        score -= 5
    if candidate["reviews"] > 150 and candidate["rating"] >= 4.8:
        score -= 1
    return max(score, 1)


def build_rows():
    rows = []
    for candidate in CANDIDATES:
        site = analyze_site(candidate["website"])
        if site["jobber_like"]:
            continue
        record = dict(candidate)
        record.update(
            {
                "resolved_website": site["final_url"] or candidate["website"],
                "email": site["email"],
                "site_status": site["status"],
                "platforms": ", ".join(site["platforms"]),
                "fit_score": fit_score(candidate, site),
                "google_gap": google_gap(candidate["rating"], candidate["reviews"]),
                "website_gap": website_gap(candidate, site),
                "tiegui_angle": tiegui_angle(candidate, site),
                "title": site["title"],
                "h1": site["h1"],
                "cta_found": ", ".join(site["cta_found"]),
                "local_terms_found": ", ".join(site["local_terms_found"]),
                "contact_url": site["contact_url"],
                "error": site["error"],
            }
        )
        rows.append(record)
        time.sleep(0.25)
    rows.sort(key=lambda row: (-row["fit_score"], row["company"].lower()))
    return rows


def write_outputs(rows):
    fieldnames = [
        "company",
        "category",
        "rating",
        "reviews",
        "phone",
        "website",
        "resolved_website",
        "email",
        "site_status",
        "platforms",
        "fit_score",
        "google_gap",
        "website_gap",
        "tiegui_angle",
        "title",
        "h1",
        "cta_found",
        "local_terms_found",
        "contact_url",
        "error",
    ]
    with open(CSV_PATH, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    with open(MD_PATH, "w") as handle:
        handle.write("# Tacoma Landscaper Leads\n\n")
        handle.write("Source: Google Maps queries for Tacoma / Tacoma radius landscapers, lawn care, and landscape design on 2026-04-01.\n\n")
        handle.write("Sorted by fit score for TieGui based on website weakness plus Google opportunity.\n\n")
        handle.write("| Company | Rating | Reviews | Website | Email | Fit | Key Gaps |\n")
        handle.write("| --- | ---: | ---: | --- | --- | ---: | --- |\n")
        for row in rows[:25]:
            website = row["resolved_website"] or "No site linked"
            email = row["email"] or "Not found"
            gaps = f'{row["website_gap"]}; {row["google_gap"]}'.strip("; ")
            handle.write(f'| {row["company"]} | {row["rating"] or "NR"} | {row["reviews"]} | {website} | {email} | {row["fit_score"]} | {gaps[:180].replace("|", "/")} |\n')


def main():
    rows = build_rows()
    write_outputs(rows)
    print(f"wrote {len(rows)} leads")
    print(CSV_PATH)
    print(MD_PATH)
    print("top5:")
    for row in rows[:5]:
        print(f'- {row["company"]} | fit {row["fit_score"]} | {row["website_gap"]} | {row["google_gap"]}')


if __name__ == "__main__":
    main()
