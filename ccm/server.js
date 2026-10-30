#!/usr/bin/env node
// 수능 기도회 찬양 추천판 — 의존성 없는 작은 서버.
//   node server.js            → http://localhost:3000
//   PORT=8080 node server.js  → 포트 바꾸기
// 추천 목록은 data/songs.json 에 저장됩니다.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "songs.json");
const PAGE_FILE = path.join(__dirname, "index.html");
const LIMITS = { by: 20, title: 80, artist: 60, url: 500, note: 200 };
const MAX_SONGS = 2000;

let songs = [];
let rev = 0;

function load() {
  try {
    songs = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(songs)) songs = [];
  } catch (e) {
    songs = [];
  }
  rev = Date.now();
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(songs, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  rev++;
}

// index.html 은 아티팩트용 조각(<title>/<style>/본문)이라 문서 껍데기를 씌워서 보냅니다.
function page() {
  const body = fs.readFileSync(PAGE_FILE, "utf8");
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    "<style>body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>" +
    "</head><body>" + body + "</body></html>"
  );
}

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cleanUrl(v) {
  let s = str(v, LIMITS.url);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href.slice(0, LIMITS.url) : "";
  } catch (e) {
    return "";
  }
}

function part(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16 * 1024) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(page());
  }

  if (p === "/api/songs" && req.method === "GET") {
    return send(res, 200, { rev, songs });
  }

  if (p === "/api/songs" && req.method === "POST") {
    const b = await readBody(req);
    const doc = {
      id: crypto.randomUUID(),
      by: str(b.by, LIMITS.by),
      title: str(b.title, LIMITS.title),
      artist: str(b.artist, LIMITS.artist),
      url: cleanUrl(b.url),
      part: part(b.part),
      note: str(b.note, LIMITS.note),
      picked: !!b.picked,
      createdAt: Date.now(),
      createdBy: str(b.createdBy, 40) || null,
    };
    if (!doc.by || !doc.title) return send(res, 400, { error: "이름과 곡 제목은 꼭 적어 주세요" });
    if (songs.length >= MAX_SONGS) return send(res, 400, { error: "추천이 너무 많아요. 오래된 추천을 지워 주세요" });
    songs.push(doc);
    save();
    return send(res, 201, doc);
  }

  const m = p.match(/^\/api\/songs\/([\w-]+)$/);
  if (m) {
    const i = songs.findIndex((s) => s.id === m[1]);
    if (i < 0) return send(res, 404, { error: "이미 지워진 추천이에요" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      if ("picked" in b) songs[i].picked = !!b.picked;
      save();
      return send(res, 200, songs[i]);
    }
    if (req.method === "DELETE") {
      songs.splice(i, 1);
      save();
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: "없는 주소예요" });
}

load();
http
  .createServer((req, res) => {
    handle(req, res).catch((e) => send(res, 400, { error: e.message || "요청을 처리하지 못했어요" }));
  })
  .listen(PORT, () => {
    console.log(`수능 기도회 찬양 추천판: http://localhost:${PORT}`);
  });
