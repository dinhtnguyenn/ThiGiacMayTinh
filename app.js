(() => {
  const workspaceStorageKey = "faceops-lab-workspace-v1";
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  class ApiError extends Error {
    constructor(message, code = "request_failed", status = 0) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  const elements = {
    liveVideo: document.getElementById("liveVideo"),
    stillPreview: document.getElementById("stillPreview"),
    captureStage: document.getElementById("captureStage"),
    captureCaption: document.getElementById("captureCaption"),
    sourceReadout: document.getElementById("sourceReadout"),
    modeReadout: document.getElementById("modeReadout"),
    runtimeChip: document.getElementById("runtimeChip"),
    runtimeText: document.getElementById("runtimeText"),
    signalPanel: document.getElementById("signalPanel"),
    signalText: document.getElementById("signalText"),
    startCamera: document.getElementById("startCamera"),
    navCamera: document.getElementById("navCamera"),
    imageInput: document.getElementById("imageInput"),
    imageHelp: document.getElementById("imageHelp"),
    modeOptions: [...document.querySelectorAll("[data-liveness]")],
    beginLiveness: document.getElementById("beginLiveness"),
    livenessStatus: document.getElementById("livenessStatus"),
    consentInput: document.getElementById("consentInput"),
    workspaceStatus: document.getElementById("workspaceStatus"),
    createWorkspace: document.getElementById("createWorkspace"),
    deleteWorkspace: document.getElementById("deleteWorkspace"),
    registrationForm: document.getElementById("registrationForm"),
    personName: document.getElementById("personName"),
    registrationMessage: document.getElementById("registrationMessage"),
    registerButton: document.getElementById("registerButton"),
    recognizeButton: document.getElementById("recognizeButton"),
    recognitionResult: document.getElementById("recognitionResult"),
    profileList: document.getElementById("profileList"),
    profileCount: document.getElementById("profileCount"),
    notebookInput: document.getElementById("notebookInput"),
    notebookDropzone: document.getElementById("notebookDropzone"),
    notebookReadout: document.getElementById("notebookReadout"),
    commandDialog: document.getElementById("commandDialog"),
    commandTrigger: document.getElementById("commandTrigger"),
    commandInput: document.getElementById("commandInput"),
    commandOptions: [...document.querySelectorAll(".command-option")],
    apiLine: document.getElementById("apiLine"),
  };

  const state = {
    source: "none",
    mode: "liveness",
    stream: null,
    imageFile: null,
    imageName: "",
    workspace: loadWorkspace(),
    profiles: [],
    challenge: null,
  };

  function loadWorkspace() {
    try {
      const stored = JSON.parse(localStorage.getItem(workspaceStorageKey) || "null");
      if (stored && typeof stored.id === "string" && typeof stored.token === "string" && typeof stored.expiresAt === "string") {
        return stored;
      }
    } catch {
      // A corrupt local token is removed on the next state update.
    }
    return null;
  }

  function persistWorkspace() {
    if (state.workspace) {
      localStorage.setItem(workspaceStorageKey, JSON.stringify(state.workspace));
    } else {
      localStorage.removeItem(workspaceStorageKey);
    }
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Hãy thử lại.";
  }

  async function apiFetch(path, options = {}, needsWorkspace = true) {
    const headers = new Headers(options.headers || {});
    if (needsWorkspace) {
      if (!state.workspace) throw new ApiError("Hãy tạo workspace riêng trước khi gửi dữ liệu.", "workspace_required", 401);
      headers.set("Authorization", "Bearer " + state.workspace.token);
    }

    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      throw new ApiError("Không kết nối được API. Mở trang qua dịch vụ FaceOps và kiểm tra máy chủ đang chạy.", "network_error");
    }

    const responseText = await response.text();
    let body = null;
    if (responseText) {
      try {
        body = JSON.parse(responseText);
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      const detail = body && body.detail;
      const message = typeof detail === "string"
        ? detail
        : detail && typeof detail.message === "string"
          ? detail.message
          : "Máy chủ không thể xử lý yêu cầu này.";
      const code = detail && typeof detail.code === "string" ? detail.code : "request_failed";
      if (response.status === 401 && needsWorkspace) clearWorkspace("Workspace đã hết hạn hoặc token không còn hợp lệ. Hãy tạo lại trước khi tiếp tục.", "error");
      throw new ApiError(message, code, response.status);
    }
    return body;
  }

  function setRuntime(text, status) {
    elements.runtimeText.textContent = text;
    elements.runtimeChip.dataset.state = status;
  }

  function sourceLabel() {
    if (state.source === "camera") return "Webcam đang mở";
    if (state.source === "image") return state.imageName || "Ảnh tải lên";
    return "Chưa có khung hình";
  }

  function modeLabel() {
    return state.mode === "liveness" ? "LIVENESS" : "ẢNH TĨNH";
  }

  function sourceNote() {
    if (state.mode === "liveness" && state.source !== "camera") {
      return "Liveness cần webcam đang hoạt động; ảnh tải lên không được dùng cho challenge này.";
    }
    if (state.mode === "liveness" && state.challenge) {
      return "Baseline đã chụp. Xoay nhẹ đầu sang trái hoặc phải, sau đó đăng ký hoặc nhận diện trước khi challenge hết hạn.";
    }
    if (state.mode === "liveness") {
      return "Mở webcam, bấm Bắt đầu challenge để chụp baseline, rồi đổi tư thế ở khung hình tiếp theo.";
    }
    if (state.source === "none") return "Chọn ảnh hoặc webcam để gửi một ảnh tĩnh khi bạn bấm thao tác.";
    return "Ảnh tĩnh không có kiểm tra chống giả mạo. Chọn Liveness nếu cần thử challenge đổi tư thế.";
  }

  function refreshCaptureUi() {
    elements.sourceReadout.textContent = sourceLabel();
    elements.modeReadout.textContent = modeLabel();
    elements.captureCaption.textContent = state.source === "none" ? "Chưa có dữ liệu hình ảnh" : modeLabel() + " / " + sourceLabel();
    elements.signalText.textContent = sourceNote();
    elements.signalPanel.dataset.tone = state.source === "none" ? "neutral" : "active";
    elements.beginLiveness.disabled = state.mode !== "liveness";
    elements.modeOptions.forEach((option) => {
      const selected = option.dataset.liveness === state.mode;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "không xác định";
    return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function renderWorkspace() {
    if (!state.workspace) {
      elements.workspaceStatus.dataset.state = "idle";
      elements.workspaceStatus.querySelector("strong").textContent = "Chưa tạo workspace";
      elements.workspaceStatus.querySelector("span").textContent = "Hãy đồng ý trước khi gửi dữ liệu sinh trắc học.";
      elements.createWorkspace.disabled = false;
      elements.deleteWorkspace.disabled = true;
      return;
    }
    elements.workspaceStatus.dataset.state = "active";
    elements.workspaceStatus.querySelector("strong").textContent = "Workspace đã sẵn sàng";
    elements.workspaceStatus.querySelector("span").textContent = "Tự hết hạn lúc " + formatDate(state.workspace.expiresAt) + ". Chỉ token trên trình duyệt này có thể truy cập.";
    elements.createWorkspace.disabled = false;
    elements.deleteWorkspace.disabled = false;
  }

  function setWorkspaceStatus(title, detail, tone) {
    elements.workspaceStatus.dataset.state = tone;
    elements.workspaceStatus.querySelector("strong").textContent = title;
    elements.workspaceStatus.querySelector("span").textContent = detail;
  }

  function clearWorkspace(message = "Workspace đã được xóa khỏi trình duyệt này.", tone = "idle") {
    state.workspace = null;
    state.profiles = [];
    state.challenge = null;
    persistWorkspace();
    renderProfiles();
    refreshCaptureUi();
    setWorkspaceStatus("Không có workspace", message, tone);
    elements.deleteWorkspace.disabled = true;
  }

  async function ensureWorkspace() {
    if (state.workspace) return state.workspace;
    if (!elements.consentInput.checked) {
      setWorkspaceStatus("Cần đồng ý lưu trữ", "Đánh dấu ô đồng ý rồi tạo workspace trước khi gửi dữ liệu sinh trắc học.", "error");
      throw new ApiError("Bạn cần đồng ý lưu embedding khuôn mặt trong workspace riêng trước khi tiếp tục.", "consent_required", 422);
    }

    const payload = await apiFetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true }),
    }, false);
    state.workspace = {
      id: payload.workspace_id,
      token: payload.workspace_token,
      expiresAt: payload.expires_at,
      retentionDays: payload.retention_days,
    };
    persistWorkspace();
    elements.consentInput.checked = true;
    renderWorkspace();
    await loadProfiles();
    return state.workspace;
  }

  async function createWorkspace() {
    setButtonState(elements.createWorkspace, "loading", "Đang tạo...");
    try {
      const workspace = await ensureWorkspace();
      setWorkspaceStatus("Workspace đã sẵn sàng", "Dữ liệu tự hết hạn sau " + workspace.retentionDays + " ngày, hoặc bạn có thể xóa ngay tại đây.", "active");
      setButtonState(elements.createWorkspace, "success", "Đã tạo");
    } catch (error) {
      setButtonState(elements.createWorkspace, "error", "Không tạo được");
      setWorkspaceStatus("Không tạo được workspace", errorMessage(error), "error");
    }
  }

  async function deleteWorkspace() {
    if (!state.workspace) return;
    if (!window.confirm("Xóa toàn bộ hồ sơ khuôn mặt, liveness challenge và metadata notebook của workspace này? Thao tác không thể hoàn tác.")) return;
    setButtonState(elements.deleteWorkspace, "loading", "Đang xóa...");
    try {
      await apiFetch("/api/workspaces/current", { method: "DELETE" });
      clearWorkspace("Hồ sơ, challenge và metadata của workspace đã được xóa.", "success");
      setButtonState(elements.deleteWorkspace, "success", "Đã xóa");
    } catch (error) {
      setButtonState(elements.deleteWorkspace, "error", "Không xóa được");
      setWorkspaceStatus("Không xóa được workspace", errorMessage(error), "error");
    }
  }

  async function loadProfiles() {
    if (!state.workspace) {
      state.profiles = [];
      renderProfiles();
      return;
    }
    try {
      const payload = await apiFetch("/api/profiles");
      state.profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      renderProfiles();
    } catch (error) {
      state.profiles = [];
      renderProfiles();
      if (!(error instanceof ApiError && error.status === 401)) {
        setWorkspaceStatus("Không tải được hồ sơ", errorMessage(error), "error");
      }
    }
  }

  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRuntime("Trình duyệt không hỗ trợ webcam", "error");
      elements.signalText.textContent = "Không thể yêu cầu webcam từ trình duyệt này. Chọn ảnh tĩnh hoặc dùng trình duyệt hỗ trợ camera.";
      elements.signalPanel.dataset.tone = "error";
      return;
    }

    setButtonState(elements.startCamera, "loading", "Đang mở...");
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      state.stream = stream;
      state.source = "camera";
      elements.liveVideo.srcObject = stream;
      await elements.liveVideo.play();
      elements.captureStage.classList.remove("is-image");
      elements.captureStage.classList.add("is-live");
      setRuntime("Camera đang hoạt động", "active");
      refreshCaptureUi();
      setButtonState(elements.startCamera, "success", "Đã kết nối");
    } catch (error) {
      const reason = error && error.name === "NotAllowedError"
        ? "Bạn đã chặn quyền camera. Hãy cho phép quyền camera rồi thử lại."
        : "Không thể mở camera. Kiểm tra thiết bị rồi thử lại.";
      setRuntime("Không mở được camera", "error");
      elements.signalText.textContent = reason;
      elements.signalPanel.dataset.tone = "error";
      setButtonState(elements.startCamera, "error", "Thử lại");
    }
  }

  function setImage(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      elements.imageHelp.textContent = "Tệp này không phải ảnh. Chọn PNG, JPG, WEBP hoặc định dạng ảnh khác.";
      return;
    }

    stopCamera();
    state.source = "image";
    state.imageFile = file;
    state.imageName = file.name;
    state.mode = "image";
    resetLiveness();
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      elements.stillPreview.src = String(reader.result);
      elements.captureStage.classList.remove("is-live");
      elements.captureStage.classList.add("is-image");
      elements.imageHelp.textContent = "Đang dùng " + file.name + ". Tệp chỉ được gửi nếu bạn bấm đăng ký hoặc nhận diện.";
      setRuntime("Ảnh đã sẵn sàng", "active");
      refreshCaptureUi();
    });
    reader.readAsDataURL(file);
  }

  function setMode(mode) {
    if (mode !== "liveness" && mode !== "image") return;
    if (state.mode !== mode) resetLiveness();
    state.mode = mode;
    refreshCaptureUi();
  }

  function setButtonState(button, status, label) {
    const original = button.dataset.originalHtml || button.innerHTML;
    button.dataset.originalHtml = original;
    button.dataset.state = status;
    button.disabled = status === "loading";
    button.textContent = label;
    if (status === "success" || status === "error") {
      window.setTimeout(() => resetButton(button), status === "success" ? 1600 : 2400);
    }
  }

  function resetButton(button) {
    button.disabled = false;
    delete button.dataset.state;
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    if (button === elements.deleteWorkspace && !state.workspace) button.disabled = true;
    if (button === elements.beginLiveness && state.mode !== "liveness") button.disabled = true;
  }

  function setLivenessStatus(text, tone = "neutral") {
    elements.livenessStatus.textContent = text;
    elements.livenessStatus.dataset.state = tone;
  }

  function resetLiveness() {
    state.challenge = null;
    setLivenessStatus("Mở webcam, sau đó tạo baseline trước khi xoay nhẹ đầu sang trái hoặc phải.", "neutral");
  }

  async function captureCameraFrame(filename) {
    if (!state.stream || state.source !== "camera" || elements.liveVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new ApiError("Mở webcam và chờ khung hình hiển thị trước khi tiếp tục.", "camera_required", 422);
    }
    const width = elements.liveVideo.videoWidth || 640;
    const height = elements.liveVideo.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new ApiError("Trình duyệt không thể tạo khung hình camera.", "capture_unavailable");
    context.drawImage(elements.liveVideo, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new ApiError("Không thể mã hóa khung hình camera.", "capture_failed")), "image/jpeg", 0.92);
    });
    return new File([blob], filename, { type: "image/jpeg" });
  }

  async function beginLiveness() {
    if (state.mode !== "liveness") return;
    setButtonState(elements.beginLiveness, "loading", "Đang tạo baseline...");
    try {
      await ensureWorkspace();
      const baseline = await captureCameraFrame("liveness-baseline.jpg");
      const challenge = await apiFetch("/api/liveness/challenge", { method: "POST" });
      state.challenge = {
        id: challenge.challenge_id,
        expiresAt: challenge.expires_at,
        baseline,
      };
      setLivenessStatus("Baseline đã chụp. Xoay nhẹ đầu sang trái hoặc phải, rồi bấm Đăng ký hoặc Chạy nhận diện trước " + formatDate(challenge.expires_at) + ".", "active");
      refreshCaptureUi();
      setButtonState(elements.beginLiveness, "success", "Baseline sẵn sàng");
    } catch (error) {
      setLivenessStatus(errorMessage(error), "error");
      elements.signalPanel.dataset.tone = "error";
      setButtonState(elements.beginLiveness, "error", "Thử lại");
    }
  }

  async function buildFaceFormData(name = null) {
    const form = new FormData();
    let image;
    if (state.mode === "liveness") {
      if (!state.challenge) {
        throw new ApiError("Hãy bấm Bắt đầu challenge, chụp baseline rồi đổi tư thế trước khi gửi liveness.", "liveness_challenge_required", 422);
      }
      if (Date.parse(state.challenge.expiresAt) <= Date.now()) {
        resetLiveness();
        refreshCaptureUi();
        throw new ApiError("Challenge liveness đã hết hạn. Hãy bắt đầu lại.", "liveness_challenge_expired", 422);
      }
      image = await captureCameraFrame("liveness-action.jpg");
      form.append("challenge_id", state.challenge.id);
      form.append("baseline_image", state.challenge.baseline, state.challenge.baseline.name);
    } else {
      if (state.source === "image" && state.imageFile) {
        image = state.imageFile;
      } else if (state.source === "camera") {
        image = await captureCameraFrame("static-camera-frame.jpg");
      } else {
        throw new ApiError("Chọn ảnh hoặc mở webcam trước khi gửi nhận diện.", "image_required", 422);
      }
    }
    if (name !== null) form.append("name", name);
    form.append("mode", state.mode);
    form.append("image", image, image.name);
    return form;
  }

  function validateName() {
    const valid = elements.personName.value.trim().length >= 2;
    elements.personName.setAttribute("aria-invalid", String(!valid));
    return valid;
  }

  function setFormMessage(text, tone) {
    elements.registrationMessage.textContent = text;
    elements.registrationMessage.dataset.state = tone;
  }

  async function registerProfile(event) {
    event.preventDefault();
    if (!validateName()) {
      setFormMessage("Tên hồ sơ chưa hợp lệ. Nhập ít nhất 2 ký tự rồi thử lại.", "error");
      return;
    }
    let consumeChallenge = false;
    setButtonState(elements.registerButton, "loading", "Đang tạo embedding...");
    try {
      await ensureWorkspace();
      const form = await buildFaceFormData(elements.personName.value.trim());
      consumeChallenge = state.mode === "liveness";
      const payload = await apiFetch("/api/profiles", { method: "POST", body: form });
      state.profiles.unshift(payload.profile);
      renderProfiles();
      const livenessText = payload.liveness.status === "challenge_passed" ? " Challenge đổi tư thế đã đạt." : " Ảnh tĩnh không được kiểm tra liveness.";
      setFormMessage("Đã lưu embedding InsightFace cho " + payload.profile.name + " trong workspace." + livenessText, "success");
      elements.personName.value = "";
      elements.personName.setAttribute("aria-invalid", "false");
      setButtonState(elements.registerButton, "success", "Đã lưu");
    } catch (error) {
      setFormMessage(errorMessage(error), "error");
      setButtonState(elements.registerButton, "error", "Không lưu được");
    } finally {
      if (consumeChallenge) {
        resetLiveness();
        refreshCaptureUi();
      }
    }
  }

  function renderProfiles() {
    elements.profileCount.textContent = String(state.profiles.length);
    elements.profileList.replaceChildren();
    if (!state.profiles.length) {
      const empty = document.createElement("div");
      empty.className = "empty-profiles";
      const dash = document.createElement("span");
      dash.setAttribute("aria-hidden", "true");
      dash.textContent = "—";
      const text = document.createElement("p");
      text.textContent = "Chưa có hồ sơ. Lưu một khuôn mặt để thử luồng nhận diện.";
      empty.append(dash, text);
      elements.profileList.append(empty);
      return;
    }
    state.profiles.forEach((profile) => {
      const row = document.createElement("article");
      row.className = "profile-row";
      const avatar = document.createElement("span");
      avatar.className = "profile-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = String(profile.name || "?").slice(0, 1).toUpperCase();
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = profile.name;
      const meta = document.createElement("span");
      meta.textContent = (profile.source_mode === "liveness" ? "Liveness challenge" : "Ảnh tĩnh") + " · " + formatDate(profile.created_at);
      copy.append(name, meta);
      row.append(avatar, copy);
      elements.profileList.append(row);
    });
  }

  function setRecognition(stateName, title, description) {
    elements.recognitionResult.dataset.state = stateName;
    elements.recognitionResult.querySelector("strong").textContent = title;
    elements.recognitionResult.querySelector("span").textContent = description;
  }

  async function recognize() {
    if (!state.profiles.length) {
      setRecognition("error", "Chưa có hồ sơ", "Đăng ký ít nhất một khuôn mặt trong workspace trước khi đối chiếu.");
      setButtonState(elements.recognizeButton, "error", "Chưa có hồ sơ");
      return;
    }
    let consumeChallenge = false;
    setButtonState(elements.recognizeButton, "loading", "Đang so khớp...");
    try {
      await ensureWorkspace();
      const form = await buildFaceFormData();
      consumeChallenge = state.mode === "liveness";
      const payload = await apiFetch("/api/recognitions", { method: "POST", body: form });
      const livenessText = payload.liveness.status === "challenge_passed"
        ? " Liveness: challenge đổi tư thế đạt."
        : " Ảnh tĩnh: không có verdict liveness.";
      if (payload.matched && payload.profile) {
        setRecognition("success", "Khớp: " + payload.profile.name, "Similarity " + (payload.similarity * 100).toFixed(1) + "% (ngưỡng " + (payload.threshold * 100).toFixed(0) + "%)." + livenessText);
        setButtonState(elements.recognizeButton, "success", "Đã đối chiếu");
      } else {
        setRecognition("error", "Không có kết quả khớp", "Không có hồ sơ vượt ngưỡng so khớp hiện tại." + livenessText);
        setButtonState(elements.recognizeButton, "error", "Không khớp");
      }
    } catch (error) {
      setRecognition("error", "Không thể nhận diện", errorMessage(error));
      setButtonState(elements.recognizeButton, "error", "Thử lại");
    } finally {
      if (consumeChallenge) {
        resetLiveness();
        refreshCaptureUi();
      }
    }
  }

  function setNotebookReadout(title, description, tone = "neutral") {
    elements.notebookReadout.dataset.state = tone;
    elements.notebookReadout.querySelector("strong").textContent = title;
    elements.notebookReadout.querySelector("span").textContent = description;
  }

  async function importNotebook(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".ipynb")) {
      setNotebookReadout("Tệp không hợp lệ", "Chọn đúng tệp Jupyter có đuôi .ipynb.", "error");
      return;
    }
    setNotebookReadout("Đang kiểm tra notebook", "Chỉ metadata sẽ được gửi. Nội dung cell không được thực thi.", "active");
    try {
      await ensureWorkspace();
      const form = new FormData();
      form.append("notebook", file, file.name);
      const payload = await apiFetch("/api/models/notebook", { method: "POST", body: form });
      setNotebookReadout(payload.filename, "nbformat " + payload.nbformat + " · " + payload.code_cells + " code cell · " + payload.markdown_cells + " markdown cell · code không được chạy.", "success");
    } catch (error) {
      setNotebookReadout("Không import được notebook", errorMessage(error), "error");
    } finally {
      elements.notebookInput.value = "";
    }
  }

  async function checkHealth() {
    try {
      const payload = await apiFetch("/api/health", { cache: "no-store" }, false);
      setRuntime(payload.face_engine_loaded ? "API và model sẵn sàng" : "API sẵn sàng; model nạp khi dùng", "active");
      if (state.workspace) await loadProfiles();
    } catch (error) {
      setRuntime("API chưa kết nối", "error");
      setWorkspaceStatus("Không kết nối được API", errorMessage(error), "error");
    }
  }

  function openCommands() {
    if (!elements.commandDialog.open) {
      elements.commandDialog.showModal();
      window.setTimeout(() => elements.commandInput.focus(), 0);
    }
  }

  function closeCommands() {
    if (elements.commandDialog.open) elements.commandDialog.close();
  }

  function visibleCommandOptions() {
    return elements.commandOptions.filter((option) => !option.hidden);
  }

  function selectCommand(nextOption) {
    elements.commandOptions.forEach((option) => {
      const selected = option === nextOption;
      option.classList.toggle("is-active", selected);
      option.setAttribute("aria-selected", String(selected));
    });
  }

  function performCommand(command) {
    closeCommands();
    if (command === "workbench") document.getElementById("workbench").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    if (command === "camera") startCamera();
    if (command === "liveness") {
      document.getElementById("workbench").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      window.setTimeout(beginLiveness, 350);
    }
    if (command === "register") {
      document.getElementById("actionsTitle").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      window.setTimeout(() => elements.personName.focus({ preventScroll: true }), 350);
    }
    if (command === "notebook") {
      document.getElementById("notebook").scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      window.setTimeout(() => elements.notebookInput.click(), 350);
    }
  }

  function typeApiLine() {
    const fullLine = "curl -X POST /api/recognitions";
    if (prefersReducedMotion) {
      elements.apiLine.textContent = fullLine;
      return;
    }
    elements.apiLine.textContent = "";
    let index = 0;
    const typeCharacter = () => {
      elements.apiLine.textContent += fullLine.charAt(index);
      index += 1;
      if (index < fullLine.length) window.setTimeout(typeCharacter, 20);
    };
    window.setTimeout(typeCharacter, 560);
  }

  elements.startCamera.addEventListener("click", startCamera);
  elements.navCamera.addEventListener("click", startCamera);
  elements.imageInput.addEventListener("change", (event) => setImage(event.target.files && event.target.files[0]));
  elements.modeOptions.forEach((option) => option.addEventListener("click", () => setMode(option.dataset.liveness)));
  elements.beginLiveness.addEventListener("click", beginLiveness);
  elements.createWorkspace.addEventListener("click", createWorkspace);
  elements.deleteWorkspace.addEventListener("click", deleteWorkspace);
  elements.registrationForm.addEventListener("submit", registerProfile);
  elements.personName.addEventListener("blur", validateName);
  elements.personName.addEventListener("input", () => {
    if (elements.personName.getAttribute("aria-invalid") === "true") validateName();
  });
  elements.recognizeButton.addEventListener("click", recognize);
  elements.notebookInput.addEventListener("change", (event) => importNotebook(event.target.files && event.target.files[0]));

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.notebookDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.notebookDropzone.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    elements.notebookDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.notebookDropzone.classList.remove("is-dragging");
    });
  });
  elements.notebookDropzone.addEventListener("drop", (event) => importNotebook(event.dataTransfer.files && event.dataTransfer.files[0]));

  elements.commandTrigger.addEventListener("click", openCommands);
  elements.commandDialog.addEventListener("close", () => elements.commandTrigger.focus());
  elements.commandDialog.addEventListener("click", (event) => {
    if (event.target === elements.commandDialog) closeCommands();
  });
  elements.commandInput.addEventListener("input", () => {
    const query = elements.commandInput.value.trim().toLocaleLowerCase("vi");
    elements.commandOptions.forEach((option) => {
      option.hidden = !option.textContent.toLocaleLowerCase("vi").includes(query);
    });
    selectCommand(visibleCommandOptions()[0] || elements.commandOptions[0]);
  });
  elements.commandOptions.forEach((option) => option.addEventListener("click", () => performCommand(option.dataset.command)));
  elements.commandDialog.addEventListener("keydown", (event) => {
    const options = visibleCommandOptions();
    if (!options.length) return;
    const selected = options.findIndex((option) => option.classList.contains("is-active"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      selectCommand(options[(selected + offset + options.length) % options.length]);
    }
    if (event.key === "Enter") {
      const active = options.find((option) => option.classList.contains("is-active"));
      if (active) {
        event.preventDefault();
        performCommand(active.dataset.command);
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("vi") === "k") {
      event.preventDefault();
      if (elements.commandDialog.open) closeCommands(); else openCommands();
    }
  });
  window.addEventListener("beforeunload", stopCamera);

  renderWorkspace();
  renderProfiles();
  refreshCaptureUi();
  typeApiLine();
  checkHealth();
  if (prefersReducedMotion) {
    document.body.classList.add("motion-ready");
  } else {
    window.requestAnimationFrame(() => document.body.classList.add("motion-ready"));
  }
})();
