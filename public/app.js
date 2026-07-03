const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const state = {
  event: null, status: null, templates: [], result: "", busy: false,
  editing: null, selectedLayerId: "", drag: null, imageCache: new Map(),
  templateFilter: "all",
  webcam: { stream: null, ready: false, attempted: false, error: "" },
  liveView: {
    active: false, available: false, paused: false, timer: null,
    failures: 0, requestInFlight: false, objectUrl: "", frameVersion: 0
  },
  shotProgress: { active: false, current: 0, total: 0 }
};

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

function showMessage(text) { $("#message").textContent = text || ""; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`; }
function photoCount(template) {
  return Math.max(1, ...template.layers.filter(layer => layer.type === "photo").map(layer => Number(layer.photoIndex) + 1));
}
function templateOrientation(template) {
  return Number(template?.height) > Number(template?.width) ? "portrait" : "landscape";
}
function templateSize(template = state.editing) {
  return {
    width: Number(template?.width) || 1800,
    height: Number(template?.height) || 1200
  };
}
function capturePreference() {
  return ["auto", "camera", "webcam"].includes(state.event?.captureSource) ? state.event.captureSource : "auto";
}
function captureMode() {
  const preference = capturePreference();
  if (preference === "camera") return state.status?.camera.ready ? "camera" : "unavailable";
  if (preference === "webcam") return state.webcam.ready ? "webcam" : "unavailable";
  if (state.status?.camera.ready) return "camera";
  if (state.webcam.ready) return "webcam";
  return "test";
}
async function syncCaptureSource(retryWebcam = false) {
  const preference = capturePreference();
  if (preference === "camera" || (preference === "auto" && state.status.camera.ready)) {
    stopWebcam(true);
    return;
  }
  await startWebcam(retryWebcam);
}

async function load() {
  const [events, status, templates] = await Promise.all([
    request("/api/events"), request("/api/status"), request("/api/templates")
  ]);
  state.event = events[0];
  state.event.downloadName = savedDownloadName(state.event);
  state.status = status;
  state.templates = templates;
  if (!state.event.activeTemplateId) state.event.activeTemplateId = templates[0]?.id || "";
  render();
  await syncCaptureSource();
}

async function refreshStatus() {
  if (state.busy || !state.status) return;
  try {
    state.status = await request("/api/status");
    await syncCaptureSource();
    render();
  } catch {
    // Keep the last known state during a brief connection interruption.
  }
}

function render() {
  if (!state.status || !state.event) return;
  const camera = state.status.camera;
  const mode = captureMode();
  const webcamReady = mode === "webcam";
  const hasPrinter = state.status.printers.length > 0;
  $("#appTitle").textContent = state.event.name || "Your Celebration";
  document.title = `${state.event.name || "Your Event"} · PicBooth by KJ`;
  $("#cameraStatus").textContent = mode === "camera"
    ? `${camera.message}${state.liveView.failures >= 3 ? " · Live View 暂不可用" : ""}`
    : mode === "webcam"
      ? "Mac Webcam 已启用"
      : capturePreference() === "camera"
        ? "外接相机未连接"
        : capturePreference() === "webcam"
          ? state.webcam.error || "正在启用 Mac Webcam…"
          : state.webcam.error || "未检测到相机 · 可使用测试画面";
  $("#cameraStatus").classList.toggle("ready", mode === "camera" || mode === "webcam");
  const template = state.templates.find(item => item.id === state.event.activeTemplateId);
  renderCaptureTemplateList();
  renderSelectedTemplatePreview(template);
  $("#captureStage").classList.remove("portrait");
  $("#captureStage").classList.add("landscape");
  $("#stageBadge").textContent = "6 INCH · LANDSCAPE";
  $("#shotProgress").textContent = `第 ${state.shotProgress.current} 张 / 共 ${state.shotProgress.total} 张`;
  $("#shotProgress").classList.toggle("hidden", !state.shotProgress.active);
  $("#eventLabel").textContent = `${state.event.date || ""}${template ? ` · ${template.name}` : ""}`;
  $("#captureButton").disabled = state.busy || mode === "unavailable";
  $("#captureButton").lastChild.textContent = mode === "camera"
    ? "使用外接相机拍照"
    : mode === "webcam"
      ? "使用 Webcam 拍照"
      : mode === "unavailable"
        ? "所选相机未连接"
        : "测试拍照";
  $("#captureButton").classList.toggle("hidden", Boolean(state.result));
  $("#resultActions").classList.toggle("hidden", !state.result);
  $("#printButton").disabled = !hasPrinter;
  $("#printButton").title = hasPrinter ? "打印当前照片" : "未检测到打印机";
  $("#resultImage").classList.toggle("visible", Boolean(state.result));
  $("#webcamPreview").classList.toggle("visible", webcamReady && !state.result);
  const externalPreviewVisible = mode === "camera" && state.liveView.available && !state.result;
  $("#externalCameraPreview").classList.toggle("visible", externalPreviewVisible);
  $("#emptyStage").classList.toggle("hidden", Boolean(state.result) || webcamReady || externalPreviewVisible);
  if (state.result) $("#resultImage").src = `${state.result}?t=${Date.now()}`;
  syncExternalLiveView();
}

function syncExternalLiveView() {
  const shouldRun = captureMode() === "camera" && !state.result && !state.liveView.paused;
  if (shouldRun) startExternalLiveView();
  else stopExternalLiveView(Boolean(state.result) || captureMode() !== "camera");
}

function startExternalLiveView() {
  if (state.liveView.active) return;
  state.liveView.active = true;
  requestExternalLiveViewFrame();
}

async function requestExternalLiveViewFrame() {
  if (!state.liveView.active || state.liveView.requestInFlight) return;
  state.liveView.requestInFlight = true;
  try {
    const response = await fetch(`/api/live-view?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Live View 尚未准备好");
    const blob = await response.blob();
    const nextUrl = URL.createObjectURL(blob);
    const loader = new Image();
    loader.src = nextUrl;
    await loader.decode();
    if (!state.liveView.active) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    const previousUrl = state.liveView.objectUrl;
    state.liveView.objectUrl = nextUrl;
    state.liveView.available = true;
    state.liveView.failures = 0;
    state.liveView.frameVersion += 1;
    const preview = $("#externalCameraPreview");
    preview.src = nextUrl;
    preview.classList.add("visible");
    $("#emptyStage").classList.add("hidden");
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    scheduleExternalLiveView(140);
  } catch {
    externalLiveViewFailed();
  } finally {
    state.liveView.requestInFlight = false;
  }
}

