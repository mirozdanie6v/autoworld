#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

PATH=Path("data/autoworld-georgia/cars.json")
MAX_COMMITS=40

def load_bytes(blob):
    try:
        data=json.loads(blob.decode("utf-8"))
        return data if isinstance(data,list) else []
    except Exception:
        return []

def main():
    current=load_bytes(PATH.read_bytes()) if PATH.exists() else []
    merged={str(x.get("sourcePostId")):x for x in current if x.get("sourcePostId")}
    before=len(merged)
    result=subprocess.run(
        ["git","log",f"-n{MAX_COMMITS}","--format=%H","--",str(PATH)],
        check=True,stdout=subprocess.PIPE,text=True
    )
    commits=[x.strip() for x in result.stdout.splitlines() if x.strip()]
    recovered=[]
    for sha in commits:
        show=subprocess.run(
            ["git","show",f"{sha}:{PATH}"],
            stdout=subprocess.PIPE,stderr=subprocess.DEVNULL
        )
        if show.returncode:
            continue
        for row in load_bytes(show.stdout):
            key=str(row.get("sourcePostId") or "")
            if not key or key in merged:
                continue
            merged[key]=row
            recovered.append({"sourcePostId":key,"fromCommit":sha})
    rows=sorted(merged.values(),key=lambda x:int(str(x.get("sourcePostId") or "0")))
    PATH.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+"\n","utf-8")
    report={
        "before":before,
        "after":len(rows),
        "recoveredCount":len(recovered),
        "recovered":sorted(recovered,key=lambda x:int(x["sourcePostId"]))
    }
    PATH.with_name("history-recovery-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n","utf-8")
    print("AUTOWORLD_HISTORY_RECOVERY_OK",json.dumps(report,ensure_ascii=False))

if __name__=="__main__":
    main()
