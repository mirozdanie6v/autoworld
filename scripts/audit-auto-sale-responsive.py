import asyncio, json, os, pathlib, sys, time
from playwright.async_api import async_playwright

BASE=os.environ.get("AUDIT_URL","https://auto-sale-demo.viiversion.com").rstrip("/")
BROWSER=os.environ.get("AUDIT_BROWSER","chromium")
OUT=pathlib.Path("responsive-audit")
OUT.mkdir(exist_ok=True)

VIEWPORTS=[
 {"name":"iphone-se-narrow","w":320,"h":568,"mobile":True},
 {"name":"android-small","w":360,"h":800,"mobile":True},
 {"name":"iphone-8","w":375,"h":667,"mobile":True},
 {"name":"iphone-13","w":390,"h":844,"mobile":True},
 {"name":"iphone-15","w":393,"h":852,"mobile":True},
 {"name":"pixel","w":412,"h":915,"mobile":True},
 {"name":"iphone-pro-max","w":430,"h":932,"mobile":True},
 {"name":"iphone-landscape","w":844,"h":390,"mobile":True},
 {"name":"iphone-pro-max-landscape","w":932,"h":430,"mobile":True},
 {"name":"ipad","w":768,"h":1024,"mobile":False},
 {"name":"ipad-air","w":820,"h":1180,"mobile":False},
 {"name":"ipad-landscape","w":1024,"h":768,"mobile":False},
 {"name":"laptop-1280","w":1280,"h":720,"mobile":False},
 {"name":"laptop-1366","w":1366,"h":768,"mobile":False},
 {"name":"laptop-1440","w":1440,"h":900,"mobile":False},
 {"name":"desktop-fhd","w":1920,"h":1080,"mobile":False},
]

ROUTES={
 "client":["home","catalog","orders","about"],
 "manager":["work","leads","quotes","catalogAdmin","shipping"],
 "owner":["overview","pipeline","finance","ordersAdmin"],
}

async def visible_boxes(page, selector):
    return await page.eval_on_selector_all(selector, """els => els.filter(e => {
      const s=getComputedStyle(e), r=e.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0;
    }).map(e => { const r=e.getBoundingClientRect(); return {
      tag:e.tagName, cls:e.className||'', text:(e.innerText||e.value||'').trim().slice(0,120),
      left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height
    }})""")

async def inspect_page(page, label, mobile):
    data=await page.evaluate("""() => {
      const vw=innerWidth, vh=innerHeight, de=document.documentElement, body=document.body;
      const nav=document.querySelector('.auto-bottom');
      const role=document.querySelector('.auto-role-switch');
      const main=document.querySelector('.auto-main');
      const modal=document.querySelector('.auto-modal,.auto-modal-wide,.auto-tg-modal,.auto-car-detail-modal');
      const rect=e=>e?(()=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})():null;
      const inputs=[...document.querySelectorAll('input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&getComputedStyle(e).display!=='none'}).map(e=>({tag:e.tagName,type:e.type||'',font:parseFloat(getComputedStyle(e).fontSize)||0,box:rect(e)}));
      return {vw,vh,scrollWidth:Math.max(de.scrollWidth,body?.scrollWidth||0),scrollHeight:Math.max(de.scrollHeight,body?.scrollHeight||0),nav:rect(nav),role:rect(role),main:rect(main),modal:rect(modal),inputs};
    }""")
    issues=[]; warnings=[]
    tol=2
    if data["scrollWidth"]>data["vw"]+tol:
        issues.append(f"page-horizontal-overflow:{data['scrollWidth']}>{data['vw']}")
    for box in await visible_boxes(page,'.auto-shell,.auto-topbar,.auto-role-switch,.auto-bottom,.auto-panel,.auto-car,.auto-order-card,.auto-data-table,.auto-modal,.auto-modal-wide,.auto-tg-modal,.auto-car-detail-modal'):
        if box["left"] < -tol or box["right"] > data["vw"]+tol:
            issues.append(f"element-overflow:{box['tag']}.{box['cls']}:{round(box['left'])}..{round(box['right'])}/{data['vw']}")
    if mobile:
        for inp in data["inputs"]:
            if inp["font"] and inp["font"]<16:
                warnings.append(f"ios-zoom-risk:{inp['tag']}:{inp['font']}px")
        for box in await visible_boxes(page,'button,a,input,select,textarea'):
            if box["tag"] in ("BUTTON","A") and (box["height"]<44 or box["width"]<44):
                # tiny icon-only controls are especially relevant; keep as warning, not layout failure
                warnings.append(f"tap-target:{box['tag']}:{round(box['width'])}x{round(box['height'])}:{box['text'][:35]}")
        # Detect the original catalog failure mode: fields collapsing to a few pixels and wrapping vertically.
        for box in await visible_boxes(page,'.auto-data-table.catalog .auto-data-row > span'):
            if box["width"]<48 and len(box["text"])>4:
                issues.append(f"catalog-column-collapse:{round(box['width'])}px:{box['text'][:50]}")
    return {"label":label,"metrics":data,"issues":sorted(set(issues)),"warnings":sorted(set(warnings))}

