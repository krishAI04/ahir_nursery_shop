// Runs in the staff's browser: shows the search box, filters the category list as you type,
// and keeps the chips of picked categories in step with the boxes. Without it the full list still works.
export const categoryPickerScript = `
(function () {
  document.querySelectorAll("[data-picker]").forEach(function (p) {
    var find = p.querySelector("[data-find]");
    var q = find.querySelector("input");
    var chips = p.querySelector("[data-chips]");
    var none = p.querySelector("[data-none]");
    var opts = [].slice.call(p.querySelectorAll(".opt"));
    find.hidden = false;
    q.addEventListener("input", function () {
      var t = q.value.trim().toLowerCase();
      var n = 0;
      opts.forEach(function (o) {
        var hit = !t || o.textContent.toLowerCase().indexOf(t) >= 0;
        o.hidden = !hit;
        if (hit) n++;
      });
      none.hidden = n > 0;
    });
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
    p.addEventListener("change", function () {
      chips.textContent = "";
      opts.forEach(function (o) {
        var box = o.querySelector("input");
        if (!box.checked) return;
        var chip = document.createElement("label");
        chip.className = "chip on";
        chip.htmlFor = box.id;
        chip.textContent = o.textContent.trim();
        chip.insertAdjacentHTML("beforeend", '<svg class="i s" aria-hidden="true"><use href="#x"/></svg>');
        chips.appendChild(chip);
      });
      chips.hidden = !chips.children.length;
    });
  });
})();
`;
