// 해시·무작위 값·비밀번호 검증
//
// 비밀번호 해시 형식: pbkdf2-sha256:<반복 횟수>:<솔트 base64url>:<해시 base64url>
// 반복 횟수는 600000 이상만 받는다. scripts/hash-password.mjs 가 이 형식으로 만든다.
//
// Cloudflare Workers(workerd)의 Web Crypto PBKDF2 는 반복 횟수 100000 을 넘으면
// 오류를 낸다. 그래서 먼저 Web Crypto PBKDF2 를 쓰고, 거부되면 Web Crypto HMAC 으로
// 첫 블록을 만든 뒤 같은 계산(RFC 8018 PBKDF2-HMAC-SHA256)을 직접 이어 간다.

export const PASSWORD_ITERATIONS = 600000;
const MAX_ITERATIONS = 10_000_000;

const encoder = new TextEncoder();

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return hex(new Uint8Array(digest));
}

/** 무작위 토큰(base64url). bytes=16 이면 128비트, 32 이면 256비트. */
export function randomToken(bytes: number): string {
  return base64url(randomBytes(bytes));
}

export function randomId(): string {
  return hex(randomBytes(16));
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ---------- PBKDF2-HMAC-SHA256 ----------

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/** SHA-256 압축 함수: state(8워드)에 block(16워드)을 반영해 out(8워드)에 쓴다. */
function compress(state: Int32Array, block: Int32Array, out: Int32Array, w: Int32Array): void {
  for (let i = 0; i < 16; i++) w[i] = block[i]!;
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15]!;
    const y = w[i - 2]!;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
  }
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!;
  let e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  out[0] = (state[0]! + a) | 0; out[1] = (state[1]! + b) | 0;
  out[2] = (state[2]! + c) | 0; out[3] = (state[3]! + d) | 0;
  out[4] = (state[4]! + e) | 0; out[5] = (state[5]! + f) | 0;
  out[6] = (state[6]! + g) | 0; out[7] = (state[7]! + h) | 0;
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, message));
}

/** Web Crypto 를 쓸 수 없을 때의 PBKDF2-HMAC-SHA256 (출력 32바이트, 블록 1개). */
export async function pbkdf2Sha256Manual(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  let key = password;
  if (key.length > 64) key = new Uint8Array(await crypto.subtle.digest("SHA-256", key));
  const ipadBlock = new Int32Array(16);
  const opadBlock = new Int32Array(16);
  for (let i = 0; i < 16; i++) {
    let wi = 0, wo = 0;
    for (let j = 0; j < 4; j++) {
      const byte = key[i * 4 + j] ?? 0;
      wi = (wi << 8) | (byte ^ 0x36);
      wo = (wo << 8) | (byte ^ 0x5c);
    }
    ipadBlock[i] = wi;
    opadBlock[i] = wo;
  }
  const w = new Int32Array(64);
  const innerState = new Int32Array(8);
  const outerState = new Int32Array(8);
  compress(IV, ipadBlock, innerState, w);
  compress(IV, opadBlock, outerState, w);

  // U1 = HMAC(P, S || INT(1))
  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 3] = 1;
  const u1 = await hmacSha256(password, first);

  // 32바이트 메시지 + 패딩. 길이는 (64 + 32) * 8 = 768 비트.
  const block = new Int32Array(16);
  block[8] = 0x80000000 | 0;
  block[15] = 768;
  const u = new Int32Array(8);
  for (let i = 0; i < 8; i++) {
    u[i] = (u1[i * 4]! << 24) | (u1[i * 4 + 1]! << 16) | (u1[i * 4 + 2]! << 8) | u1[i * 4 + 3]!;
  }
  const t = new Int32Array(u);
  const tmp = new Int32Array(8);
  for (let n = 1; n < iterations; n++) {
    for (let i = 0; i < 8; i++) block[i] = u[i]!;
    compress(innerState, block, tmp, w);
    for (let i = 0; i < 8; i++) block[i] = tmp[i]!;
    compress(outerState, block, u, w);
    for (let i = 0; i < 8; i++) t[i] = t[i]! ^ u[i]!;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = t[i]! >>> 24;
    out[i * 4 + 1] = (t[i]! >>> 16) & 0xff;
    out[i * 4 + 2] = (t[i]! >>> 8) & 0xff;
    out[i * 4 + 3] = t[i]! & 0xff;
  }
  return out;
}

export async function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  try {
    const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    return new Uint8Array(bits);
  } catch {
    return pbkdf2Sha256Manual(password, salt, iterations);
  }
}

export interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

export function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.trim().split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < PASSWORD_ITERATIONS || iterations > MAX_ITERATIONS) return null;
  const salt = fromBase64url(parts[2]!);
  const hash = fromBase64url(parts[3]!);
  if (!salt || salt.length < 16 || !hash || hash.length !== 32) return null;
  return { iterations, salt, hash };
}

/** 저장된 해시와 비밀번호를 비교한다. 해시 형식이 잘못되었으면 항상 false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parsePasswordHash(stored);
  // 형식이 잘못돼도 계산 시간은 비슷하게 맞춘다.
  const salt = parsed?.salt ?? new Uint8Array(16);
  const iterations = parsed?.iterations ?? PASSWORD_ITERATIONS;
  const derived = await pbkdf2Sha256(encoder.encode(password), salt, iterations);
  if (!parsed) return false;
  return constantTimeEqual(derived, parsed.hash);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await pbkdf2Sha256(encoder.encode(password), salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256:${PASSWORD_ITERATIONS}:${base64url(salt)}:${base64url(derived)}`;
}

/** 길이가 달라도 시간 차이를 줄여 문자열을 비교한다(아이디 비교용). */
export async function safeStringEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return constantTimeEqual(new Uint8Array(ha), new Uint8Array(hb));
}
