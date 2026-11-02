#!/usr/bin/env python3
"""Add missing Telegram pictures to existing AWG galleries, without touching other fields.

Default mode is read-only. Apply requires both --apply and an explicit target scope.
The canonical catalog import endpoint receives patches containing ONLY id and otherPhotos.
"""
import argparse
import base64
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

SOURCE = "AutoWorld_Georgia"
STATE_URL = "https://awgcars.ru/api/auto-sale/state"
IMPORT_URL = "https://awgcars.ru/api/auto-sale/admin/catalog-import"
MEDIA_URL = "https://awgcars.ru/api/auto-sale/media"
MEDIA_PREFIX = "https://storage.yandexcloud.net/"
VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")
INDEX_RE = re.compile(r"-(?:main|other)-(\d+)-[0-9a-f]{8}\.(?:jpg|jpeg|png|webp)$", re.I)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

def pictures(message):
    out = []
    for node in message.select(".tgme_widget_message_photo_wrap, .tgme_widget_message_photo, .grouped_media_wrap"):
        style = node.get("style", "")
        for url in re.findall(r'background-image:\s*url\(["\x27]?([^"\x27)]+)', style):
            if url.startswith("//"):
                url = "https:" + url
            if url.startswith("https://") and url not in out:
                out.append(url)
    return out

def lookup_source(car):
    post = str(car["sourcePostId"])
    url = "https://t.me/s/" + SOURCE + "?before=" + str(int(post) + 1)
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    message = soup.select_one('[data-post="' + SOURCE + '/' + post + '"]')
    if message is None:
        raise ValueError("source_post_missing")
    text = message.select_one(".tgme_widget_message_text")
    raw = text.get_text("\n", strip=True) if text else ""
    source_vins = set(VIN_RE.findall(raw.upper()))
    vin = str(car.get("vin") or "").upper()
    if len(source_vins) > 1 or (source_vins and vin and vin not in source_vins):
        raise ValueError("source_vin_ambiguous_or_mismatch")
    photos = pictures(message)
    if not 1 <= len(photos) <= 10:
        raise ValueError("source_photo_count_out_of_range:" + str(len(photos)))
    return photos

def build_plan(car, source_photos):
    """Safely infer existing photo positions from importer-generated immutable names."""
    post = str(car.get("sourcePostId") or "")
    car_id = str(car.get("id") or "")
    if car.get("source") != SOURCE or car_id != "AWG-" + post or not post.isdigit():
        raise ValueError("source_identity_invalid")
    if not isinstance(car.get("otherPhotos", []), list):
        raise ValueError("other_photos_not_list")
    existing = [car.get("image")] + list(car.get("otherPhotos") or [])
    if not existing[0]:
        raise ValueError("missing_main_photo_do_not_replace")
    by_position = {}
    for photo in existing:
        if not isinstance(photo, str) or not photo.startswith(MEDIA_PREFIX):
            raise ValueError("noncanonical_existing_photo")
        parsed = urlparse(photo)
        if "/cars/autoworld-" + post + "/" not in parsed.path:
            raise ValueError("existing_photo_belongs_to_another_post")
        match = INDEX_RE.search(parsed.path.rsplit("/", 1)[-1])
        if not match:
            raise ValueError("existing_photo_index_ambiguous")
        index = int(match.group(1))
        if index < 1 or index in by_position:
            raise ValueError("existing_photo_index_duplicate_or_invalid")
        by_position[index] = photo
    if 1 not in by_position or by_position[1] != car["image"]:
        raise ValueError("existing_main_index_mismatch")
    if len(existing) > len(source_photos):
        return {"id": car_id, "post": post, "status": "already_more_than_source", "missing": []}
    if max(by_position) > len(source_photos):
        raise ValueError("existing_photo_index_exceeds_source")
    missing = [index for index in range(1, len(source_photos) + 1) if index not in by_position]
    return {"id": car_id, "post": post, "status": "needs_photos" if missing else "complete",
            "missing": missing, "existing": by_position, "sourcePhotos": source_photos}