function scheduleExternalLiveView(delay) {
  clearTimeout(state.liveView.timer);
  state.liveView.timer = setTimeout(requestExternalLiveViewFrame, delay);
}

function pauseExternalLiveView() {
  state.liveView.paused = true;
  state.liveView.active = false;
  clearTimeout(state.liveView.timer);
}

function resumeExternalLiveView() {
  state.liveView.paused = false;
  if (captureMode() === "camera" && !state.result) startExternalLiveView();
}

async function waitForFreshExternalLiveView(previousVersion, timeout = 3200) {
  const deadline = Date.now() + timeout;
  while (
    state.liveView.active &&
    state.liveView.frameVersion <= previousVersion &&
    Date.now() < deadline
  ) {
    await sleep(70);
  }
  return state.liveView.frameVersion > previousVersion;
}

function stopExternalLiveView(clearFrame = true) {
  state.liveView.active = false;
  clearTimeout(state.liveView.timer);
  if (!clearFrame) return;
  state.liveView.available = false;
  state.liveView.failures = 0;
  const preview = $("#externalCameraPreview");
  preview.classList.remove("visible");
  preview.removeAttribute("src");
  if (state.liveView.objectUrl) URL.revokeObjectURL(state.liveView.objectUrl);
  state.liveView.objectUrl = "";
}

function externalLiveViewFailed() {
  if (!state.liveView.active) return;
  state.liveView.failures += 1;
  if (!state.liveView.available) {
    $("#externalCameraPreview").classList.remove("visible");
    if (!state.result && captureMode() === "camera") $("#emptyStage").classList.remove("hidden");
  }
  if (state.liveView.failures === 3) {
    $("#cameraStatus").textContent = `${state.status.camera.message} · Live View 暂不可用`;
  }
  scheduleExternalLiveView(Math.min(1800, 450 + state.liveView.failures * 180));
}

function renderCaptureTemplateList() {
  const container = $("#captureTemplateList");
  if (!container) return;
  container.innerHTML = state.templates.map(template => {
    const selected = template.id === state.event.activeTemplateId;
    const count = photoCount(template);
    return `
      <button class="capture-template-option ${selected ? "selected" : ""}"
        data-capture-template-id="${escapeHtml(template.id)}" ${state.busy ? "disabled" : ""}>
        <span class="capture-template-swatch" style="background:${escapeHtml(template.background || "#dc789d")}">♡</span>
        <span>
          <strong>${escapeHtml(template.name)}</strong>
          <small>${templateOrientation(template) === "portrait" ? "竖版" : "横版"} · ${count} 张</small>
        </span>
      </button>`;
  }).join("");
}

function renderSelectedTemplatePreview(template) {
  if (!template) return;
  const size = templateSize(template);
  const canvas = $("#captureTemplatePreview");
  const portrait = templateOrientation(template) === "portrait";
  canvas.width = portrait ? 100 : 180;
  canvas.height = portrait ? 150 : 120;
  canvas.style.aspectRatio = `${size.width} / ${size.height}`;
  const context = canvas.getContext("2d");
  const scale = canvas.width / size.width;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = template.background || "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  template.layers.forEach(layer => drawLayer(context, layer));
  $("#capturePreviewMeta").textContent = `${portrait ? "竖版" : "横版"} · ${photoCount(template)} 张`;
  canvas.setAttribute("aria-label", `${template.name}模版预览`);
}

async function chooseCaptureTemplate(templateId) {
  if (state.busy || templateId === state.event.activeTemplateId) return;
  const template = state.templates.find(item => item.id === templateId);
  if (!template) return;
  try {
    await saveEvent({ activeTemplateId: templateId });
    state.result = "";
    state.liveView.paused = false;
    render();
    showMessage(`已选择「${template.name}」· 将拍摄 ${photoCount(template)} 张`);
  } catch (error) {
    showMessage(error.message);
  }
}

