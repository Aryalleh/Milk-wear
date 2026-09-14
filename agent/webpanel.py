#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
پنل وبِ مدیریتِ پرینت‌ایجنت.

روی خودِ دستگاهی که کنارِ پرینتر است اجرا می‌شود و از مرورگر (همان دستگاه یا یک
سیستم دیگر در شبکهٔ محلی) در دسترس است. کارها:
  • ویرایش و ذخیرهٔ همهٔ تنظیمات (سرور، توکن، پرینتر، عرض، …) بدون دست‌زدن به .env
  • لیستِ پرینترهای USB و پورت‌های سریالِ متصل و انتخابِ آن‌ها
  • اسکنِ شبکهٔ محلی برای یافتنِ پرینترهای LAN
  • راهنمای رفعِ دسترسیِ USB (قانون udev) و چاپِ آزمایشی

وابسته به Flask. اگر Flask نصب نباشد، ایجنت بدون پنل و فقط با تنظیماتِ فایل کار می‌کند.
"""
import threading

import config
import discovery

# کال‌بک‌هایی که print_agent تزریق می‌کند (برای پرهیز از import حلقوی)
_test_print = None
_status = None


def _flask_app():
    from flask import Flask, request, jsonify, Response

    app = Flask(__name__)

    @app.get("/")
    def index():
        return Response(HTML, mimetype="text/html; charset=utf-8")

    @app.get("/api/config")
    def get_config():
        return jsonify({"ok": True, "config": dict(config.CONFIG)})

    @app.post("/api/config")
    def set_config():
        data = request.get_json(force=True, silent=True) or {}
        cfg = config.save(data)
        return jsonify({"ok": True, "config": cfg})

    @app.get("/api/status")
    def status():
        return jsonify({"ok": True, "status": (_status() if _status else {})})

    @app.get("/api/discover/usb")
    def discover_usb():
        return jsonify(discovery.list_usb())

    @app.get("/api/discover/serial")
    def discover_serial():
        return jsonify(discovery.list_serial())

    @app.post("/api/discover/lan")
    def discover_lan():
        d = request.get_json(force=True, silent=True) or {}
        subnet = (d.get("subnet") or "").strip() or None
        port = int(d.get("port") or 9100)
        return jsonify(discovery.scan_lan(subnet=subnet, port=port))

    @app.get("/api/lan-subnet")
    def lan_subnet():
        return jsonify({"ok": True, "subnet": discovery.local_subnet()})

    @app.post("/api/fix-usb")
    def fix_usb():
        d = request.get_json(force=True, silent=True) or {}
        v = d.get("vendor") or config.get("printer_usb_vendor")
        p = d.get("product") or config.get("printer_usb_product")
        return jsonify(discovery.try_install_udev(v, p))

    @app.post("/api/test-print")
    def test_print():
        if not _test_print:
            return jsonify({"ok": False, "error": "چاپ آزمایشی در دسترس نیست."})
        ok, msg = _test_print()
        return jsonify({"ok": ok, "message": msg})

    return app


def start(test_print_fn=None, status_fn=None):
    """راه‌اندازیِ پنل در یک ترد جداگانه. در صورت نبودِ Flask، پیام می‌دهد و رد می‌شود."""
    global _test_print, _status
    _test_print, _status = test_print_fn, status_fn
    try:
        app = _flask_app()
    except Exception as e:
        print(f"⚠️  پنل وب اجرا نشد (Flask نصب است؟ pip install Flask): {e}")
        return None
    host = config.get("panel_host")
    port = int(config.get("panel_port"))

    def run():
        app.run(host=host, port=port, threaded=True, use_reloader=False, debug=False)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    shown = "127.0.0.1" if host in ("0.0.0.0", "") else host
    print(f"🌐 پنل مدیریت: http://{shown}:{port}")
    return t


# --------------------------- رابط کاربری ---------------------------
HTML = r"""<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>پنل پرینت‌ایجنت</title>
<style>
  :root{--bg:#0f1720;--card:#17212b;--line:#26323f;--txt:#e7edf3;--muted:#9fb0c0;
        --accent:#3aa675;--accent2:#2b8fd6;--danger:#e05656;--warn:#e0a53a;}
  *{box-sizing:border-box}
  body{margin:0;font-family:Vazirmatn,Tahoma,system-ui,sans-serif;background:var(--bg);
       color:var(--txt);line-height:1.7}
  .wrap{max-width:820px;margin:0 auto;padding:20px 16px 60px}
  h1{font-size:20px;margin:6px 0 2px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;
        padding:16px;margin-bottom:14px}
  .card h2{font-size:15px;margin:0 0 12px;display:flex;align-items:center;gap:8px}
  label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
  input,select{width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--line);
        background:#0d151d;color:var(--txt);font-family:inherit;font-size:14px}
  input:focus,select:focus{outline:none;border-color:var(--accent2)}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .row>div{flex:1;min-width:140px}
  button{cursor:pointer;border:0;border-radius:9px;padding:9px 14px;font-family:inherit;
        font-size:14px;font-weight:600;color:#fff;background:var(--accent2)}
  button.ghost{background:#22303d;color:var(--txt)}
  button.ok{background:var(--accent)}
  button:disabled{opacity:.5;cursor:default}
  .btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .list{margin-top:10px;border:1px solid var(--line);border-radius:9px;overflow:hidden}
  .item{padding:9px 11px;border-bottom:1px solid var(--line);display:flex;
        justify-content:space-between;align-items:center;gap:10px;cursor:pointer}
  .item:last-child{border-bottom:0}
  .item:hover{background:#1d2836}
  .item small{color:var(--muted)}
  .tag{font-size:11px;padding:2px 7px;border-radius:20px;background:#22303d;color:var(--muted)}
  .tag.p{background:#123; color:#7fd1a3}
  .tag.no{background:#3a1d1d;color:#e0a0a0}
  .msg{margin-top:12px;padding:10px 12px;border-radius:9px;font-size:13px;display:none}
  .msg.show{display:block}
  .msg.ok{background:#123324;color:#8fe0b6;border:1px solid #1c5c3d}
  .msg.err{background:#331616;color:#f0a6a6;border:1px solid #5c1c1c}
  .msg.warn{background:#332a12;color:#ecc98a;border:1px solid #5c481c}
  code{background:#0d151d;border:1px solid var(--line);border-radius:6px;padding:2px 6px;
        font-size:12px;word-break:break-all;display:inline-block}
  .hint{font-size:12px;color:var(--muted);margin-top:6px}
  .dot{width:9px;height:9px;border-radius:50%;display:inline-block;background:var(--muted)}
  .dot.on{background:var(--accent)} .dot.off{background:var(--danger)}
  .hidden{display:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>🖨️ پنل پرینت‌ایجنت</h1>
  <div class="sub" id="statusline">در حال بارگذاری…</div>

  <div class="card">
    <h2>⚙️ اتصال به سرور</h2>
    <label>آدرس سرور</label>
    <input id="server_url" placeholder="http://localhost:3000">
    <div class="row">
      <div>
        <label>توکن ایجنت</label>
        <input id="agent_token" placeholder="از تنظیمات ← چاپ و سفارش‌گیری">
      </div>
      <div>
        <label>شناسهٔ ایجنت</label>
        <input id="agent_id" placeholder="shop-agent">
      </div>
    </div>
    <label>فاصلهٔ poll (ثانیه)</label>
    <input id="poll_seconds" type="number" step="0.5" min="0.5">
  </div>

  <div class="card">
    <h2>🖨️ پرینتر</h2>
    <label>نوع اتصال</label>
    <select id="printer_type">
      <option value="file">file — حالت تست (ذخیره در out/*.png)</option>
      <option value="usb">usb — پرینتر USB</option>
      <option value="network">network — پرینتر شبکه/LAN</option>
      <option value="serial">serial — پرینتر سریال/COM</option>
    </select>
    <label>عرض چاپ (نقطه) — ۸۰م‌م معمولاً ۵۷۶ (بعضی مدل‌ها ۵۱۲)</label>
    <input id="printer_width" type="number" min="200" max="1200">

    <!-- USB -->
    <div id="sec_usb" class="hidden">
      <div class="btns"><button class="ghost" onclick="scanUSB()">🔄 یافتن پرینترهای USB</button></div>
      <div id="usb_list" class="list hidden"></div>
      <div class="row">
        <div><label>Vendor ID</label><input id="printer_usb_vendor" placeholder="0x0416"></div>
        <div><label>Product ID</label><input id="printer_usb_product" placeholder="0x5011"></div>
      </div>
      <div class="btns"><button class="ghost" onclick="fixUSB()">🔧 رفع دسترسی USB (udev)</button></div>
      <div class="hint">اگر خطای «Access denied» گرفتید، این دکمه قانون udev را می‌سازد یا دستورش را می‌دهد.</div>
    </div>

    <!-- Network -->
    <div id="sec_network" class="hidden">
      <div class="row">
        <div><label>آی‌پی پرینتر</label><input id="printer_host" placeholder="192.168.1.50"></div>
        <div><label>پورت</label><input id="printer_port" type="number" placeholder="9100"></div>
      </div>
      <div class="row" style="align-items:flex-end">
        <div><label>ساب‌نت برای اسکن</label><input id="scan_subnet" placeholder="192.168.1.0/24"></div>
        <div style="flex:0 0 auto"><button class="ghost" onclick="scanLAN()">📡 اسکن شبکه</button></div>
      </div>
      <div id="lan_list" class="list hidden"></div>
    </div>

    <!-- Serial -->
    <div id="sec_serial" class="hidden">
      <div class="btns"><button class="ghost" onclick="scanSerial()">🔄 یافتن پورت‌های سریال</button></div>
      <div id="serial_list" class="list hidden"></div>
      <div class="row">
        <div><label>مسیر دستگاه</label><input id="printer_serial_dev" placeholder="/dev/ttyUSB0"></div>
        <div><label>Baud</label><input id="printer_baud" type="number" placeholder="9600"></div>
      </div>
    </div>
  </div>

  <div class="btns">
    <button class="ok" onclick="saveCfg()">💾 ذخیرهٔ تنظیمات</button>
    <button onclick="testPrint()">🧾 چاپ آزمایشی</button>
    <button class="ghost" onclick="loadCfg()">↺ بازخوانی</button>
  </div>
  <div id="msg" class="msg"></div>
</div>

<script>
const $ = id => document.getElementById(id);
const FIELDS = ["server_url","agent_token","agent_id","poll_seconds","printer_type",
  "printer_width","printer_host","printer_port","printer_usb_vendor",
  "printer_usb_product","printer_serial_dev","printer_baud"];

function msg(t, kind){const m=$("msg"); m.className="msg show "+(kind||"ok"); m.innerHTML=t;}
function hideMsg(){$("msg").className="msg";}

async function api(path, opts){
  const r = await fetch(path, opts); return r.json();
}

function showSection(){
  const t = $("printer_type").value;
  for(const s of ["usb","network","serial"])
    $("sec_"+s).classList.toggle("hidden", s!==t);
}

async function loadCfg(){
  const j = await api("/api/config");
  const c = j.config || {};
  for(const f of FIELDS) if($(f) && c[f]!==undefined) $(f).value = c[f];
  showSection();
  refreshStatus();
}

async function saveCfg(){
  const body = {};
  for(const f of FIELDS) if($(f)) body[f] = $(f).value;
  const j = await api("/api/config", {method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify(body)});
  if(j.ok){msg("✅ تنظیمات ذخیره شد و بلافاصله اعمال شد.");} else {msg("خطا در ذخیره","err");}
  refreshStatus();
}

async function refreshStatus(){
  try{
    const j = await api("/api/status"); const s=j.status||{};
    const on = s.connected;
    $("statusline").innerHTML =
      `<span class="dot ${on?'on':'off'}"></span> ` +
      (on ? "متصل به سرور" : "قطع/در انتظار توکن") +
      (s.printer_type ? ` · پرینتر: ${s.printer_type}` : "") +
      (s.last_job ? ` · آخرین کار: #${s.last_job}` : "") +
      (s.last_error ? ` · ⚠ ${s.last_error}` : "");
  }catch(e){}
}

async function scanUSB(){
  msg("در حال جست‌وجوی USB…","warn");
  const j = await api("/api/discover/usb");
  const box = $("usb_list"); box.innerHTML=""; box.classList.remove("hidden");
  if(!j.ok){msg(j.error||"خطا","err"); box.classList.add("hidden"); return;}
  hideMsg();
  if(!j.devices.length){box.innerHTML='<div class="item">دستگاهی پیدا نشد</div>'; return;}
  for(const d of j.devices){
    const tag = d.is_printer ? '<span class="tag p">پرینتر</span>' :
      (d.accessible? '' : '<span class="tag no">بدون دسترسی</span>');
    const el=document.createElement("div"); el.className="item";
    el.innerHTML=`<span>${d.label} <small>${d.vendor}:${d.product}</small></span> ${tag}`;
    el.onclick=()=>{$("printer_usb_vendor").value=d.vendor; $("printer_usb_product").value=d.product;
      msg(`انتخاب شد: ${d.label} (${d.vendor}:${d.product})`);};
    box.appendChild(el);
  }
}

async function fixUSB(){
  const j = await api("/api/fix-usb",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({vendor:$("printer_usb_vendor").value, product:$("printer_usb_product").value})});
  if(j.ok){msg("✅ "+j.message);}
  else{msg((j.message||"دسترسی روت نیست")+"<br>دستور را دستی اجرا کنید:<br><code>"+j.command+"</code>","warn");}
}

async function scanSerial(){
  const j = await api("/api/discover/serial");
  const box=$("serial_list"); box.innerHTML=""; box.classList.remove("hidden");
  if(!j.ports.length){box.innerHTML='<div class="item">پورتی پیدا نشد</div>'; return;}
  for(const p of j.ports){
    const el=document.createElement("div"); el.className="item";
    el.innerHTML=`<span>${p.label} <small>${p.device}</small></span>`;
    el.onclick=()=>{$("printer_serial_dev").value=p.device; msg("انتخاب شد: "+p.device);};
    box.appendChild(el);
  }
}

async function scanLAN(){
  let sub=$("scan_subnet").value.trim();
  if(!sub){const s=await api("/api/lan-subnet"); sub=s.subnet; $("scan_subnet").value=sub;}
  msg("در حال اسکن "+sub+" … (چند ثانیه)","warn");
  const port = parseInt($("printer_port").value||"9100");
  const j = await api("/api/discover/lan",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({subnet:sub, port})});
  const box=$("lan_list"); box.innerHTML=""; box.classList.remove("hidden");
  if(!j.ok){msg(j.error||"خطا","err"); return;}
  if(!j.printers.length){box.innerHTML='<div class="item">پرینتری روی پورت '+j.port+' پیدا نشد</div>';
    msg(`اسکن ${j.scanned} آدرس تمام شد؛ چیزی پیدا نشد.`,"warn"); return;}
  msg(`${j.printers.length} پرینتر پیدا شد.`);
  for(const p of j.printers){
    const el=document.createElement("div"); el.className="item";
    el.innerHTML=`<span>🖨️ ${p.host} <small>:${p.port}</small></span><span class="tag p">باز</span>`;
    el.onclick=()=>{$("printer_host").value=p.host; $("printer_port").value=p.port;
      msg("انتخاب شد: "+p.host+":"+p.port);};
    box.appendChild(el);
  }
}

async function testPrint(){
  msg("در حال چاپ آزمایشی…","warn");
  const j = await api("/api/test-print",{method:"POST"});
  if(j.ok) msg("✅ "+(j.message||"چاپ آزمایشی انجام شد."));
  else msg("✖ "+(j.message||"چاپ آزمایشی ناموفق بود."),"err");
}

$("printer_type").addEventListener("change", showSection);
loadCfg();
setInterval(refreshStatus, 5000);
</script>
</body>
</html>"""
