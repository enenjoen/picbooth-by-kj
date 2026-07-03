const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const EVENTS_FILE = path.join(DATA, "events.json");
const TEMPLATES_FILE = path.join(DATA, "templates.json");
const PORT = Number(process.env.PORT || 8787);
const DEMO = process.env.BOOTH_DEMO === "1";
let cameraBusy = false;
let lastCameraStatus = { ready: false, demo: false, name: "", message: "正在检查外接相机…" };
let liveViewProcess = null;
let liveViewBuffer = Buffer.alloc(0);
let latestLiveViewFrame = null;
let liveViewIdleTimer = null;
let liveViewLastStartAt = 0;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

async function ensureData() {
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.mkdir(path.join(DATA, "templates"), { recursive: true });
  await fsp.mkdir(path.join(DATA, "assets"), { recursive: true });
  await fsp.mkdir(path.join(DATA, "photos"), { recursive: true });
  if (!fs.existsSync(EVENTS_FILE)) {
    const initial = [{
      id: "event",
      name: "Your Event",
      date: "",
      text: "一起记录这一刻",
      countdown: 3,
      captureSource: "auto",
      shotCount: 1,
      printer: "",
      template: "",
      activeTemplateId: "classic"
    }];
    await fsp.writeFile(EVENTS_FILE, JSON.stringify(initial, null, 2));
  }
  if (!fs.existsSync(TEMPLATES_FILE)) {
    await fsp.writeFile(TEMPLATES_FILE, JSON.stringify(defaultTemplates(), null, 2));
  } else {
    const current = JSON.parse(await fsp.readFile(TEMPLATES_FILE, "utf8"));
    const requiredIds = new Set(defaultTemplates().map(template => template.id));
    if (current.some(template => template.schemaVersion !== 4) || [...requiredIds].some(id => !current.some(template => template.id === id))) {
      const defaults = defaultTemplates();
      const defaultIds = new Set(defaults.map(template => template.id));
      const custom = current.filter(template => !defaultIds.has(template.id)).map(template => ({
        ...template,
        width: Number(template.width) || 1800,
        height: Number(template.height) || 1200,
        schemaVersion: 4,
        layers: template.layers || []
      }));
      await fsp.writeFile(TEMPLATES_FILE, JSON.stringify([...defaults, ...custom], null, 2));
    }
  }
}

