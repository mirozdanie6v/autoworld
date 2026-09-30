#!/usr/bin/env python3
import base64
import csv
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

CHANNEL = "AutoWorld_Georgia"
START_BEFORE = os.environ.get("START_BEFORE", "").strip()
START_AFTER = os.environ.get("START_AFTER", "").strip()
if START_AFTER:
    START_URL = f"https://t.me/s/{CHANNEL}?after={START_AFTER}"
elif START_BEFORE:
    START_URL = f"https://t.me/s/{CHANNEL}?before={START_BEFORE}"
else:
    START_URL = f"https://t.me/s/{CHANNEL}"
MEDIA_API = os.environ.get("AUTO_SALE_MEDIA_API", "https://auto-sale-demo.viiversion.com/api/auto-sale/media")
OUT_DIR = Path(os.environ.get("OUT_DIR", "data/autoworld-georgia"))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "260"))
ONLY_POST_IDS = {x.strip() for x in os.environ.get("ONLY_POST_IDS", "").split(",") if x.strip()}
REQUEST_DELAY = float(os.environ.get("REQUEST_DELAY", "0.20"))
MEDIA_INDEX_PATH = os.environ.get("MEDIA_INDEX_PATH", "").strip()
UPLOAD_MISSING_PHOTOS = os.environ.get("UPLOAD_MISSING_PHOTOS", "true").lower() in {"1","true","yes"}
MERGE_EXISTING = os.environ.get("MERGE_EXISTING", "false").lower() in {"1","true","yes"}
TIMEOUT = 40
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "ru,en;q=0.8"})

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")
MONEY_RE = re.compile(r"([0-9]+(?:[.,][0-9]+)?)")

GEORGIA_MARKER_IDS = [
    "5470042538272385378","5469637046115002486","5469756377486353033",
    "5469831380500245288","5469742856929308893","5469731127373620510"
]
USA_MARKER_IDS = [
    "5330198729532144649","5330405661056465376","5330305442289577204",
    "5330171795792230870","5339094096428429945","5330117086498813131",
    "5330068338620002952"
]

def custom_emoji_ids(message):
    node = message.select_one(".tgme_widget_message_text")
    if node is None:
        return []
    return [str(x.get("emoji-id")) for x in node.select("tg-emoji[emoji-id]") if x.get("emoji-id")]

def contains_sequence(values, sequence):
    if not values or not sequence or len(values) < len(sequence):
        return False
    width = len(sequence)
    return any(values[i:i+width] == sequence for i in range(0, len(values)-width+1))

def origin_from_custom_emoji(ids):
    if contains_sequence(ids, GEORGIA_MARKER_IDS):
        return "Грузия", {"method":"custom-emoji-sequence","evidence":"ГРУЗИЯ"}
    if contains_sequence(ids, USA_MARKER_IDS):
        return "США", {"method":"custom-emoji-sequence","evidence":"USA/America"}
    return "", {}

def clean_text(node):
    if node is None:
        return ""
    text = node.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()

def photo_urls(message):
    out = []
    for el in message.select(".tgme_widget_message_photo_wrap, .tgme_widget_message_photo, .grouped_media_wrap"):
        style = el.get("style", "")
        for url in re.findall(r'background-image:\s*url\(["\']?([^"\')]+)', style):
            url = html.unescape(url)
            if url.startswith("//"):
                url = "https:" + url
            if url.startswith("http") and url not in out:
                out.append(url)
    for img in message.select("img[src]"):
        url = img.get("src", "")
        if "telesco.pe/file/" in url and url not in out:
            out.append(url)
    return out

def first_match(patterns, text, flags=re.I):
    for p in patterns:
        m = re.search(p, text, flags)
        if m:
            return m.group(1).strip()
    return ""

def num_value(value):
    if not value:
        return None
    m = MONEY_RE.search(value.replace(" ", ""))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "."))
    except Exception:
        return None

def parse_rub(text, label):
    if label == "price":
        patterns = [
            r"Цена[^\n]{0,80}?([0-9]+(?:[.,][0-9]+)?)\s*млн",
            r"([0-9]+(?:[.,][0-9]+)?)\s*млн\.?\s*руб",
        ]
        for p in patterns:
            m = re.search(p, text, re.I | re.S)
            if m:
                return int(float(m.group(1).replace(",", ".")) * 1_000_000)
    else:
        patterns = [
            r"таможенн[^\n]{0,90}?([0-9]+(?:[.,][0-9]+)?)\s*тыс",
            r"таможенн[^\n]{0,90}?([0-9]+(?:[.,][0-9]+)?)\s*млн",
        ]
        for i, p in enumerate(patterns):
            m = re.search(p, text, re.I | re.S)
            if m:
                v = float(m.group(1).replace(",", "."))
                return int(v * (1_000 if i == 0 else 1_000_000))
    return None