async def route(page, role, route_name):
    role_button=page.locator(f'[data-role="{role}"]')
    if await role_button.count():
        await role_button.first.click()
        await page.wait_for_timeout(120)
    loc=page.locator(f'[data-go="{route_name}"]')
    if await loc.count():
        await loc.first.click()
        await page.wait_for_timeout(160)

async def audit_modal(page, role, route_name, selector, label, mobile):
    await route(page, role, route_name)
    trigger=page.locator(selector)
    if not await trigger.count():
        return {"label":label,"metrics":{},"issues":["modal-trigger-missing"],"warnings":[]}
    await trigger.first.click()
    await page.wait_for_timeout(180)
    out=await inspect_page(page,label,mobile)
    close=page.locator('[data-close], [data-car-detail-close], [data-client-detail-close]')
    if await close.count():
        await close.first.click()
        await page.wait_for_timeout(80)
    return out

async def one_viewport(browser, vp):
    context=await browser.new_context(
        viewport={"width":vp["w"],"height":vp["h"]},
        device_scale_factor=2 if vp["mobile"] else 1,
        is_mobile=vp["mobile"],
        has_touch=vp["mobile"],
        user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" if vp["mobile"] and BROWSER=="webkit" else None)
    )
    page=await context.new_page()
    await page.route("https://dashboard.viiversion.com/**", lambda route: route.abort())
    await page.route("https://telegram.org/**", lambda route: route.abort())
    async def state_route(route):
        if route.request.method.upper()=="PUT":
            await route.abort()
        else:
            await route.continue_()
    await page.route("**/api/auto-sale/state", state_route)
    console_errors=[]
    page.on("pageerror", lambda exc: console_errors.append("pageerror:"+str(exc)))
    page.on("console", lambda msg: console_errors.append("console:"+msg.text) if msg.type=="error" else None)
    await page.goto(BASE+"?responsiveAudit="+str(int(time.time()*1000)), wait_until="commit", timeout=20000)
    await page.wait_for_selector("#app .auto-shell", timeout=20000)
    await page.wait_for_timeout(800)

    results=[]
    for role,routes in ROUTES.items():
        for r in routes:
            await route(page,role,r)
            results.append(await inspect_page(page,f"{role}:{r}",vp["mobile"]))

    # Modal coverage on representative workflows, read-only interactions only.
    results.append(await audit_modal(page,"client","home","[data-open-request]","client:request-modal",vp["mobile"]))
    await route(page,"manager","work")
    manager_new=page.locator('[data-manager-new]')
    if await manager_new.count():
        await manager_new.first.click()
        await page.wait_for_timeout(120)
        manager_field=page.locator('#requestForm [name="manager"]')
        manager_issues=[]
        if not await manager_field.count():
            manager_issues.append("responsible-field-missing")
        else:
            tag=await manager_field.first.evaluate("(el)=>el.tagName")
            disabled=await manager_field.first.is_disabled()
            if disabled:
                manager_issues.append("responsible-field-disabled")
            if tag=="SELECT":
                values=await manager_field.first.locator("option").evaluate_all("els=>els.map(x=>x.value).filter(Boolean)")
                if not values:
                    manager_issues.append("responsible-select-empty")
            elif tag!="INPUT":
                manager_issues.append("responsible-field-invalid-control:"+tag)
        check=await inspect_page(page,"manager:new-lead-modal",vp["mobile"])
        check["issues"].extend(manager_issues)
        check["issues"]=sorted(set(check["issues"]))
        results.append(check)
        close=page.locator('[data-close]')
        if await close.count():
            await close.first.click()
            await page.wait_for_timeout(80)
    else:
        results.append({"label":"manager:new-lead-modal","metrics":{},"issues":["new-lead-trigger-missing"],"warnings":[]})
    await page.locator('[data-role="manager"]').click(); await page.wait_for_timeout(100)
    results.append(await audit_modal(page,"manager","catalogAdmin","[data-catalog-add]","manager:catalog-add-modal",vp["mobile"]))

    # Bottom-nav clearance at document bottom.
    await page.locator('[data-role="manager"]').click(); await page.wait_for_timeout(80)
    await page.locator('[data-go="catalogAdmin"]').click(); await page.wait_for_timeout(100)
    clearance=await page.evaluate("""() => {
      scrollTo(0,document.documentElement.scrollHeight);
      const n=document.querySelector('.auto-bottom'), m=document.querySelector('.auto-main');
      if(!n||!m)return null;
      const nr=n.getBoundingClientRect(), mr=m.getBoundingClientRect();
      return {gap:nr.top-mr.bottom, navTop:nr.top, mainBottom:mr.bottom};
    }""")
    if clearance and clearance["gap"] < -2:
        results.append({"label":"manager:bottom-nav-clearance","metrics":{"clearance":clearance},"issues":[f"bottom-nav-overlap:{round(-clearance['gap'])}px"],"warnings":[]})

    issues=sum((x["issues"] for x in results),[])
    warnings=sum((x["warnings"] for x in results),[])
    if issues:
        try:
            await page.screenshot(path=str(OUT/f"{BROWSER}-{vp['name']}-FAIL.png"),full_page=True)
        except Exception:
            pass
    await context.close()
    return {
      "viewport":vp,"issues":sorted(set(issues)),"warnings":sorted(set(warnings)),
      "consoleErrors":sorted(set(console_errors)),"checks":results
    }

