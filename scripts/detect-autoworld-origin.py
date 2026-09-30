#!/usr/bin/env python3
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

SOURCE_PATH=Path(os.environ.get("SOURCE_PATH","data/autoworld-georgia/cars.json"))
LIMIT=int(os.environ.get("ORIGIN_SCAN_LIMIT","0"))
TIMEOUT=35
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

session=requests.Session()
session.headers.update({"User-Agent":UA,"Accept-Language":"ru,en;q=0.8"})

def clean(value):
    return re.sub(r"\s+"," ",str(value or "")).strip()

def detect_from_ocr_text(text):
    raw=clean(text).upper()
    compact=re.sub(r"[^A-ZА-ЯЁ0-9]+","",raw)
    if re.search(r"ГРУЗИ[ЯA]|ГРУ3И[ЯA]|ГРУЗИ|GRUZI|GEORGIA",compact):
        return "Грузия","ГРУЗИЯ"
    if re.search(r"(?:^|[^A-ZА-ЯЁ])США(?:$|[^A-ZА-ЯЁ])",raw) or "USA" in compact or "AMERICA" in compact or "АМЕРИК" in compact:
        return "США","США/USA"
    return "",""

def fallback_origin(row):
    raw=str(row.get("rawText") or "")
    if re.search(r"КОРЕ[ЯИ]",raw,re.I):
        return "Корея","text:Корея"
    if re.search(r"ЕВРОП",raw,re.I):
        return "Европа","text:Европа"
    if re.search(r"ПРИМЕР\s+РАСЧ[ЕЁ]ТА\s+США\s*/\s*ГРУЗ",raw,re.I):
        return "США / Грузия","text:США/Грузия"
    if clean(row.get("auctionDate")) or clean(row.get("lot")) or re.search(r"\bТОРГИ\b|BUY\s*NOW|РАСЧ[ЕЁ]ТНАЯ\s+СТАВКА",raw,re.I):
        return "США","text:auction"
    return "Грузия","text:no-auction"

def pick_image_url(row):
    for key in ("sourcePhotos","photos"):
        values=row.get(key) or []
        if isinstance(values,list):
            for url in values:
                if str(url).startswith("http"):
                    return str(url)
    return ""

def download_image(url):
    r=session.get(url,timeout=TIMEOUT)
    r.raise_for_status()
    return r.content

def variants(content):
    image=Image.open(io.BytesIO(content)).convert("RGB")
    max_side=max(image.size)
    if max_side<1800:
        scale=min(3.0,1800/max_side)
        image=image.resize((max(1,int(image.width*scale)),max(1,int(image.height*scale))))
    gray=ImageOps.grayscale(image)
    gray=ImageOps.autocontrast(gray)
    sharp=gray.filter(ImageFilter.SHARPEN)
    contrast=ImageEnhance.Contrast(sharp).enhance(1.7)
    yield contrast
    threshold=contrast.point(lambda p:255 if p>155 else 0)
    yield threshold
    # Banner text in AutoWorld images is often in the lower half of the first picture.
    lower=contrast.crop((0,int(contrast.height*.42),contrast.width,contrast.height))
    yield lower

def tesseract_text(image):
    with tempfile.NamedTemporaryFile(suffix=".png",delete=False) as fh:
        path=fh.name
    try:
        image.save(path,"PNG")
        result=subprocess.run(
            ["tesseract",path,"stdout","-l","rus+eng","--psm","11"],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=35,check=False
        )
        return result.stdout or ""
    finally:
        try: os.unlink(path)
        except OSError: pass

def scan_row(row):
    url=pick_image_url(row)
    if not url:
        origin,evidence=fallback_origin(row)
        return origin,{"method":"text-heuristic","evidence":evidence,"imageUrl":""}
    try:
        content=download_image(url)
        texts=[]
        for variant in variants(content):
            txt=tesseract_text(variant)
            texts.append(txt)
            origin,label=detect_from_ocr_text(txt)
            if origin:
                return origin,{"method":"image-ocr","evidence":label,"imageUrl":url,"ocr":clean(txt)[:320]}
        origin,evidence=fallback_origin(row)
        return origin,{"method":"text-heuristic","evidence":evidence,"imageUrl":url,"ocr":clean(" ".join(texts))[:320]}
    except Exception as exc:
        origin,evidence=fallback_origin(row)
        return origin,{"method":"text-heuristic","evidence":evidence,"imageUrl":url,"error":str(exc)[:220]}

def self_test():
    cases=[
        ("Г Р У З И Я до 160","Грузия"),
        ("ГРУЗИЯ","Грузия"),
        ("Georgia","Грузия"),
        ("USA auction","США"),
        ("США","США"),
    ]
    for text,expected in cases:
        got,_=detect_from_ocr_text(text)
        assert got==expected,(text,got,expected)
    print("AUTOWORLD_ORIGIN_SELF_TEST_OK")

def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    rows=json.loads(SOURCE_PATH.read_text("utf-8"))
    if not isinstance(rows,list):
        raise RuntimeError("source_not_array")
    ordered=sorted(rows,key=lambda x:int(str(x.get("sourcePostId") or "0")),reverse=True)
    scanned=0
    image_ocr=0
    heuristic=0
    changed=0
    counts={}
    for row in ordered:
        if LIMIT and scanned>=LIMIT:
            break
        existing=clean(row.get("origin"))
        detection=row.get("originDetection") or {}
        # Do not OCR again when the image has already supplied the location.
        if existing in {"США","Грузия"} and detection.get("method") in {"image-ocr","custom-emoji-sequence"}:
            counts[existing]=counts.get(existing,0)+1
            continue
        origin,meta=scan_row(row)
        old=clean(row.get("origin"))
        row["origin"]=origin
        row["originDetection"]=meta
        if old!=origin:
            changed+=1
        scanned+=1
        counts[origin]=counts.get(origin,0)+1
        if meta.get("method")=="image-ocr":
            image_ocr+=1
        else:
            heuristic+=1
        print(f"origin {scanned}: post={row.get('sourcePostId')} origin={origin} method={meta.get('method')}",flush=True)

    SOURCE_PATH.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+"\n","utf-8")
    report={
        "generatedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
        "rows":len(rows),
        "scannedThisRun":scanned,
        "changed":changed,
        "imageOcr":image_ocr,
        "textHeuristic":heuristic,
        "originCounts":counts
    }
    report_path=SOURCE_PATH.with_name("origin-report.json")
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n","utf-8")
    print("AUTOWORLD_ORIGIN_BACKFILL_OK",json.dumps(report,ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()
