import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { PathError, resolveInside } from "./safe-fs.ts";

/**
 * Encrypted backup file = MAGIC | salt(16) | iv(12) | AES-256-GCM(gzip(archive)) | tag(16).
 * The key comes from the passphrase via scrypt. Pure Node (no tar/7zip), so it behaves the same under every Windows shell.
 * Archive = repeated [pathLen u32][path utf8][size u64][bytes], ended by pathLen 0. Paths are POSIX style and relative.
 */
export const ENCRYPTED_EXT = ".sbosenc";
const MAGIC = Buffer.from("SBOSENC1");
const HEADER = MAGIC.length + 16 + 12;
const TAG = 16;
const KDF = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const MIN_PASSPHRASE = 12;

const key = (passphrase: string, salt: Buffer): Buffer => crypto.scryptSync(passphrase, salt, 32, KDF);

function assertPassphrase(p: string | undefined): string {
  if (!p || p.length < MIN_PASSPHRASE) throw new Error(`Backup passphrase must be at least ${MIN_PASSPHRASE} characters (SBOS_BACKUP_PASSPHRASE).`);
  return p;
}

function* walk(root: string, rel = ""): Generator<string> {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(root, r);
    else if (e.isFile()) yield r;
  }
}

async function* packDir(dir: string): AsyncGenerator<Buffer> {
  for (const rel of walk(dir)) {
    const full = path.join(dir, ...rel.split("/"));
    const size = fs.statSync(full).size;
    const p = Buffer.from(rel, "utf8");
    const head = Buffer.alloc(4 + p.length + 8);
    head.writeUInt32BE(p.length, 0);
    p.copy(head, 4);
    head.writeBigUInt64BE(BigInt(size), 4 + p.length);
    yield head;
    let sent = 0;
    for await (const chunk of fs.createReadStream(full)) {
      sent += (chunk as Buffer).length;
      yield chunk as Buffer;
    }
    if (sent !== size) throw new Error(`"${rel}" changed while it was being archived.`);
  }
  yield Buffer.alloc(4);
}

/** Encrypt a finished backup folder into `<folder>.sbosenc` next to it (or in `outDir`). Returns the file path. */
export async function encryptBackup(backupDir: string, passphrase: string | undefined, outDir = path.dirname(backupDir)): Promise<string> {
  const pass = assertPassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(pass, salt), iv);
  cipher.setAAD(MAGIC);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, path.basename(backupDir) + ENCRYPTED_EXT);
  const tmp = out + ".partial";
  try {
    const ws = fs.createWriteStream(tmp, { flags: "wx" });
    ws.write(Buffer.concat([MAGIC, salt, iv]));
    await pipeline(Readable.from(packDir(backupDir)), zlib.createGzip(), cipher, ws, { end: false });
    await new Promise<void>((res, rej) => ws.end(cipher.getAuthTag(), (e?: Error | null) => (e ? rej(e) : res())));
    fs.renameSync(tmp, out);
    return out;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

class Reader {
  private it: AsyncIterator<Buffer>;
  private buf: Buffer = Buffer.alloc(0);
  constructor(src: AsyncIterable<Buffer>) { this.it = src[Symbol.asyncIterator](); }
  private async fill(): Promise<boolean> {
    const r = await this.it.next();
    if (r.done) return false;
    this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : r.value;
    return true;
  }
  async read(n: number): Promise<Buffer> {
    while (this.buf.length < n) if (!(await this.fill())) throw new Error("Backup archive is truncated.");
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  async copyTo(n: bigint, ws: fs.WriteStream): Promise<void> {
    let left = n;
    while (left > 0n) {
      if (!this.buf.length && !(await this.fill())) throw new Error("Backup archive is truncated.");
      const take = Number(left < BigInt(this.buf.length) ? left : BigInt(this.buf.length));
      const piece = this.buf.subarray(0, take);
      this.buf = this.buf.subarray(take);
      left -= BigInt(take);
      if (!ws.write(piece)) await new Promise((r) => ws.once("drain", () => r(undefined)));
    }
  }
  async drain(): Promise<void> { while (await this.fill()) this.buf = Buffer.alloc(0); }
}

/**
 * Decrypt `file` into `<outRoot>/<backup folder name>` and return that folder. Nothing is left behind if the passphrase is wrong
 * or the file was modified (GCM authenticates the whole stream; the extracted folder is deleted on any failure).
 */
export async function decryptBackup(file: string, passphrase: string | undefined, outRoot: string): Promise<string> {
  const pass = assertPassphrase(passphrase);
  const size = fs.statSync(file).size;
  if (size < HEADER + TAG) throw new Error("Not an encrypted Second Brain OS backup (file too small).");
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    fs.readSync(fd, head, 0, HEADER, 0);
    fs.readSync(fd, tag, 0, TAG, size - TAG);
  } finally {
    fs.closeSync(fd);
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an encrypted Second Brain OS backup (bad header).");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(pass, head.subarray(MAGIC.length, MAGIC.length + 16)), head.subarray(MAGIC.length + 16, HEADER));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  const dest = path.join(path.resolve(outRoot), path.basename(file, ENCRYPTED_EXT));
  if (fs.existsSync(dest)) throw new PathError(`"${dest}" already exists; refusing to overwrite.`);
  fs.mkdirSync(dest, { recursive: true });
  try {
    const plain = fs.createReadStream(file, { start: HEADER, end: size - TAG - 1 }).pipe(decipher).pipe(zlib.createGunzip());
    // Errors from earlier stages must surface here, so forward them.
    const errored = new Promise<never>((_, rej) => { decipher.on("error", rej); plain.on("error", rej); });
    const reader = new Reader(plain);
    const work = (async () => {
      for (;;) {
        const plen = (await reader.read(4)).readUInt32BE(0);
        if (plen === 0) break;
        if (plen > 1024) throw new Error("Backup archive is corrupt (path too long).");
        const rel = (await reader.read(plen)).toString("utf8");
        const bytes = (await reader.read(8)).readBigUInt64BE(0);
        const target = resolveInside(dest, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const ws = fs.createWriteStream(target, { flags: "wx" });
        await reader.copyTo(bytes, ws);
        await new Promise<void>((res, rej) => ws.end((e?: Error | null) => (e ? rej(e) : res())));
      }
      await reader.drain(); // forces the final GCM tag check
    })();
    await Promise.race([work, errored]);
    await work;
    return dest;
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    const msg = e instanceof Error ? e.message : String(e);
    // A wrong key decrypts to noise, so gzip usually fails before the GCM tag check does; both mean the same thing to the user.
    if (/authenticate|bad decrypt|incorrect header check|unknown compression|invalid (stored|block|distance|literal|code)|unexpected end of file/i.test(msg)) throw new Error("Could not decrypt: wrong passphrase, or the backup file was modified or damaged.");
    throw e;
  }
}