async def main():
    async with async_playwright() as p:
        browser_type=getattr(p,BROWSER)
        browser=await browser_type.launch(headless=True)
        rows=[]
        for vp in VIEWPORTS:
            print(f"AUDIT {BROWSER} {vp['name']} {vp['w']}x{vp['h']}",flush=True)
            try:
                rows.append(await one_viewport(browser,vp))
            except Exception as exc:
                rows.append({"viewport":vp,"issues":[f"audit-exception:{type(exc).__name__}:{exc}"],"warnings":[],"consoleErrors":[],"checks":[]})
        await browser.close()
    report={"browser":BROWSER,"url":BASE,"viewports":rows}
    (OUT/f"{BROWSER}.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    summary=[{"viewport":r["viewport"]["name"],"size":f"{r['viewport']['w']}x{r['viewport']['h']}","issues":len(r["issues"]),"warnings":len(r["warnings"]),"consoleErrors":len(r["consoleErrors"])} for r in rows]
    print("RESPONSIVE_AUDIT_SUMMARY="+json.dumps(summary,ensure_ascii=False))
    critical=sum(len(r["issues"]) for r in rows)
    print(f"RESPONSIVE_AUDIT_RESULT browser={BROWSER} critical={critical} warnings={sum(len(r['warnings']) for r in rows)}")
    if critical:
        sys.exit(2)

asyncio.run(main())