async function startWebcam(retry = false) {
  if (state.webcam.stream) return;
  if (retry) {
    state.webcam.attempted = false;
    state.webcam.error = "";
  }
  if (state.webcam.attempted) return;
  state.webcam.attempted = true;
  state.webcam.error = "";
  render();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("浏览器不支持 Webcam");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1800 },
        height: { ideal: 1200 },
        aspectRatio: { ideal: 1.5 },
        facingMode: "user"
      },
      audio: false
    });
    state.webcam.stream = stream;
    const video = $("#webcamPreview");
    video.srcObject = stream;
    await video.play();
    state.webcam.ready = true;
  } catch (error) {
    state.webcam.error = error?.name === "NotAllowedError" ? "Webcam 权限未开启" : (error?.message || "Webcam 无法使用");
    showMessage(`${state.webcam.error}，仍可使用测试画面`);
  }
  render();
}

function stopWebcam(resetAttempt = false) {
  state.webcam.stream?.getTracks().forEach(track => track.stop());
  state.webcam.stream = null;
  state.webcam.ready = false;
  $("#webcamPreview").srcObject = null;
  if (resetAttempt) {
    state.webcam.attempted = false;
    state.webcam.error = "";
  }
}

async function captureWebcamPhoto() {
  const video = $("#webcamPreview");
  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  if (!state.webcam.ready || !video.videoWidth) throw new Error("Webcam 画面尚未准备好");
  const width = 1800;
  const height = 1200;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#1b1017";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  context.restore();
  return request("/api/webcam", {
    method: "POST",
    body: JSON.stringify({
      eventId: state.event.id,
      data: canvas.toDataURL("image/jpeg", 0.94)
    })
  });
}

async function countDown(seconds) {
  const node = $("#countdown");
  const number = $("#countdown span");
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.body.classList.add("countdown-mode");
  try {
    for (let value = seconds; value > 0; value--) {
      number.textContent = value;
      node.classList.remove("visible");
      void node.offsetWidth;
      node.classList.add("visible");
      await sleep(1000);
    }
    node.classList.remove("visible");
  } finally {
    document.body.classList.remove("countdown-mode");
  }
}

async function captureSession() {
  if (state.busy) return;
  state.busy = true;
  state.result = "";
  const photos = [];
  const selected = state.templates.find(item => item.id === state.event.activeTemplateId);
  const required = selected ? photoCount(selected) : state.event.shotCount;
  state.shotProgress = { active: true, current: 1, total: required };
  state.liveView.paused = false;
  render();
  try {
    for (let i = 0; i < required; i++) {
      if (i === 0) resumeExternalLiveView();
      state.shotProgress.current = i + 1;
      render();
      showMessage(required > 1 ? `准备第 ${i + 1} / ${required} 张` : "准备好了吗？");
      await countDown(state.event.countdown);
      showMessage("正在拍摄…");
      const mode = captureMode();
      if (mode === "unavailable") throw new Error("所选拍摄工具尚未连接");
      const frameBeforeCapture = state.liveView.frameVersion;
      if (mode === "camera") {
        pauseExternalLiveView();
        await sleep(80);
      }
      const result = mode === "camera"
        ? await request("/api/capture", {
          method: "POST",
          body: JSON.stringify({
            eventId: state.event.id,
            simulate: false,
            resumeLiveView: i < required - 1
          })
        })
        : mode === "webcam"
          ? await captureWebcamPhoto()
          : await request("/api/capture", {
            method: "POST", body: JSON.stringify({ eventId: state.event.id, simulate: true })
          });
      photos.push(result.photo);
      if (i < required - 1) {
        if (mode === "camera") {
          showMessage(`正在准备第 ${i + 2} / ${required} 张实时画面…`);
          resumeExternalLiveView();
          await waitForFreshExternalLiveView(frameBeforeCapture);
        }
        await sleep(120);
      }
    }
    showMessage("正在套用模版…");
    const composed = await request("/api/compose", {
      method: "POST", body: JSON.stringify({ eventId: state.event.id, photos })
    });
    state.result = composed.image;
    showMessage("完成！喜欢的话就打印吧");
  } catch (error) {
    showMessage(error.message);
  } finally {
    document.body.classList.remove("countdown-mode");
    state.shotProgress.active = false;
    state.busy = false;
    if (!state.result) resumeExternalLiveView();
    render();
  }
}

function showOnly(view) {
  ["#boothView", "#settingsView", "#designerView"].forEach(selector => $(selector).classList.add("hidden"));
  $(view).classList.remove("hidden");
  document.body.classList.toggle("designer-open", view === "#designerView");
}

function openSettings() {
  const event = state.event;
  $("#eventName").value = event.name;
  $("#eventDate").value = event.date;
  $("#eventText").value = event.text;
  $("#downloadName").value = event.downloadName || "picbooth";
  updateDownloadNameHint();
  $("#countdownSeconds").value = event.countdown;
  $("#captureSourceSelect").value = capturePreference();
  $("#activeTemplateSelect").innerHTML = state.templates.map(template =>
    `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}（${templateOrientation(template) === "portrait" ? "竖版" : "横版"} · ${photoCount(template)} 张）</option>`
  ).join("");
  $("#activeTemplateSelect").value = event.activeTemplateId;
  $("#printerSelect").innerHTML = '<option value="">系统默认打印机</option>' +
    state.status.printers.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  $("#printerSelect").value = event.printer || "";
  showOnly("#settingsView");
}

