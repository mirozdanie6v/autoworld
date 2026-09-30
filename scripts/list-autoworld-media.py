#!/usr/bin/env python3
import json
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime

import requests

BUCKET=os.environ.get("MEDIA_BUCKET","viiversion-auto-sale-media")
TOKEN=os.environ.get("YC_IAM_TOKEN","")
OUT=os.environ.get("MEDIA_INDEX_OUT","data/autoworld-georgia/media-index.json")
PREFIX=os.environ.get("MEDIA_PREFIX","cars/autoworld-")

if not TOKEN:
    print("YC_IAM_TOKEN missing",file=sys.stderr)
    sys.exit(2)

session=requests.Session()
session.headers.update({"Authorization":f"Bearer {TOKEN}"})
base=f"https://storage.yandexcloud.net/{BUCKET}/"

def parse_slot(key):
    m=re.match(r"cars/autoworld-(\d+)/(main|other)-\d+-(main|other)-(\d+)-[^/]+\.(?:jpg|jpeg|png|webp)$",key,re.I)
    if not m:
        return None
    post=m.group(1)
    logical=("main",1) if m.group(2).lower()=="main" else ("other",int(m.group(4)))
    return post,logical

items=defaultdict(dict)
token=""
pages=0
objects=0
while True:
    params={"list-type":"2","prefix":PREFIX,"max-keys":"1000"}
    if token: params["continuation-token"]=token
    r=session.get(base,params=params,timeout=60)
    r.raise_for_status()
    root=ET.fromstring(r.text)
    ns={"s3":"http://s3.amazonaws.com/doc/2006-03-01/"}
    for content in root.findall("s3:Contents",ns):
        key=content.findtext("s3:Key",default="",namespaces=ns)
        parsed=parse_slot(key)
        if not parsed: continue
        post,slot=parsed
        modified=content.findtext("s3:LastModified",default="",namespaces=ns)
        size=int(content.findtext("s3:Size",default="0",namespaces=ns) or 0)
        record={"key":key,"lastModified":modified,"size":size}
        prev=items[post].get(slot)
        if not prev or modified>prev["lastModified"]:
            items[post][slot]=record
        objects+=1
    pages+=1
    truncated=(root.findtext("s3:IsTruncated",default="false",namespaces=ns).lower()=="true")
    token=root.findtext("s3:NextContinuationToken",default="",namespaces=ns)
    if not truncated or not token: break

index={}
stats={"pages":pages,"objectsSeen":objects,"posts":0,"selectedObjects":0,"duplicateObjectsDiscarded":0}
selected=0
for post,slots in items.items():
    ordered=[]
    main=slots.get(("main",1))
    if main: ordered.append(main)
    for slot,record in sorted(slots.items(),key=lambda x:(0 if x[0][0]=="main" else 1,x[0][1])):
        if slot==("main",1): continue
        ordered.append(record)
    urls=[base+urllib.parse.quote(x["key"],safe="/") for x in ordered]
    if urls:
        index[post]=urls
        selected+=len(urls)
stats["posts"]=len(index)
stats["selectedObjects"]=selected
stats["duplicateObjectsDiscarded"]=max(0,objects-selected)

os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,"w",encoding="utf-8") as f:
    json.dump(index,f,ensure_ascii=False,indent=2)
with open(os.path.splitext(OUT)[0]+"-report.json","w",encoding="utf-8") as f:
    json.dump(stats,f,ensure_ascii=False,indent=2)
print("AUTOWORLD_MEDIA_INDEX_OK",json.dumps(stats,ensure_ascii=False))