KEYCAP_PRICE_RE = re.compile(
    r"([0-9])️⃣\s*\n\s*🤩\s*\n\s*([0-9])️⃣\s*\n\s*([0-9])️⃣\s*\n\s*🔤\s*\n\s*🔤\s*\n\s*🔤",
    re.U,
)

def parse_discount_rub(text):
    """Decode the channel's custom-emoji price such as 1️⃣ 🤩 7️⃣ 2️⃣ 🔤🔤🔤 => 1.72M RUB."""
    m = KEYCAP_PRICE_RE.search(str(text or ""))
    if m:
        return int(m.group(1) + m.group(2) + m.group(3)) * 10_000

    # Fallback for posts where the promotional price is plain text.
    for p in [
        r"(?:скидк|акци|горячая\s+цена|торопитесь)[^\d]{0,80}([0-9]+(?:[.,][0-9]+)?)\s*млн",
        r"(?:теперь|сейчас|итого)[^\d]{0,40}([0-9]+(?:[.,][0-9]+)?)\s*млн",
    ]:
        m = re.search(p, str(text or ""), re.I | re.S)
        if m:
            return int(float(m.group(1).replace(",", ".")) * 1_000_000)
    return None

def parse_price_pair(text):
    visible = parse_rub(text, "price")
    promo = parse_discount_rub(text)
    before = None
    current = promo or visible
    if visible and promo and visible > promo:
        before = visible
        current = promo
    return before, current, promo

def parse_title(text):
    lines = [x.strip(" -*•🌟✨") for x in text.splitlines() if x.strip()]
    candidates = []
    for line in lines[:12]:
        if re.search(r"(?:0[1-9]|1[0-2])[/.-](?:20)?\d{2}", line) or re.search(r"\b20\d{2}\b", line):
            candidates.append(line)
    title = candidates[0] if candidates else (lines[0] if lines else "")
    title = re.sub(r"^[^A-Za-zА-Яа-я0-9]+", "", title).strip()
    date_m = re.search(r"\b(0?[1-9]|1[0-2])[/.-](20)?(\d{2})\s*г?\.?", title)
    year = None
    model_part = title
    if date_m:
        year = 2000 + int(date_m.group(3))
        model_part = title[:date_m.start()].strip(" -–—")
    else:
        y = re.search(r"\b(20\d{2})\b", title)
        if y:
            year = int(y.group(1))
            model_part = title[:y.start()].strip(" -–—")
    tokens = model_part.split()
    brand = tokens[0] if tokens else ""
    model = " ".join(tokens[1:]) if len(tokens) > 1 else ""
    return title, brand, model, year

def looks_like_car(text):
    score = 0
    for token in ["Пробег", "Двигатель", "Привод", "Коробка", "Торги", "Цена", "комплектация", "VIN", "Повреждения"]:
        if token.lower() in text.lower():
            score += 1
    return score >= 3 and bool(re.search(r"\b20\d{2}\b|\b(?:0[1-9]|1[0-2])[/.-](?:20)?\d{2}(?:\s*г\.?)?", text, re.I))

def parse_car(post_id, source_url, text, photos, published_at, emoji_ids=None):
    title, brand, model, year = parse_title(text)
    vin_m = VIN_RE.search(text)
    vin = vin_m.group(0) if vin_m else ""
    if not vin:
        bid = re.search(r"bid\.cars/[^\s]+-([A-HJ-NPR-Z0-9]{17})(?:\b|/)", text, re.I)
        vin = bid.group(1).upper() if bid else ""

    estimated = None
    for p in [r"(?:расчетная|расчётная)\s+ставка[^\d]{0,20}([0-9][0-9\s]*)", r"\+[-–]?\s*([0-9][0-9\s]{3,})\s*(?:\$|\()", r"ставка[^\d]{0,10}([0-9][0-9\s]{3,})"]:
        m = re.search(p, text, re.I)
        if m:
            try:
                estimated = int(re.sub(r"\D", "", m.group(1)))
            except Exception:
                pass
            if estimated:
                break

    auction_date = first_match([
        r"Торги\s*[:\-]?\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})",
        r"Торги\s*[:\-]?\s*(\d{1,2}[./]\d{1,2})",
    ], text)
    calc_date = first_match([r"расч[её]т\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})"], text)

    lot = first_match([
        r"(?:лот|Lot|🔎)[^0-9]{0,12}(\d{6,12})",
        r"bid\.cars/[^/]+/(?:\d+-)?([0-9]{6,12})/",
    ], text)

    detected_origin, origin_detection = origin_from_custom_emoji(emoji_ids or [])
    price_before_discount, price_current, price_after_discount = parse_price_pair(text)
    return {
        "source": "AutoWorld_Georgia",
        "sourcePostId": str(post_id),
        "sourceUrl": source_url,
        "publishedAt": published_at,
        "rawText": text,
        "customEmojiIds": emoji_ids or [],
        "origin": detected_origin,
        "originDetection": origin_detection,
        "title": title,
        "brand": brand,
        "model": model,
        "year": year,
        "trim": first_match([r"комплектация\s*[:\-]?\s*([^\n]+)"], text),
        "mileage": first_match([r"Пробег\s*[:\-]?\s*([^\n]+)"], text),
        "engine": first_match([r"Двигатель\s*[:\-]?\s*([^\n]+)"], text),
        "powerHp": num_value(first_match([r"(\d+(?:[.,]\d+)?)\s*(?:HP|л\.?с\.?)"], text)),
        "consumption": first_match([r"Расход\s*[:\-]?\s*([^\n]+)"], text),
        "transmission": first_match([r"Коробка\s*[:\-]?\s*([^\n]+)"], text),
        "drive": first_match([r"Привод\s*[:\-]?\s*([^\n]+)"], text),
        "safety": first_match([r"Безопасность\s*[:\-]?\s*([^\n]+)"], text),
        "interior": first_match([r"Салон\s*[:\-]?\s*([^\n]+)"], text),
        "damage": first_match([r"Повреждения?\s*[:\-]?\s*([^\n]+)"], text),
        "vin": vin,
        "auctionDate": auction_date,
        "estimatedBidUsd": estimated,
        "priceBeforeDiscountRub": price_before_discount,
        "priceAfterDiscountRub": price_after_discount,
        "priceRub": price_current,
        "customsRub": parse_rub(text, "customs"),
        "lot": lot,
        "calculationDate": calc_date,
        "sourcePhotos": photos,
        "photos": [],
    }

