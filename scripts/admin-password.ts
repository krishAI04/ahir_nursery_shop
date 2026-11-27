// Sets the shared staff password for the admin sign-in.
// Asks for the password twice (hidden), hashes it here, and pipes only the hash into
// `wrangler secret put ADMIN_PASSWORD_HASH`. The password itself never leaves this laptop.
// Changing it signs every staff member out.
import { spawnSync } from "node:child_process";
import { hashPassword } from "../src/admin/session";

function ask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this in a terminal."));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (c === "\u0003") process.exit(130); // Ctrl+C
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

const password = await ask("New staff password (at least 12 characters): ");
if (password.length < 12) {
  console.error("Too short. Use at least 12 characters, for example three words with a number.");
  process.exit(1);
}
if ((await ask("Type it again: ")) !== password) {
  console.error("The two passwords don't match. Nothing was changed.");
  process.exit(1);
}

const hash = await hashPassword(password);
const res = spawnSync("npx", ["wrangler", "secret", "put", "ADMIN_PASSWORD_HASH"], { input: hash, stdio: ["pipe", "inherit", "inherit"], shell: true });
if (res.status !== 0) {
  console.error("wrangler failed; the password was not changed.");
  process.exit(res.status ?? 1);
}
console.log("Done. Staff sign in with username \"staff\" and the new password.");
