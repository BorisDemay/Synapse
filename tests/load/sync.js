import http from "k6/http";
import { check, sleep } from "k6";
import crypto from "k6/crypto";
import ws from "k6/ws";

const BASE_URL = __ENV.SYNAPSE_BASE_URL || "http://127.0.0.1:3000";
const ORIGIN = __ENV.SYNAPSE_ALLOWED_ORIGIN || "http://127.0.0.1:5173";
const WS_URL = BASE_URL.replace(/^http/, "ws");

export const options = {
  scenarios: {
    sync_clients: {
      executor: "constant-vus",
      vus: 100,
      duration: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<750"],
    checks: ["rate>0.98"],
  },
};

/** Per-VU vault cursor so concurrent clients do not share one revision chain. */
const vaultState = {};

function sessionCookie(response) {
  const jarCookie = response.cookies.session?.[0]?.value;
  if (jarCookie) {
    return jarCookie;
  }
  const header = response.headers["Set-Cookie"] || response.headers["set-cookie"];
  if (!header) {
    return null;
  }
  const match = String(header).match(/session=([^;]+)/);
  return match ? match[1] : null;
}

function opaqueCiphertext(seed) {
  const bytes = [];
  for (let index = 0; index < 16; index += 1) {
    bytes.push((seed + index * 17) % 256);
  }
  return bytes;
}

function sha256Hex(bytes) {
  return crypto.sha256(new Uint8Array(bytes).buffer, "hex");
}

/** Canonical lowercase UUID v7 (SortRand) required by push validation. */
function uuidv7() {
  const bytes = new Uint8Array(16);
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  for (let index = 6; index < 16; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function authHeaders(cookie) {
  return {
    Cookie: `session=${cookie}`,
    "content-type": "application/json",
    Origin: ORIGIN,
  };
}

export function setup() {
  const email = `k6-${Date.now()}@example.test`;
  const password = "a secure password";
  const signup = http.post(
    `${BASE_URL}/auth/signup`,
    JSON.stringify({ email, password }),
    { headers: { "content-type": "application/json" } },
  );
  check(signup, {
    "signup accepted": (response) =>
      response.status === 201 || response.status === 200,
  });

  const login = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "content-type": "application/json" } },
  );
  check(login, { "login ok": (response) => response.status === 204 });
  const cookie = sessionCookie(login);
  if (!cookie) {
    throw new Error("missing session cookie from login");
  }
  return { cookie };
}

export default function (data) {
  const headers = authHeaders(data.cookie);

  const live = http.get(`${BASE_URL}/health/live`);
  check(live, {
    "live ok": (response) =>
      response.status === 200 && response.body.includes('"status":"ok"'),
  });

  const session = http.get(`${BASE_URL}/v1/session`, { headers });
  check(session, {
    "session ok": (response) =>
      response.status === 200 && response.body.includes("user_id"),
  });

  if (!vaultState[__VU]) {
    const vault = http.post(`${BASE_URL}/vaults`, "{}", { headers });
    check(vault, { "vault created": (response) => response.status === 201 });
    const vaultId = vault.json("id");
    if (!vaultId) {
      sleep(0.1);
      return;
    }
    vaultState[__VU] = { vaultId, revision: 0 };
  }

  const state = vaultState[__VU];
  const pull = http.get(
    `${BASE_URL}/v1/vaults/${state.vaultId}/operations?limit=50`,
    { headers },
  );
  check(pull, {
    "pull ok": (response) =>
      response.status === 200 && response.body.includes("protocol_version"),
  });

  const ciphertext = opaqueCiphertext((__VU * 1_000_003 + __ITER * 17) % 256);
  const pushBody = JSON.stringify({
    protocol_version: 1,
    operation_id: uuidv7(),
    vault_id: state.vaultId,
    note_id: uuidv7(),
    base_revision: state.revision,
    ciphertext,
    nonce: Array(24).fill(17),
    aad_version: 1,
    ciphertext_hash: sha256Hex(ciphertext),
  });
  const push = http.post(
    `${BASE_URL}/v1/vaults/${state.vaultId}/operations`,
    pushBody,
    { headers },
  );
  check(push, {
    "push accepted": (response) => response.status === 201,
  });
  if (push.status === 201) {
    const revision = push.json("revision");
    if (typeof revision === "number") {
      state.revision = revision;
    }
  }

  if (__ITER % 20 === 0) {
    const wsResponse = ws.connect(
      `${WS_URL}/v1/vaults/${state.vaultId}/ws`,
      { headers: { Cookie: `session=${data.cookie}` } },
      function (socket) {
        socket.on("open", function () {
          socket.close();
        });
        socket.setTimeout(function () {
          socket.close();
        }, 1000);
      },
    );
    check(wsResponse, {
      "websocket upgrade ok": (response) => response && response.status === 101,
    });
  }

  sleep(0.1);
}