def fetch_page(url):
    r = session.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text

def scrape_all():
    url = START_URL
    seen_pages = set()
    seen_posts = set()
    cars = []
    page_count = 0
    while url and page_count < MAX_PAGES:
        if url in seen_pages:
            break
        seen_pages.add(url)
        raw = fetch_page(url)
        soup = BeautifulSoup(raw, "html.parser")
        messages = soup.select(".tgme_widget_message")
        page_new = 0
        for msg in messages:
            data_post = msg.get("data-post", "")
            if "/" not in data_post:
                continue
            post_id = data_post.rsplit("/", 1)[-1]
            if post_id in seen_posts:
                continue
            seen_posts.add(post_id)
            if ONLY_POST_IDS and post_id not in ONLY_POST_IDS:
                continue
            text_node = msg.select_one(".tgme_widget_message_text")
            text = clean_text(text_node)
            if not text or not looks_like_car(text):
                continue
            date = msg.select_one("time[datetime]")
            published_at = date.get("datetime", "") if date else ""
            source_url = f"https://t.me/{CHANNEL}/{post_id}"
            photos = photo_urls(msg)
            emoji_ids = custom_emoji_ids(msg)
            cars.append(parse_car(post_id, source_url, text, photos, published_at, emoji_ids))
            page_new += 1
        page_count += 1
        if ONLY_POST_IDS and ONLY_POST_IDS.issubset({x["sourcePostId"] for x in cars}):
            break
        prev = soup.select_one('link[rel="prev"]')
        if not prev:
            prev = soup.select_one(".tme_messages_more[href*='before=']")
        next_href = prev.get("href", "") if prev else ""
        if not next_href:
            break
        url = urljoin("https://t.me", next_href)
        print(f"page={page_count} cars={len(cars)} next={url}", flush=True)
        time.sleep(REQUEST_DELAY)
    cars.sort(key=lambda x: int(x["sourcePostId"]))
    if ONLY_POST_IDS:
        missing = sorted(ONLY_POST_IDS - {x["sourcePostId"] for x in cars}, key=int)
        if missing:
            raise RuntimeError(f"target_posts_not_found: {','.join(missing)}")
    return cars, page_count

def existing_rows():
    p = OUT_DIR / "cars.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text("utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []

def existing_manifest():
    return {str(x.get("sourcePostId")): x for x in existing_rows() if x.get("sourcePostId")}

def download_photo(url):
    r = session.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    content_type = r.headers.get("content-type", "image/jpeg").split(";")[0]
    return r.content, content_type

def upload_photo(post_id, index, url):
    body, content_type = download_photo(url)
    if len(body) > 2_000_000:
        print(f"skip >2MB photo post={post_id} index={index} bytes={len(body)}")
        return ""
    ext = "jpg"
    if "png" in content_type:
        ext = "png"
    elif "webp" in content_type:
        ext = "webp"
    data_url = f"data:{content_type};base64," + base64.b64encode(body).decode("ascii")
    category = "main" if index == 0 else "other"
    payload = {
        "carId": f"autoworld-{post_id}",
        "category": category,
        "dataUrl": data_url,
        "fileName": f"{category}-{index+1}.{ext}",
    }
    r = session.post(MEDIA_API, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    return data.get("url", "")

def media_index():
    if not MEDIA_INDEX_PATH:
        return {}
    p = Path(MEDIA_INDEX_PATH)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text("utf-8"))
        return {str(k): [x for x in v if str(x).startswith("https://storage.yandexcloud.net/")] for k, v in data.items()}
    except Exception:
        return {}

