import { loadEnv } from "./_env.ts";
loadEnv();

const { setPassword } = await import("../src/lib/auth.ts");
const { closeDb } = await import("../src/lib/db.ts");
const { sessionSecretProblem } = await import("../src/lib/config.ts");

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d) => (buf += d));
      stdin.on("end", () => resolve(buf.split(/\r?\n/)[0] ?? ""));
      return;
    }
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
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

const problem = sessionSecretProblem();
if (problem) {
  console.error(`Setup incomplete: ${problem}\nCopy .env.example to .env.local and set SBOS_SESSION_SECRET first.`);
  process.exit(1);
}
const a = await readHidden("New password (min 12 characters): ");
const b = process.stdin.isTTY ? await readHidden("Repeat password: ") : a;
if (a !== b) {
  console.error("Passwords do not match.");
  process.exit(1);
}
try {
  setPassword(a);
  console.log("Password saved. Any existing sign-ins are now invalid.");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  closeDb();
}