def fetch_state():
    r = requests.get(STATE_URL, timeout=40)
    r.raise_for_status()
    data = r.json()
    return {str(c["id"]): c for c in data.get("catalog", []) if c.get("source") == SOURCE}

def media_identity(car):
    return (str(car.get("id")), str(car.get("sourcePostId")), str(car.get("vin") or ""),
            bool(car.get("active", True)), car.get("image"), tuple(car.get("otherPhotos") or []),
            tuple(car.get("interiorPhotos") or []))

def upload_missing(post, index, source_url, token):
    r = requests.get(source_url, headers={"User-Agent": UA}, timeout=40)
    r.raise_for_status()
    content = r.content
    mime = r.headers.get("content-type", "").split(";")[0].lower()
    if mime not in ("image/jpeg", "image/png", "image/webp") or not 100 <= len(content) <= 2_000_000:
        raise ValueError("source_image_invalid_type_or_size")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime]
    category = "main" if index == 1 else "other"
    body = {"carId": "autoworld-" + post, "category": category,
            "dataUrl": "data:" + mime + ";base64," + base64.b64encode(content).decode("ascii"),
            "fileName": category + "-" + str(index) + "." + ext}
    response = requests.post(MEDIA_URL, json=body,
                             headers={"Authorization": "Bearer " + token}, timeout=60)
    response.raise_for_status()
    data = response.json()
    url = str(data.get("url") or "")
    if not url.startswith(MEDIA_PREFIX) or "/cars/autoworld-" + post + "/" not in urlparse(url).path:
        raise ValueError("upload_media_url_invalid")
    probe = requests.head(url, allow_redirects=True, timeout=25)
    probe.raise_for_status()
    if not probe.headers.get("content-type", "").lower().startswith("image/"):
        raise ValueError("uploaded_media_not_image")
    return url

