#!/usr/bin/env node
// 관리자 비밀번호 해시 만들기
//   npm run hash-password
// 비밀번호를 두 번 입력하면 ADMIN_PASSWORD_HASH 에 넣을 값을 보여 준다.
// 입력한 비밀번호는 화면에 보이지 않고, 어디에도 저장되지 않는다.
// (자동화용) 표준 입력이 터미널이 아니면 첫 줄을 비밀번호로 읽는다.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const ITERATIONS = 600000;

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2-sha256:${ITERATIONS}:${base64url(salt)}:${base64url(new Uint8Array(bits))}`;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readFirstLine() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0] ?? "";
}

async function main() {
  let password;
  if (process.stdin.isTTY) {
    password = await askHidden("새 비밀번호: ");
    const again = await askHidden("한 번 더: ");
    if (password !== again) {
      console.error("두 비밀번호가 다릅니다. 다시 실행해 주세요.");
      process.exit(1);
    }
  } else {
    password = await readFirstLine();
  }
  if ([...password].length < 10) {
    console.error("비밀번호는 10자 이상으로 정해 주세요.");
    process.exit(1);
  }
  const hash = await hashPassword(password);
  if (process.stdin.isTTY) console.log("\nADMIN_PASSWORD_HASH 에 아래 값을 넣으세요:\n");
  console.log(hash);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