async function saveEvent(extra = {}) {
  const selectedId = extra.activeTemplateId || $("#activeTemplateSelect")?.value || state.event.activeTemplateId;
  const selected = state.templates.find(item => item.id === selectedId);
  const fromSettings = !$("#settingsView").classList.contains("hidden");
  state.event = await request("/api/events", {
    method: "POST",
    body: JSON.stringify({
      ...state.event,
      name: extra.name ?? (fromSettings ? $("#eventName").value : state.event.name),
      date: extra.date ?? (fromSettings ? $("#eventDate").value : state.event.date),
      text: extra.text ?? (fromSettings ? $("#eventText").value : state.event.text),
      countdown: extra.countdown ?? (fromSettings ? Number($("#countdownSeconds").value) : state.event.countdown),
      captureSource: extra.captureSource ?? (fromSettings ? $("#captureSourceSelect").value : capturePreference()),
      printer: extra.printer ?? (fromSettings ? $("#printerSelect").value : state.event.printer),
      activeTemplateId: selectedId,
      shotCount: selected ? photoCount(selected) : state.event.shotCount
    })
  });
  return state.event;
}

async function saveSettings() {
  try {
    const downloadName = safeDownloadBaseName($("#downloadName").value);
    await saveEvent();
    saveDownloadName(state.event.id, downloadName);
    state.event.downloadName = downloadName;
    await syncCaptureSource(true);
    state.result = "";
    state.liveView.paused = false;
    showOnly("#boothView");
    render();
    showMessage("设置已保存");
  } catch (error) {
    alert(error.message);
  }
}

async function printResult() {
  if (!state.result) return;
  if (state.status.printers.length === 0) {
    showMessage("未检测到打印机，请先连接或添加打印机");
    return;
  }
  showMessage("正在送往打印机…");
  try {
    const result = await request("/api/print", {
      method: "POST",
      body: JSON.stringify({ image: state.result, printer: state.event.printer })
    });
    showMessage(result.message || "已加入打印队列");
  } catch (error) {
    showMessage(error.message);
  }
}

function safeDownloadBaseName(value) {
  return String(value || "picbooth")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || "picbooth";
}

function downloadNameKey(eventId) {
  return `picbooth:download-name:${eventId || "event"}`;
}

function savedDownloadName(event) {
  try {
    return safeDownloadBaseName(localStorage.getItem(downloadNameKey(event?.id)) || event?.downloadName);
  } catch {
    return safeDownloadBaseName(event?.downloadName);
  }
}

function saveDownloadName(eventId, value) {
  try {
    localStorage.setItem(downloadNameKey(eventId), safeDownloadBaseName(value));
  } catch {
    // The current page can still use the name when browser storage is unavailable.
  }
}

function downloadBaseName() {
  return safeDownloadBaseName(state.event?.downloadName);
}

function downloadCounterKey(base = downloadBaseName()) {
  return `picbooth:download-counter:${state.event?.id || "event"}:${safeDownloadBaseName(base)}`;
}

function nextDownloadNumber(base = downloadBaseName()) {
  try {
    return Math.max(0, Number(localStorage.getItem(downloadCounterKey(base))) || 0) + 1;
  } catch {
    return 1;
  }
}

function resultFilename(base = downloadBaseName()) {
  const safeBase = safeDownloadBaseName(base);
  return `${safeBase}_${String(nextDownloadNumber(safeBase)).padStart(4, "0")}.jpg`;
}

function commitDownloadNumber(base = downloadBaseName()) {
  try {
    const safeBase = safeDownloadBaseName(base);
    localStorage.setItem(downloadCounterKey(safeBase), String(nextDownloadNumber(safeBase)));
  } catch {
    // Downloads still work when browser storage is unavailable.
  }
}

function updateDownloadNameHint() {
  const base = safeDownloadBaseName($("#downloadName").value);
  $("#downloadNameHint").textContent = `下一张照片：${resultFilename(base)}`;
}

function downloadResult() {
  if (!state.result) return;
  const filename = resultFilename();
  const link = document.createElement("a");
  link.href = state.result;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  commitDownloadNumber();
  showMessage(`${filename} 已开始下载`);
}

async function shareResult() {
  if (!state.result) return;
  try {
    const response = await fetch(state.result);
    if (!response.ok) throw new Error("无法读取照片");
    const blob = await response.blob();
    const filename = resultFilename();
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({
        title: "PicBooth by KJ",
        text: state.event.name || "PicBooth",
        files: [file]
      });
      commitDownloadNumber();
      showMessage("分享面板已打开，可选择 AirDrop");
    } else {
      downloadResult();
      showMessage("此浏览器不支持直接分享，已改为下载照片");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showMessage(error.message || "分享失败");
  }
}

function openDesigner(templateId = state.event.activeTemplateId) {
  const template = state.templates.find(item => item.id === templateId) || state.templates[0];
  state.editing = clone(template);
  state.selectedLayerId = "";
  showOnly("#designerView");
  renderTemplateList();
  renderDesigner();
}

function renderTemplateList() {
  const visible = state.templates.filter(template =>
    state.templateFilter === "all" || templateOrientation(template) === state.templateFilter
  );
  $("#templateList").innerHTML = visible.map(template => `
    <button class="template-card ${state.editing?.id === template.id ? "selected" : ""}" data-template-id="${escapeHtml(template.id)}">
      <span class="template-swatch ${templateOrientation(template)}" style="background:${escapeHtml(template.background)}">${photoCount(template)} 张</span>
      <span><strong>${escapeHtml(template.name)}</strong><small>${templateOrientation(template) === "portrait" ? "竖版" : "横版"} · ${template.layers.length} 个图层</small></span>
    </button>
  `).join("");
}