function defaultTemplates() {
  return [
    {
      id: "classic", name: "粉色爱语", background: "#fff2f6", width: 1800, height: 1200, schemaVersion: 4,
      layers: [
        { id: "photo-1", type: "photo", photoIndex: 0, x: 55, y: 55, w: 1280, h: 1090, radius: 42, borderColor: "#ffffff", borderWidth: 12 },
        { id: "heart-1", type: "heart", x: 1490, y: 100, w: 140, h: 125, color: "#e990ad", opacity: 0.9 },
        { id: "title", type: "text", text: "{event}", x: 1560, y: 410, fontSize: 42, color: "#9f4f6b", align: "center", font: "script" },
        { id: "message", type: "text", text: "{text}", x: 1560, y: 610, fontSize: 34, color: "#a9687e", align: "center", font: "handwritten" },
        { id: "date", type: "text", text: "{date}", x: 1560, y: 930, fontSize: 34, color: "#ba7890", align: "center", font: "elegant" },
        { id: "heart-2", type: "heart", x: 1535, y: 1000, w: 50, h: 45, color: "#d86d93", opacity: 1 }
      ]
    },
    {
      id: "editorial", name: "玫瑰杂志", background: "#8e3f5c", width: 1800, height: 1200, schemaVersion: 4,
      layers: [
        { id: "kicker", type: "text", text: "CELEBRATE THE MOMENT", x: 80, y: 105, fontSize: 28, color: "#f2c5d4", align: "left", font: "elegant" },
        { id: "title", type: "text", text: "{event}", x: 80, y: 240, fontSize: 82, color: "#fff7fa", align: "left", font: "script" },
        { id: "message", type: "text", text: "{text}", x: 80, y: 440, fontSize: 34, color: "#f4d7e1", align: "left", font: "handwritten" },
        { id: "date", type: "text", text: "{date}", x: 80, y: 1040, fontSize: 34, color: "#f2c5d4", align: "left", font: "elegant" },
        { id: "photo-1", type: "photo", photoIndex: 0, x: 590, y: 55, w: 1155, h: 1090, radius: 18, borderColor: "#ffdce8", borderWidth: 6 }
      ]
    },
    {
      id: "triple", name: "甜心三连拍", background: "#fff7fa", width: 1800, height: 1200, schemaVersion: 4,
      layers: [
        { id: "photo-1", type: "photo", photoIndex: 0, x: 45, y: 45, w: 540, h: 865, radius: 25, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-2", type: "photo", photoIndex: 1, x: 630, y: 45, w: 540, h: 865, radius: 25, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-3", type: "photo", photoIndex: 2, x: 1215, y: 45, w: 540, h: 865, radius: 25, borderColor: "#ffffff", borderWidth: 8 },
        { id: "title", type: "text", text: "{event}", x: 900, y: 1000, fontSize: 68, color: "#a64f6c", align: "center", font: "script" },
        { id: "date", type: "text", text: "{date}", x: 900, y: 1110, fontSize: 32, color: "#d36f92", align: "center", font: "elegant" }
      ]
    },
    {
      id: "four-grid", name: "爱心四格", background: "#f8dfe8", width: 1800, height: 1200, schemaVersion: 4,
      layers: [
        { id: "photo-1", type: "photo", photoIndex: 0, x: 40, y: 40, w: 700, h: 520, radius: 24, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-2", type: "photo", photoIndex: 1, x: 780, y: 40, w: 700, h: 520, radius: 24, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-3", type: "photo", photoIndex: 2, x: 40, y: 600, w: 700, h: 520, radius: 24, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-4", type: "photo", photoIndex: 3, x: 780, y: 600, w: 700, h: 520, radius: 24, borderColor: "#ffffff", borderWidth: 8 },
        { id: "heart", type: "heart", x: 1565, y: 95, w: 140, h: 125, color: "#b95778", opacity: 0.9 },
        { id: "title", type: "text", text: "{event}", x: 1630, y: 490, fontSize: 38, color: "#97455f", align: "center", font: "script" },
        { id: "date", type: "text", text: "{date}", x: 1630, y: 1010, fontSize: 30, color: "#a95872", align: "center", font: "elegant" }
      ]
    },
    {
      id: "portrait-classic", name: "竖版花语", background: "#fff2f6", width: 1200, height: 1800, schemaVersion: 4,
      layers: [
        { id: "photo-1", type: "photo", photoIndex: 0, x: 55, y: 55, w: 1090, h: 1330, radius: 35, borderColor: "#ffffff", borderWidth: 10 },
        { id: "heart", type: "heart", x: 525, y: 1430, w: 150, h: 135, color: "#df82a2", opacity: 0.9 },
        { id: "title", type: "text", text: "{event}", x: 600, y: 1605, fontSize: 58, color: "#a64f6c", align: "center", font: "script" },
        { id: "date", type: "text", text: "{date}", x: 600, y: 1730, fontSize: 30, color: "#bd738d", align: "center", font: "elegant" }
      ]
    },
    {
      id: "portrait-strip", name: "竖版三连拍", background: "#fff8fb", width: 1200, height: 1800, schemaVersion: 4,
      layers: [
        { id: "photo-1", type: "photo", photoIndex: 0, x: 55, y: 55, w: 1090, h: 420, radius: 22, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-2", type: "photo", photoIndex: 1, x: 55, y: 510, w: 1090, h: 420, radius: 22, borderColor: "#ffffff", borderWidth: 8 },
        { id: "photo-3", type: "photo", photoIndex: 2, x: 55, y: 965, w: 1090, h: 420, radius: 22, borderColor: "#ffffff", borderWidth: 8 },
        { id: "title", type: "text", text: "{event}", x: 600, y: 1530, fontSize: 58, color: "#a64f6c", align: "center", font: "script" },
        { id: "message", type: "text", text: "{text}", x: 600, y: 1640, fontSize: 30, color: "#a9687e", align: "center", font: "handwritten" },
        { id: "date", type: "text", text: "{date}", x: 600, y: 1740, fontSize: 28, color: "#bd738d", align: "center", font: "elegant" }
      ]
    }
  ];
}

async function readEvents() {
  await ensureData();
  return JSON.parse(await fsp.readFile(EVENTS_FILE, "utf8"));
}

async function writeEvents(events) {
  await fsp.writeFile(EVENTS_FILE, JSON.stringify(events, null, 2));
}

async function readTemplates() {
  await ensureData();
  return JSON.parse(await fsp.readFile(TEMPLATES_FILE, "utf8"));
}

async function writeTemplates(templates) {
  await fsp.writeFile(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("上传文件太大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
}

function publicDataPath(absolute) {
  return "/data/" + path.relative(DATA, absolute).split(path.sep).map(encodeURIComponent).join("/");
}

async function commandExists(command) {
  try {
    await execFileAsync("/usr/bin/which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function cameraStatus() {
  if (DEMO) return { ready: true, demo: true, message: "演示模式" };
  if (liveViewProcess) return lastCameraStatus;
  if (cameraBusy) return lastCameraStatus;
  cameraBusy = true;
  try {
    if (!(await commandExists("gphoto2"))) {
      lastCameraStatus = { ready: false, demo: false, name: "", message: "未检测到外接相机" };
      return lastCameraStatus;
    }
    const { stdout } = await execFileAsync("gphoto2", ["--auto-detect"], { timeout: 5000 });
    const detected = stdout.split("\n").map(line => line.trim()).find(line =>
      !/^Model\s+Port$/i.test(line) && !/^-+$/.test(line) && /\s{2,}(usb:|ptpip:|serial:)/i.test(line)
    );
    const name = detected ? detected.split(/\s{2,}(?=usb:|ptpip:|serial:)/i)[0].trim() : "";
    lastCameraStatus = {
      ready: Boolean(name),
      demo: false,
      name,
      message: name ? `${name} 已连接` : "未检测到外接相机"
    };
    return lastCameraStatus;
  } catch (error) {
    lastCameraStatus = { ready: false, demo: false, name: "", message: "未检测到外接相机" };
    return lastCameraStatus;
  } finally {
    cameraBusy = false;
  }
}

async function waitForCameraIdle(timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (cameraBusy && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  if (cameraBusy) throw new Error("相机正在处理实时预览，请稍后再试");
}

async function withCamera(task) {
  await stopLiveView();
  await waitForCameraIdle();
  cameraBusy = true;
  try { return await task(); } finally { cameraBusy = false; }
}

function consumeLiveViewData(chunk) {
  liveViewBuffer = Buffer.concat([liveViewBuffer, chunk]);
  while (liveViewBuffer.length > 0) {
    const start = liveViewBuffer.indexOf(Buffer.from([0xff, 0xd8]));
    if (start < 0) {
      liveViewBuffer = liveViewBuffer.subarray(Math.max(0, liveViewBuffer.length - 1));
      return;
    }
    const end = liveViewBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) {
      liveViewBuffer = liveViewBuffer.subarray(start);
      if (liveViewBuffer.length > 12 * 1024 * 1024) liveViewBuffer = Buffer.alloc(0);
      return;
    }
    latestLiveViewFrame = Buffer.from(liveViewBuffer.subarray(start, end + 2));
    liveViewBuffer = liveViewBuffer.subarray(end + 2);
  }
}

async function startLiveView() {
  if (DEMO || cameraBusy || liveViewProcess) return;
  if (Date.now() - liveViewLastStartAt < 450) return;
  liveViewLastStartAt = Date.now();
  if (!(await commandExists("gphoto2"))) return;
  if (cameraBusy || liveViewProcess) return;
  liveViewBuffer = Buffer.alloc(0);
  const child = spawn("gphoto2", ["--stdout", "--capture-movie"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });
  liveViewProcess = child;
  child.stdout.on("data", consumeLiveViewData);
  child.stderr.on("data", () => {});
  child.on("error", () => {
    if (liveViewProcess === child) liveViewProcess = null;
  });
  child.on("exit", () => {
    if (liveViewProcess === child) liveViewProcess = null;
    latestLiveViewFrame = null;
    liveViewBuffer = Buffer.alloc(0);
  });
}

async function stopLiveView() {
  clearTimeout(liveViewIdleTimer);
  const child = liveViewProcess;
  liveViewProcess = null;
  latestLiveViewFrame = null;
  liveViewBuffer = Buffer.alloc(0);
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    child.once("exit", done);
    child.kill("SIGINT");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      done();
    }, 700);
  });
}

function keepLiveViewAlive() {
  clearTimeout(liveViewIdleTimer);
  liveViewIdleTimer = setTimeout(() => {
    stopLiveView().catch(() => {});
  }, 3500);
}

async function capturePhoto(eventId, simulate = false) {
  const dir = path.join(DATA, "photos", safeId(eventId));
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `${stamp}-${crypto.randomBytes(3).toString("hex")}.jpg`);
  if (DEMO || simulate) {
    await execFileAsync("python3", [path.join(ROOT, "scripts", "composite.py"), "--demo-photo", target]);
  } else {
    if (!(await commandExists("gphoto2"))) throw new Error("未安装 gPhoto2，请先运行安装步骤");
    await execFileAsync("gphoto2", [
      "--capture-image-and-download", "--force-overwrite", "--filename", target
    ], { timeout: 45000, maxBuffer: 1024 * 1024 });
  }
  return target;
}

async function compose(event, shotPaths, template) {
  const dir = path.join(DATA, "photos", safeId(event.id));
  const output = path.join(dir, `final-${Date.now()}.jpg`);
  const args = [
    path.join(ROOT, "scripts", "composite.py"),
    "--output", output,
    "--event", event.name || "",
    "--date", event.date || "",
    "--text", event.text || ""
  ];
  for (const shot of shotPaths) args.push("--photo", shot);
  if (template) args.push("--design", JSON.stringify(template));
  else if (event.template) args.push("--template", path.join(DATA, event.template));
  await execFileAsync("python3", args, { timeout: 30000, maxBuffer: 1024 * 1024 });
  return output;
}

async function listPrinters() {
  try {
    const { stdout } = await execFileAsync("lpstat", ["-p"], { timeout: 5000 });
    return stdout.split("\n")
      .map(line => (line.match(/^printer\s+(\S+)/) || [])[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/live-view") {
    if (cameraBusy) {
      res.writeHead(409, { "Cache-Control": "no-store" });
      return res.end();
    }
    keepLiveViewAlive();
    await startLiveView();
    if (latestLiveViewFrame) {
      const frame = latestLiveViewFrame;
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": frame.length,
        "Cache-Control": "no-store, no-cache, must-revalidate"
      });
      return res.end(frame);
    }
    res.writeHead(503, { "Cache-Control": "no-store", "Retry-After": "1" });
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, { camera: await cameraStatus(), printers: await listPrinters(), busy: cameraBusy, demo: DEMO });
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    return json(res, 200, await readEvents());
  }
  if (req.method === "GET" && url.pathname === "/api/templates") {
    return json(res, 200, await readTemplates());
  }
  if (req.method === "POST" && url.pathname === "/api/templates") {
    const incoming = await body(req);
    const templates = await readTemplates();
    const id = safeId(incoming.id) || `template-${Date.now()}`;
    const template = {
      id,
      name: String(incoming.name || "未命名模版").slice(0, 80),
      background: /^#[0-9a-f]{6}$/i.test(incoming.background) ? incoming.background : "#ffffff",
      width: Number(incoming.width) === 1200 && Number(incoming.height) === 1800 ? 1200 : 1800,
      height: Number(incoming.width) === 1200 && Number(incoming.height) === 1800 ? 1800 : 1200,
      schemaVersion: 4,
      layers: Array.isArray(incoming.layers) ? incoming.layers.slice(0, 80) : []
    };
    const index = templates.findIndex(item => item.id === id);
    if (index >= 0) templates[index] = template; else templates.push(template);
    await writeTemplates(templates);
    return json(res, 200, template);
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/templates/")) {
    const id = safeId(url.pathname.split("/").pop());
    const templates = await readTemplates();
    if (templates.length <= 1) return json(res, 400, { error: "至少保留一套模版" });
    await writeTemplates(templates.filter(item => item.id !== id));
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/events") {
    const incoming = await body(req);
    const events = await readEvents();
    const id = safeId(incoming.id || incoming.name.toLowerCase().replace(/\s+/g, "-")) || crypto.randomUUID();
    const event = {
      id,
      name: String(incoming.name || "Your Celebration"),
      date: String(incoming.date || ""),
      text: String(incoming.text || ""),
      countdown: Math.min(10, Math.max(1, Number(incoming.countdown) || 3)),
      captureSource: ["auto", "camera", "webcam"].includes(incoming.captureSource) ? incoming.captureSource : "auto",
      shotCount: Math.min(6, Math.max(1, Number(incoming.shotCount) || 1)),
      printer: String(incoming.printer || ""),
      template: String(incoming.template || ""),
      activeTemplateId: safeId(incoming.activeTemplateId || "classic")
    };
    const index = events.findIndex(item => item.id === id);
    if (index >= 0) events[index] = event; else events.push(event);
    await writeEvents(events);
    return json(res, 200, event);
  }
  if (req.method === "POST" && url.pathname === "/api/template") {
    const incoming = await body(req);
    const eventId = safeId(incoming.eventId);
    const match = String(incoming.data || "").match(/^data:image\/png;base64,(.+)$/);
    if (!eventId || !match) return json(res, 400, { error: "只接受 PNG 模版" });
    const relative = path.join("templates", `${eventId}.png`);
    await fsp.writeFile(path.join(DATA, relative), Buffer.from(match[1], "base64"));
    return json(res, 200, { template: relative, url: publicDataPath(path.join(DATA, relative)) });
  }
  if (req.method === "POST" && url.pathname === "/api/assets") {
    const incoming = await body(req);
    const match = String(incoming.data || "").match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!match) return json(res, 400, { error: "只接受 PNG 或 JPEG 图片" });
    const extension = match[1] === "jpeg" ? "jpg" : "png";
    const file = path.join(DATA, "assets", `${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${extension}`);
    await fsp.writeFile(file, Buffer.from(match[2], "base64"));
    return json(res, 200, { src: publicDataPath(file) });
  }
  if (req.method === "POST" && url.pathname === "/api/capture") {
    const incoming = await body(req);
    try {
      const photo = await withCamera(() => capturePhoto(incoming.eventId, Boolean(incoming.simulate)));
      if (incoming.resumeLiveView && !incoming.simulate) {
        keepLiveViewAlive();
        startLiveView().catch(() => {});
      }
      return json(res, 200, { photo: publicDataPath(photo) });
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/webcam") {
    const incoming = await body(req);
    const eventId = safeId(incoming.eventId);
    const match = String(incoming.data || "").match(/^data:image\/(jpeg|png);base64,(.+)$/);
    if (!eventId || !match) return json(res, 400, { error: "Webcam 照片格式无效" });
    const extension = match[1] === "png" ? "png" : "jpg";
    const dir = path.join(DATA, "photos", eventId);
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, `webcam-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${extension}`);
    await fsp.writeFile(target, Buffer.from(match[2], "base64"));
    return json(res, 200, { photo: publicDataPath(target) });
  }
  if (req.method === "POST" && url.pathname === "/api/compose") {
    const incoming = await body(req);
    const events = await readEvents();
    const event = events.find(item => item.id === incoming.eventId);
    if (!event) return json(res, 404, { error: "找不到活动" });
    const templates = await readTemplates();
    const template = templates.find(item => item.id === event.activeTemplateId) || templates[0];
    const shots = (incoming.photos || []).map(value => {
      const relative = decodeURIComponent(String(value).replace(/^\/data\//, ""));
      const absolute = path.resolve(DATA, relative);
      if (!absolute.startsWith(DATA + path.sep)) throw new Error("照片路径无效");
      return absolute;
    });
    const output = await compose(event, shots, template);
    return json(res, 200, { image: publicDataPath(output) });
  }
  if (req.method === "POST" && url.pathname === "/api/print") {
    const incoming = await body(req);
    const relative = decodeURIComponent(String(incoming.image || "").replace(/^\/data\//, ""));
    const image = path.resolve(DATA, relative);
    if (!image.startsWith(DATA + path.sep) || !fs.existsSync(image)) return json(res, 400, { error: "照片无效" });
    const args = [];
    if (incoming.printer) args.push("-d", String(incoming.printer));
    args.push("-o", "fit-to-page", image);
    try {
      const { stdout } = await execFileAsync("lp", args, { timeout: 10000 });
      return json(res, 200, { ok: true, message: stdout.trim() || "已加入打印队列" });
    } catch (error) {
      return json(res, 500, { error: `打印失败：${error.message}` });
    }
  }
  return json(res, 404, { error: "Not found" });
}

async function serveFile(res, file) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error("not file");
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": file.includes(`${path.sep}data${path.sep}`) ? "no-store" : "public, max-age=60"
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname.startsWith("/data/")) {
      const relative = decodeURIComponent(url.pathname.slice(6));
      const file = path.resolve(DATA, relative);
      if (!file.startsWith(DATA + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
      return serveFile(res, file);
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, requested);
    if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, "index.html")) {
      res.writeHead(403); return res.end("Forbidden");
    }
    return serveFile(res, file);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "服务器错误" });
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopLiveView().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

ensureData().then(() => server.listen(PORT, "0.0.0.0", () => {
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter(item => item && item.family === "IPv4" && !item.internal)
    .map(item => `http://${item.address}:${PORT}`);
  console.log(`\nPicBooth by KJ 已启动`);
  console.log(`本机：http://localhost:${PORT}`);
  addresses.forEach(address => console.log(`iPad：${address}`));
  console.log(DEMO ? "模式：演示（不需要相机）\n" : "模式：现场\n");
  if (process.env.AUTO_OPEN === "1") {
    execFile("/usr/bin/open", [`http://localhost:${PORT}`], () => {});
  }
}));