def save(path, data):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def run(args):
    if args.apply and (args.scope not in ("pilot", "all") or not os.environ.get("AUTO_SALE_CATALOG_IMPORT_BEARER")):
        raise ValueError("apply_requires_explicit_scope_and_oidc")
    originals = fetch_state()
    selected = sorted(originals.values(), key=lambda x: int(x.get("sourcePostId") or 0))
    pilot = {"4394", "4381", "4370"}
    if args.scope == "pilot":
        selected = [c for c in selected if str(c.get("sourcePostId")) in pilot]
        if len(selected) != 3:
            raise ValueError("pilot_cars_missing")
    if len(selected) < 1 or len(selected) > 300:
        raise ValueError("unsafe_catalog_scope")
    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "scope": args.scope,
              "apply": args.apply, "catalogCars": len(originals), "inspected": len(selected),
              "needsRepair": 0, "missingPhotos": 0, "patched": [], "skipped": [],
              "failures": []}
    backups = []
    save(args.report, report)
    save(args.backup, {"source": SOURCE, "cars": []})
    plans = []
    with ThreadPoolExecutor(max_workers=5) as workers:
        tasks = {workers.submit(lookup_source, car): car for car in selected}
        for future in as_completed(tasks):
            car = tasks[future]
            try:
                plan = build_plan(car, future.result())
                plans.append((car, plan))
                if plan["missing"]:
                    report["needsRepair"] += 1
                    report["missingPhotos"] += len(plan["missing"])
                else:
                    report["skipped"].append({"id": car["id"], "reason": plan["status"]})
            except Exception as exc:
                report["failures"].append({"id": car["id"], "reason": str(exc)[:160]})
    print("AWG_GALLERY_PREFLIGHT", json.dumps({k: report[k] for k in
          ("inspected", "needsRepair", "missingPhotos", "failures")}, ensure_ascii=False), flush=True)
    save(args.report, report)
    if not args.apply:
        return report
    if report["failures"] and args.scope == "pilot":
        raise RuntimeError("pilot_preflight_failed")
    if report["missingPhotos"] > 1000 or report["needsRepair"] > 200:
        raise ValueError("repair_scope_exceeds_guard")
    token = os.environ["AUTO_SALE_CATALOG_IMPORT_BEARER"]
    for old_car, plan in sorted(plans, key=lambda x: int(x[1]["post"])):
        if not plan["missing"]:
            continue
        car_id = plan["id"]
        # Do not replace a gallery touched by a manager or another importer.
        live_car = fetch_state().get(car_id)
        if not live_car or media_identity(live_car) != media_identity(old_car):
            report["skipped"].append({"id": car_id, "reason": "concurrent_edit_before_upload"})
            continue
        merged = dict(plan["existing"])
        try:
            for index in plan["missing"]:
                merged[index] = upload_missing(plan["post"], index,
                                               plan["sourcePhotos"][index - 1], token)
            expected = [merged[i] for i in range(1, len(plan["sourcePhotos"]) + 1)]
            if expected[0] != old_car["image"] or len(set(expected)) != len(expected):
                raise ValueError("gallery_main_or_duplicate_error")
            # Save the exact pre-update gallery for targeted rollback before any catalog mutation.
            backups.append({"id": car_id, "sourcePostId": old_car["sourcePostId"],
                            "vin": old_car.get("vin"), "image": old_car["image"],
                            "otherPhotos": old_car.get("otherPhotos") or []})
            save(args.backup, {"source": SOURCE, "cars": backups})
            current = fetch_state().get(car_id)
            if not current or media_identity(current) != media_identity(old_car):
                report["skipped"].append({"id": car_id, "reason": "concurrent_edit_before_patch"})
                continue
            # Exact existing ID only, no VIN, price, sourcePostId, active, orders or manager fields.
            payload = {"source": SOURCE, "replaceSourceAll": False,
                       "items": [{"id": car_id, "otherPhotos": expected[1:]}]}
            response = requests.post(IMPORT_URL, json=payload,
                                     headers={"Authorization": "Bearer " + token}, timeout=70)
            response.raise_for_status()
            outcome = response.json()
            if not outcome.get("ok") or outcome.get("created") or outcome.get("deleted") or outcome.get("replaced") or outcome.get("patched") != 1:
                raise RuntimeError("unexpected_catalog_import_result")
            updated = fetch_state().get(car_id)
            if not updated or updated.get("image") != old_car.get("image") or updated.get("otherPhotos") != expected[1:]:
                raise RuntimeError("post_import_gallery_verification_failed")
            original_untouched = {k: v for k, v in old_car.items() if k != "otherPhotos"}
            updated_untouched = {k: v for k, v in updated.items() if k != "otherPhotos"}
            if original_untouched != updated_untouched:
                raise RuntimeError("post_import_non_media_field_changed")
            report["patched"].append({"id": car_id, "post": plan["post"],
                                      "before": len(plan["existing"]), "after": len(expected),
                                      "uploaded": len(plan["missing"])})
            print("AWG_GALLERY_PATCHED", json.dumps(report["patched"][-1]), flush=True)
        except Exception as exc:
            report["failures"].append({"id": car_id, "reason": str(exc)[:160]})
            # Stop on first failed write; no bulk collateral edits.
            save(args.report, report)
            raise
        save(args.report, report)
    return report

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="Upload and patch only with OIDC authorization")
    p.add_argument("--scope", choices=("pilot", "all"), default="pilot")
    p.add_argument("--report", default="/tmp/awg-gallery/report.json")
    p.add_argument("--backup", default="/tmp/awg-gallery/media-backup.json")
    args = p.parse_args()
    report = run(args)
    print("AWG_GALLERY_RESULT", json.dumps({k: report[k] for k in
          ("catalogCars", "inspected", "needsRepair", "missingPhotos", "patched", "failures")},
          ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