function selectTemplate(id) {
  const template = state.templates.find(item => item.id === id);
  if (!template) return;
  state.editing = clone(template);
  state.selectedLayerId = "";
  renderTemplateList();
  renderDesigner();
}

function resolvedText(text) {
  return String(text || "")
    .replaceAll("{event}", state.event.name)
    .replaceAll("{date}", state.event.date)
    .replaceAll("{text}", state.event.text);
}

function canvasFontFamily(font) {
  return {
    script: '"Snell Roundhand", "Apple Chancery", cursive',
    elegant: 'Didot, Baskerville, "Times New Roman", serif',
    handwritten: '"Kaiti SC", "Songti SC", "Apple Chancery", cursive',
    display: 'Zapfino, Didot, serif',
    serif: 'Baskerville, Georgia, "Songti SC", serif',
    sans: '"Avenir Next", "PingFang SC", Arial, sans-serif'
  }[font] || '"Avenir Next", "PingFang SC", Arial, sans-serif';
}

function roundedPath(ctx, x, y, w, h, radius) {
  const r = Math.min(Math.max(0, radius || 0), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function layerBounds(layer, ctx) {
  if (layer.type === "text") {
    ctx.save();
    ctx.font = `${layer.fontSize || 42}px ${canvasFontFamily(layer.font)}`;
    const lines = resolvedText(layer.text).split("\n");
    const width = Math.max(100, ...lines.map(line => ctx.measureText(line || " ").width));
    const lineHeight = (layer.fontSize || 42) * 1.25;
    const height = Math.max(lineHeight, lines.length * lineHeight);
    ctx.restore();
    const x = layer.align === "left" ? layer.x : layer.align === "right" ? layer.x - width : layer.x - width / 2;
    return { x, y: layer.y - height / 2, w: width, h: height };
  }
  return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
}

function loadCanvasImage(src) {
  if (!src) return null;
  if (state.imageCache.has(src)) return state.imageCache.get(src);
  const image = new Image();
  image.onload = () => {
    renderDesigner();
    const selected = state.templates.find(template => template.id === state.event?.activeTemplateId);
    renderSelectedTemplatePreview(selected);
  };
  image.src = src;
  state.imageCache.set(src, image);
  return image;
}

function drawLayer(ctx, layer) {
  if (layer.type === "photo") {
    ctx.save();
    roundedPath(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius);
    ctx.clip();
    const gradient = ctx.createLinearGradient(layer.x, layer.y, layer.x + layer.w, layer.y + layer.h);
    gradient.addColorStop(0, "#c9aaa0");
    gradient.addColorStop(1, "#7e665e");
    ctx.fillStyle = gradient;
    ctx.fillRect(layer.x, layer.y, layer.w, layer.h);
    ctx.fillStyle = "#ffffffdd";
    ctx.font = "600 38px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`照片 ${Number(layer.photoIndex) + 1}`, layer.x + layer.w / 2, layer.y + layer.h / 2);
    ctx.restore();
    if (layer.borderWidth) {
      ctx.strokeStyle = layer.borderColor || "#ffffff";
      ctx.lineWidth = layer.borderWidth;
      roundedPath(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius);
      ctx.stroke();
    }
  } else if (layer.type === "text") {
    ctx.fillStyle = layer.color || "#333333";
    ctx.font = `${layer.fontSize || 42}px ${canvasFontFamily(layer.font)}`;
    ctx.textAlign = layer.align || "center";
    ctx.textBaseline = "middle";
    const lines = resolvedText(layer.text).split("\n");
    const lineHeight = (layer.fontSize || 42) * 1.25;
    const top = layer.y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => ctx.fillText(line || " ", layer.x, top + index * lineHeight));
  } else if (layer.type === "heart") {
    const x = layer.x, y = layer.y, w = layer.w, h = layer.h;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.fillStyle = layer.color || "#dc789d";
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h);
    ctx.bezierCurveTo(x + w * .42, y + h * .82, x, y + h * .58, x, y + h * .28);
    ctx.bezierCurveTo(x, y - h * .04, x + w * .42, y - h * .10, x + w / 2, y + h * .22);
    ctx.bezierCurveTo(x + w * .58, y - h * .10, x + w, y - h * .04, x + w, y + h * .28);
    ctx.bezierCurveTo(x + w, y + h * .58, x + w * .58, y + h * .82, x + w / 2, y + h);
    ctx.fill();
    ctx.restore();
  } else if (layer.type === "image") {
    const image = loadCanvasImage(layer.src);
    if (image?.complete) {
      ctx.save();
      ctx.globalAlpha = layer.opacity ?? 1;
      ctx.drawImage(image, layer.x, layer.y, layer.w, layer.h);
      ctx.restore();
    }
  }
}

