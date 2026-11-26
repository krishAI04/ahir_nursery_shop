// Runs in the staff's browser: shrinks the chosen photo to 2000 px / JPEG 0.85, then uploads it.
export const shrinkScript = `
const input = document.getElementById("pick");
const msg = document.getElementById("msg");
input.addEventListener("change", async () => {
  const file = input.files[0];
  if (!file) return;
  msg.textContent = "Uploading...";
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    const res = await fetch(input.getAttribute("data-put") || location.pathname, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
    if (!res.ok) throw new Error();
    input.value = "";
    location.reload();
  } catch (e) {
    input.value = "";
    msg.textContent = "Could not upload that photo. Try another one.";
  }
});
`;
