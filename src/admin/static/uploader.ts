// Runs in the staff's browser on the product page: the Add photos sheet (camera, gallery, drop from a laptop),
// one-at-a-time uploads with progress, and hold-and-drag to reorder the photo strip.
// Each photo is shrunk to 2000 px on the longest side, white background, JPEG 0.85, before upload.
export const uploaderScript = `
(function () {
  var sheet = document.getElementById("add-sheet");
  if (!sheet) return;
  var put = sheet.getAttribute("data-put");
  var list = sheet.querySelector("[data-ups]");
  var head = sheet.querySelector("[data-ups-head]");
  // added: photos saved since the page loaded (closing the sheet shows them); ok/bad: counts for the current batch.
  var queue = [], busy = false, added = 0, ok = 0, bad = 0;
  var only = sheet.querySelector("[data-only]");
  var open = function () { if (!sheet.open) sheet.showModal(); };
  // Back to the photos part of this page (without ?add=1, so the sheet does not open again).
  var reload = function (saved) { if (!window.ncOkToLeave || window.ncOkToLeave()) location.replace(put + (saved ? "?saved=1" : "")); };

  document.querySelectorAll("[data-open-add]").forEach(function (b) { b.setAttribute("data-wired", ""); b.addEventListener("click", open); });
  if (sheet.hasAttribute("data-autoopen")) open();
  // Photos already added show up once the sheet is closed.
  sheet.addEventListener("close", function () { if (added && !busy) reload(true); });

  // Reads only the size first, so a big camera photo can be decoded straight at 2000 px where the browser allows it.
  function size(file) {
    return new Promise(function (ok, no) {
      var u = URL.createObjectURL(file), i = new Image();
      i.onload = function () { URL.revokeObjectURL(u); ok([i.naturalWidth, i.naturalHeight]); };
      i.onerror = function () { URL.revokeObjectURL(u); no(); };
      i.src = u;
    });
  }
  function decode(file) {
    return size(file)
      .then(function (wh) {
        var s = Math.min(1, 2000 / Math.max(wh[0], wh[1]));
        if (s === 1) return createImageBitmap(file);
        return createImageBitmap(file, { resizeWidth: Math.round(wh[0] * s), resizeHeight: Math.round(wh[1] * s), resizeQuality: "high" });
      })
      .catch(function () { return createImageBitmap(file); });
  }

  function shrink(file) {
    return decode(file).then(function (bmp) {
      var scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();
      return new Promise(function (ok, no) {
        canvas.toBlob(function (b) { canvas.width = canvas.height = 0; b ? ok(b) : no(); }, "image/jpeg", 0.85);
      });
    });
  }

  function send(blob, onPct) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest();
      x.open("PUT", put);
      x.setRequestHeader("Content-Type", "image/jpeg");
      x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
      x.onload = function () { x.status >= 200 && x.status < 300 ? ok() : no(); };
      x.onerror = x.onabort = function () { no(); };
      x.send(blob);
    });
  }

  function row(file) {
    var r = document.createElement("div");
    r.className = "up";
    r.innerHTML = '<span class="th"></span><div class="b"><span class="nm"></span><span class="pct"></span><div class="prog"><i></i></div><p class="err" hidden>Could not upload this photo. Try another one.</p></div>';
    r.querySelector(".nm").textContent = file.name || "Photo";
    list.appendChild(r);
    head.hidden = false;
    return {
      thumb: function (blob) {
        var i = document.createElement("img");
        i.alt = "";
        i.onload = i.onerror = function () { URL.revokeObjectURL(i.src); };
        i.src = URL.createObjectURL(blob);
        r.querySelector(".th").replaceWith(i);
      },
      pct: function (n, text) { r.querySelector(".pct").textContent = " \\u00b7 " + (text || n + "%"); r.querySelector(".prog i").style.width = n + "%"; },
      done: function () { r.querySelector(".pct").textContent = ""; r.insertAdjacentHTML("beforeend", '<span class="ok">' + sheet.querySelector("[data-ok-icon]").innerHTML + '<span class="vh">Uploaded</span></span>'); },
      fail: function () { r.classList.add("bad"); r.querySelector(".pct").textContent = ""; r.querySelector(".prog").hidden = true; r.querySelector(".err").hidden = false; },
    };
  }

  function next() {
    var job = queue.shift();
    if (!job) {
      busy = false;
      // All went well: show them. If one failed, keep the sheet so its message stays; closing it shows the rest.
      if (sheet.open ? ok && !bad : added) reload(true);
      return;
    }
    busy = true;
    job.ui.pct(0, "getting ready");
    shrink(job.file)
      .then(function (blob) { job.ui.thumb(blob); job.ui.pct(0); return send(blob, job.ui.pct); })
      .then(function () { added++; ok++; job.ui.done(); }, function () { bad++; job.ui.fail(); })
      .then(next);
  }

  function add(files) {
    var photos = Array.prototype.filter.call(files, function (f) {
      return /^image\\//.test(f.type) || /\\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(f.name);
    });
    if (!files.length) return;
    open();
    only.hidden = photos.length > 0;
    if (!photos.length) return;
    if (!busy) { ok = 0; bad = 0; }
    photos.forEach(function (f) { queue.push({ file: f, ui: row(f) }); });
    if (!busy) next();
  }

  sheet.querySelectorAll("input[type=file]").forEach(function (inp) {
    inp.addEventListener("change", function () { add(inp.files); inp.value = ""; });
  });

  // Laptop: drop photos anywhere on the page.
  var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0; };
  document.addEventListener("dragover", function (e) { if (hasFiles(e)) { e.preventDefault(); document.body.classList.add("dropping"); } });
  document.addEventListener("dragleave", function (e) { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
  document.addEventListener("drop", function (e) {
    document.body.classList.remove("dropping");
    if (!hasFiles(e)) return;
    e.preventDefault();
    add(e.dataTransfer.files);
  });

  // Hold and drag to reorder (mouse: press and move; touch: hold 300 ms, then move).
  var strip = document.querySelector("[data-strip]");
  if (!strip) return;
  var tiles = function () { return Array.prototype.slice.call(strip.querySelectorAll(".ph")); };
  var ids = function () { return tiles().map(function (t) { return t.getAttribute("data-id"); }).join(","); };
  var drag = null;
  strip.addEventListener("dragstart", function (e) { if (e.target.closest(".ph")) e.preventDefault(); });
  strip.addEventListener("contextmenu", function (e) { if (e.target.closest(".ph")) e.preventDefault(); });
  strip.addEventListener("pointerdown", function (e) {
    var tile = e.target.closest(".ph");
    if (!tile || e.button || e.target.closest("form,details") || tiles().length < 2) return;
    var d = { tile: tile, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, before: ids() };
    var start = function () { d.on = true; tile.classList.add("lift"); try { tile.setPointerCapture(d.id); } catch (err) {} };
    if (e.pointerType !== "mouse") d.timer = setTimeout(start, 300);
    drag = d;
  });
  // While dragging, a touch move must not scroll the page.
  strip.addEventListener("touchmove", function (e) { if (drag && drag.on) e.preventDefault(); }, { passive: false });
  document.addEventListener("pointermove", function (e) {
    var d = drag;
    if (!d || e.pointerId !== d.id) return;
    // The button was let go outside the window: finish the drag here.
    if (e.pointerType === "mouse" && !e.buttons) return end(e);
    var far = Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8;
    if (!d.on) {
      if (!far) return;
      if (e.pointerType !== "mouse") { clearTimeout(d.timer); drag = null; return; }
      d.on = true; d.tile.classList.add("lift");
    }
    e.preventDefault();
    var over = document.elementFromPoint(e.clientX, e.clientY);
    var t = over && over.closest(".ph");
    if (!t || t === d.tile || t.parentNode !== strip) return;
    var all = tiles();
    strip.insertBefore(d.tile, all.indexOf(t) > all.indexOf(d.tile) ? t.nextSibling : t);
  });
  var saving = Promise.resolve();
  var end = function (e) {
    var d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    clearTimeout(d.timer);
    d.tile.classList.remove("lift");
    var now = ids();
    if (!d.on || now === d.before) return;
    renumber();
    // One save at a time, in drag order, so an older order can never land after a newer one.
    saving = saving
      .then(function () {
        return fetch(put + "/order", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: "order=" + encodeURIComponent(now) });
      })
      .then(function (r) { if (!r.ok) throw new Error(); })
      .catch(function () {
        var m = document.getElementById("order-msg");
        m.textContent = "Could not save the new order";
        m.hidden = false;
        setTimeout(reload, 1500);
      });
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);

  // Keep the Main badge, labels and the Move earlier/later buttons right after a drag.
  function renumber() {
    var all = tiles(), main = strip.querySelector(".main");
    all.forEach(function (t, n) {
      t.querySelector("img").alt = n === 0 ? "Main photo" : "Photo " + (n + 1);
      t.querySelector(".del").setAttribute("aria-label", "Delete photo " + (n + 1));
      var s = t.querySelector("summary");
      if (s) s.setAttribute("aria-label", "Move photo " + (n + 1));
      var b = t.querySelectorAll(".pop button");
      if (b.length === 2) { b[0].disabled = n === 0; b[1].disabled = n === all.length - 1; }
    });
    if (main) all[0].insertBefore(main, all[0].querySelector("form"));
  }
})();
`;