def enrich_photos(cars):
    existing = existing_manifest()
    recovered = media_index()
    uploaded_count = 0
    reused_count = 0
    recovered_cars = 0
    failed = []
    limit = int(os.environ.get("MAX_PHOTOS_PER_CAR", "10"))
    for n, car in enumerate(cars, 1):
        old = existing.get(car["sourcePostId"], {})
        old_photos = [x for x in old.get("photos", []) if str(x).startswith("https://storage.yandexcloud.net/")]
        indexed_photos = recovered.get(car["sourcePostId"], [])[:limit]
        if old_photos:
            car["photos"] = old_photos[:limit]
            reused_count += len(car["photos"])
            recovered_cars += 1
            continue
        if indexed_photos:
            car["photos"] = indexed_photos
            reused_count += len(indexed_photos)
            recovered_cars += 1
            print(f"photos {n}/{len(cars)} post={car['sourcePostId']} reused={len(indexed_photos)}", flush=True)
            continue
        if not UPLOAD_MISSING_PHOTOS:
            car["photos"] = []
            failed.append({"post": car["sourcePostId"], "photo": None, "url": "", "error": "no_recovered_media"})
            continue
        urls = car.get("sourcePhotos", [])[:limit]
        photos = []
        for i, url in enumerate(urls):
            try:
                uploaded = upload_photo(car["sourcePostId"], i, url)
                if uploaded:
                    photos.append(uploaded)
                    uploaded_count += 1
            except Exception as e:
                failed.append({"post": car["sourcePostId"], "photo": i, "url": url, "error": str(e)})
        car["photos"] = photos
        print(f"photos {n}/{len(cars)} post={car['sourcePostId']} uploaded={len(photos)}", flush=True)
    return uploaded_count, reused_count, recovered_cars, failed

def merge_existing_cars(cars):
    if not MERGE_EXISTING:
        return cars, 0, len(cars)
    previous = existing_rows()
    merged = {str(x.get("sourcePostId")): x for x in previous if x.get("sourcePostId")}
    changed = 0
    for car in cars:
        key = str(car.get("sourcePostId") or "")
        if not key:
            continue
        if merged.get(key) != car:
            changed += 1
        merged[key] = car
    rows = sorted(merged.values(), key=lambda x: int(str(x.get("sourcePostId") or "0")))
    return rows, len(previous), changed

def write_outputs(cars, pages, uploaded_count, reused_count, recovered_cars, failed, previous_count=0, changed_count=0):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cars.json").write_text(json.dumps(cars, ensure_ascii=False, indent=2), "utf-8")
    fields = [
        "sourcePostId","sourceUrl","publishedAt","origin","brand","model","year","trim","mileage","engine","powerHp",
        "consumption","transmission","drive","safety","interior","damage","vin","auctionDate","estimatedBidUsd",
        "priceBeforeDiscountRub","priceAfterDiscountRub","priceRub","customsRub","lot","calculationDate","photos","rawText"
    ]
    with (OUT_DIR / "cars.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for car in cars:
            row = dict(car)
            row["photos"] = " | ".join(car.get("photos", []))
            w.writerow(row)
    with (OUT_DIR / "posts.txt").open("w", encoding="utf-8") as fh:
        for car in cars:
            fh.write(f"===== {car['sourcePostId']} | {car['sourceUrl']} =====\n")
            fh.write(car["rawText"].strip() + "\n\n")
    report = {
        "channel": CHANNEL,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pagesScraped": pages,
        "carsFound": len(cars),
        "previousCars": previous_count,
        "changedOrNewCars": changed_count,
        "mergeExisting": MERGE_EXISTING,
        "photosUploaded": uploaded_count,
        "photosReused": reused_count,
        "carsWithRecoveredPhotos": recovered_cars,
        "photoFailures": len(failed),
        "failures": failed[:100],
    }
    (OUT_DIR / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps(report, ensure_ascii=False), flush=True)

def main():
    cars, pages = scrape_all()
    uploaded_count, reused_count, recovered_cars, failed = enrich_photos(cars)
    cars, previous_count, changed_count = merge_existing_cars(cars)
    write_outputs(cars, pages, uploaded_count, reused_count, recovered_cars, failed, previous_count, changed_count)
    if not cars:
        print("No car posts found", file=sys.stderr)
        sys.exit(2)

if __name__ == "__main__":
    main()