function renderDesigner(refreshProperties = true) {
  if (!state.editing) return;
  $("#templateName").value = state.editing.name;
  $("#templateBackground").value = state.editing.background;
  $("#templateOrientation").value = templateOrientation(state.editing);
  const size = templateSize();
  const canvas = $("#designerCanvas");
  canvas.width = Math.round(size.width / 2);
  canvas.height = Math.round(size.height / 2);
  canvas.style.aspectRatio = `${size.width} / ${size.height}`;
  canvas.setAttribute("aria-label", `${templateOrientation(state.editing) === "portrait" ? "竖向" : "横向"}六寸模版画布`);
  $("#canvasHelp").textContent = `${templateOrientation(state.editing) === "portrait" ? "竖向" : "横向"} 6 寸 · ${size.width} × ${size.height} px　拖动图层改变位置；右下角调节大小。`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(.5, 0, 0, .5, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = state.editing.background;
  ctx.fillRect(0, 0, size.width, size.height);
  state.editing.layers.forEach(layer => drawLayer(ctx, layer));
  ctx.save();
  ctx.strokeStyle = "#ffffffaa";
  ctx.setLineDash([15, 12]);
  ctx.lineWidth = 3;
  ctx.strokeRect(35, 35, size.width - 70, size.height - 70);
  ctx.restore();
  const selected = state.editing.layers.find(layer => layer.id === state.selectedLayerId);
  if (selected) {
    const bounds = layerBounds(selected, ctx);
    ctx.save();
    ctx.strokeStyle = "#ff6b47";
    ctx.setLineDash([10, 7]);
    ctx.lineWidth = 5;
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#ff6b47";
    ctx.fillRect(bounds.x + bounds.w - 18, bounds.y + bounds.h - 18, 36, 36);
    ctx.restore();
  }
  if (refreshProperties) renderLayerProperties(selected);
}

function propertyInput(label, property, value, type = "number", extra = "") {
  return `<label>${label}<input data-layer-property="${property}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
}

function renderLayerProperties(layer) {
  const container = $("#layerProperties");
  if (!layer) {
    container.innerHTML = '<p class="property-empty">选择画布中的文字、照片框或图片进行调整。</p>';
    return;
  }
  const position = `<div class="property-grid">
    ${propertyInput("X", "x", Math.round(layer.x))}
    ${propertyInput("Y", "y", Math.round(layer.y))}
  </div>`;
  if (layer.type === "text") {
    container.innerHTML = `
      <h3>文字图层</h3>
      <label>内容（支持换行）<textarea data-layer-property="text" rows="3">${escapeHtml(layer.text)}</textarea></label>
      ${position}
      <div class="property-grid">
        ${propertyInput("字号", "fontSize", layer.fontSize, "number", 'min="10" max="240"')}
        ${propertyInput("颜色", "color", layer.color, "color")}
      </div>
      <label>字体<select data-layer-property="font">
        <option value="script" ${layer.font === "script" ? "selected" : ""}>艺术手写体</option>
        <option value="elegant" ${layer.font === "elegant" ? "selected" : ""}>高级 Didot</option>
        <option value="handwritten" ${layer.font === "handwritten" ? "selected" : ""}>中文艺术体</option>
        <option value="display" ${layer.font === "display" ? "selected" : ""}>装饰艺术体</option>
        <option value="serif" ${layer.font === "serif" ? "selected" : ""}>典雅衬线</option>
        <option value="sans" ${layer.font === "sans" ? "selected" : ""}>现代黑体</option>
      </select></label>
      <label>对齐<select data-layer-property="align">
        <option value="left" ${layer.align === "left" ? "selected" : ""}>左对齐</option>
        <option value="center" ${layer.align === "center" ? "selected" : ""}>居中</option>
        <option value="right" ${layer.align === "right" ? "selected" : ""}>右对齐</option>
      </select></label>`;
  } else {
    container.innerHTML = `
      <h3>${layer.type === "photo" ? "照片框" : layer.type === "heart" ? "爱心图层" : "图片图层"}</h3>
      ${position}
      <div class="property-grid">
        ${propertyInput("宽度", "w", Math.round(layer.w), "number", 'min="40" max="1800"')}
        ${propertyInput("高度", "h", Math.round(layer.h), "number", 'min="40" max="1800"')}
      </div>
      ${layer.type === "photo" ? `
        <div class="property-grid">
          ${propertyInput("照片编号", "photoIndex", Number(layer.photoIndex) + 1, "number", 'min="1" max="6" data-offset="-1"')}
          ${propertyInput("圆角", "radius", layer.radius || 0, "number", 'min="0" max="300"')}
        </div>
        <div class="property-grid">
          ${propertyInput("边框", "borderWidth", layer.borderWidth || 0, "number", 'min="0" max="80"')}
          ${propertyInput("边框颜色", "borderColor", layer.borderColor || "#ffffff", "color")}
        </div>` : layer.type === "heart" ? `
        <div class="property-grid">
          ${propertyInput("颜色", "color", layer.color || "#dc789d", "color")}
          ${propertyInput("透明度", "opacity", layer.opacity ?? 1, "number", 'min="0" max="1" step="0.05"')}
        </div>` : propertyInput("透明度", "opacity", layer.opacity ?? 1, "number", 'min="0" max="1" step="0.05"')}`;
  }
}

function canvasPoint(event) {
  const rect = $("#designerCanvas").getBoundingClientRect();
  const size = templateSize();
  return {
    x: (event.clientX - rect.left) * size.width / rect.width,
    y: (event.clientY - rect.top) * size.height / rect.height
  };
}

function designerPointerDown(event) {
  const point = canvasPoint(event);
  const ctx = $("#designerCanvas").getContext("2d");
  const layers = [...state.editing.layers].reverse();
  const layer = layers.find(item => {
    const box = layerBounds(item, ctx);
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
  });
  state.selectedLayerId = layer?.id || "";
  if (layer) {
    const box = layerBounds(layer, ctx);
    const resizing = point.x > box.x + box.w - 60 && point.y > box.y + box.h - 60;
    state.drag = { layerId: layer.id, mode: resizing ? "resize" : "move", start: point, original: clone(layer), bounds: box };
    $("#designerCanvas").setPointerCapture(event.pointerId);
  }
  renderDesigner();
}

function designerPointerMove(event) {
  if (!state.drag) return;
  const point = canvasPoint(event);
  const layer = state.editing.layers.find(item => item.id === state.drag.layerId);
  const dx = point.x - state.drag.start.x;
  const dy = point.y - state.drag.start.y;
  if (state.drag.mode === "move") {
    layer.x = Math.round(state.drag.original.x + dx);
    layer.y = Math.round(state.drag.original.y + dy);
  } else if (layer.type === "text") {
    layer.fontSize = Math.max(10, Math.round(state.drag.original.fontSize + Math.max(dx, dy) / 3));
  } else {
    layer.w = Math.max(40, Math.round(state.drag.original.w + dx));
    layer.h = Math.max(40, Math.round(state.drag.original.h + dy));
  }
  renderDesigner();
}

function designerPointerUp() { state.drag = null; }

function addLayer(type) {
  const photoIndex = state.editing.layers.filter(layer => layer.type === "photo").length;
  const size = templateSize();
  const layer = type === "text"
    ? { id: uid("text"), type: "text", text: "Love forever", x: size.width / 2, y: size.height / 2, fontSize: 64, color: "#a64f6c", align: "center", font: "script" }
    : type === "heart"
      ? { id: uid("heart"), type: "heart", x: size.width / 2 - 100, y: size.height / 2 - 90, w: 200, h: 180, color: "#dc789d", opacity: .9 }
      : { id: uid("photo"), type: "photo", photoIndex, x: size.width * .1, y: size.height * .1, w: size.width * .7, h: size.height * .7, radius: 28, borderColor: "#ffffff", borderWidth: 8 };
  state.editing.layers.push(layer);
  state.selectedLayerId = layer.id;
  renderDesigner();
}

function duplicateLayer() {
  const layer = state.editing.layers.find(item => item.id === state.selectedLayerId);
  if (!layer) return;
  const copy = { ...clone(layer), id: uid(layer.type), x: layer.x + 35, y: layer.y + 35 };
  state.editing.layers.push(copy);
  state.selectedLayerId = copy.id;
  renderDesigner();
}

function deleteLayer() {
  if (!state.selectedLayerId) return;
  state.editing.layers = state.editing.layers.filter(layer => layer.id !== state.selectedLayerId);
  state.selectedLayerId = "";
  renderDesigner();
}

async function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function addAsset(file) {
  if (!file) return;
  try {
    const uploaded = await request("/api/assets", {
      method: "POST", body: JSON.stringify({ data: await fileData(file) })
    });
    const size = templateSize();
    const layer = { id: uid("image"), type: "image", src: uploaded.src, x: size.width / 2 - 300, y: size.height / 2 - 300, w: 600, h: 600, opacity: 1 };
    state.editing.layers.push(layer);
    state.selectedLayerId = layer.id;
    renderDesigner();
  } catch (error) {
    alert(error.message);
  }
}

async function saveTemplate() {
  state.editing.name = $("#templateName").value.trim() || "未命名模版";
  state.editing.background = $("#templateBackground").value;
  const saved = await request("/api/templates", { method: "POST", body: JSON.stringify(state.editing) });
  const index = state.templates.findIndex(template => template.id === saved.id);
  if (index >= 0) state.templates[index] = saved; else state.templates.push(saved);
  state.editing = clone(saved);
  renderTemplateList();
  renderDesigner();
  return saved;
}

async function useTemplate() {
  try {
    const saved = await saveTemplate();
    await saveEvent({ activeTemplateId: saved.id });
    state.result = "";
    showOnly("#boothView");
    render();
    showMessage(`已选用「${saved.name}」`);
  } catch (error) {
    alert(error.message);
  }
}

function newTemplate(orientation = "landscape") {
  const portrait = orientation === "portrait";
  state.editing = portrait ? {
    id: uid("custom"), name: "我的竖版模版", background: "#fff2f6", width: 1200, height: 1800,
    layers: [
      { id: uid("photo"), type: "photo", photoIndex: 0, x: 55, y: 55, w: 1090, h: 1330, radius: 35, borderColor: "#ffffff", borderWidth: 10 },
      { id: uid("text"), type: "text", text: "{event}", x: 600, y: 1500, fontSize: 58, color: "#a64f6c", align: "center", font: "script" },
      { id: uid("text"), type: "text", text: "{date}", x: 600, y: 1690, fontSize: 34, color: "#c26d89", align: "center", font: "elegant" }
    ]
  } : {
    id: uid("custom"), name: "我的横版模版", background: "#fff2f6", width: 1800, height: 1200,
    layers: [
      { id: uid("photo"), type: "photo", photoIndex: 0, x: 55, y: 55, w: 1320, h: 1090, radius: 35, borderColor: "#ffffff", borderWidth: 10 },
      { id: uid("text"), type: "text", text: "{event}", x: 1585, y: 430, fontSize: 48, color: "#a64f6c", align: "center", font: "script" },
      { id: uid("text"), type: "text", text: "{date}", x: 1585, y: 900, fontSize: 34, color: "#c26d89", align: "center", font: "elegant" }
    ]
  };
  state.selectedLayerId = "";
  renderTemplateList();
  renderDesigner();
}

function changeTemplateOrientation(orientation) {
  if (!state.editing || templateOrientation(state.editing) === orientation) return;
  const old = templateSize();
  const next = orientation === "portrait"
    ? { width: 1200, height: 1800 }
    : { width: 1800, height: 1200 };
  const scaleX = next.width / old.width;
  const scaleY = next.height / old.height;
  state.editing.width = next.width;
  state.editing.height = next.height;
  state.editing.layers = state.editing.layers.map(layer => ({
    ...layer,
    x: Math.round((layer.x || 0) * scaleX),
    y: Math.round((layer.y || 0) * scaleY),
    w: layer.w ? Math.round(layer.w * scaleX) : layer.w,
    h: layer.h ? Math.round(layer.h * scaleY) : layer.h,
    fontSize: layer.fontSize ? Math.round(layer.fontSize * Math.min(scaleX, scaleY)) : layer.fontSize
  }));
  renderTemplateList();
  renderDesigner();
}

async function deleteTemplate() {
  if (!state.editing || !confirm(`确定删除「${state.editing.name}」吗？`)) return;
  try {
    await request(`/api/templates/${encodeURIComponent(state.editing.id)}`, { method: "DELETE" });
    state.templates = state.templates.filter(template => template.id !== state.editing.id);
    state.editing = clone(state.templates[0]);
    state.selectedLayerId = "";
    renderTemplateList();
    renderDesigner();
  } catch (error) {
    alert(error.message);
  }
}

$("#captureButton").addEventListener("click", captureSession);
$("#captureTemplateList").addEventListener("click", event => {
  const option = event.target.closest("[data-capture-template-id]");
  if (option) chooseCaptureTemplate(option.dataset.captureTemplateId);
});
$("#retakeButton").addEventListener("click", () => {
  state.result = "";
  state.liveView.paused = false;
  showMessage("");
  render();
});
$("#downloadButton").addEventListener("click", downloadResult);
$("#shareButton").addEventListener("click", shareResult);
$("#printButton").addEventListener("click", printResult);
$("#settingsButton").addEventListener("click", openSettings);
$("#templatesButton").addEventListener("click", () => openDesigner());
$("#cancelSettings").addEventListener("click", () => showOnly("#boothView"));
$("#saveSettings").addEventListener("click", saveSettings);
$("#downloadName").addEventListener("input", updateDownloadNameHint);
$("#closeDesignerButton").addEventListener("click", () => { showOnly("#boothView"); render(); });
$("#newLandscapeButton").addEventListener("click", () => newTemplate("landscape"));
$("#newPortraitButton").addEventListener("click", () => newTemplate("portrait"));
$("#addTextButton").addEventListener("click", () => addLayer("text"));
$("#addPhotoButton").addEventListener("click", () => addLayer("photo"));
$("#addHeartButton").addEventListener("click", () => addLayer("heart"));
$("#duplicateLayerButton").addEventListener("click", duplicateLayer);
$("#deleteLayerButton").addEventListener("click", deleteLayer);
$("#saveTemplateButton").addEventListener("click", () => saveTemplate().catch(error => alert(error.message)));
$("#useTemplateButton").addEventListener("click", useTemplate);
$("#deleteTemplateButton").addEventListener("click", deleteTemplate);
$("#assetFile").addEventListener("change", event => addAsset(event.target.files[0]));
$("#templateList").addEventListener("click", event => {
  const card = event.target.closest("[data-template-id]");
  if (card) selectTemplate(card.dataset.templateId);
});
$("#templateName").addEventListener("input", event => { state.editing.name = event.target.value; });
$("#templateBackground").addEventListener("input", event => { state.editing.background = event.target.value; renderDesigner(false); });
$("#templateOrientation").addEventListener("change", event => changeTemplateOrientation(event.target.value));
$("#orientationFilter").addEventListener("change", event => {
  state.templateFilter = event.target.value;
  renderTemplateList();
});
$("#layerProperties").addEventListener("input", event => {
  const property = event.target.dataset.layerProperty;
  if (!property) return;
  const layer = state.editing.layers.find(item => item.id === state.selectedLayerId);
  if (!layer) return;
  let value = event.target.type === "number" ? Number(event.target.value) : event.target.value;
  if (event.target.dataset.offset) value += Number(event.target.dataset.offset);
  layer[property] = value;
  renderDesigner(false);
});
$("#designerCanvas").addEventListener("pointerdown", designerPointerDown);
$("#designerCanvas").addEventListener("pointermove", designerPointerMove);
$("#designerCanvas").addEventListener("pointerup", designerPointerUp);
$("#designerCanvas").addEventListener("pointercancel", designerPointerUp);
$("#fullscreenButton").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener("keydown", event => {
  const editingInput = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (editingInput) return;
  if (!$("#designerView").classList.contains("hidden") && (event.key === "Delete" || event.key === "Backspace")) deleteLayer();
  if (!$("#boothView").classList.contains("hidden") && event.code === "Space") captureSession();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
window.addEventListener("beforeunload", () => stopWebcam());
window.addEventListener("beforeunload", () => stopExternalLiveView());
load().catch(error => showMessage(error.message));
setInterval(refreshStatus, 10000);
