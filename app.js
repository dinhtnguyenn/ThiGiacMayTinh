(() => {
  class ApiError extends Error {
    constructor(message, code = "request_failed", status = 0) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  const elements = {
    tabRegister: document.getElementById("tabRegister"),
    tabRecognize: document.getElementById("tabRecognize"),
    tabManage: document.getElementById("tabManage"),
    registerView: document.getElementById("registerView"),
    recognitionView: document.getElementById("recognitionView"),
    manageView: document.getElementById("manageView"),
    liveVideoRegister: document.getElementById("liveVideoRegister"),
    liveVideoRecognize: document.getElementById("liveVideoRecognize"),
    cameraPanelRegister: document.getElementById("cameraPanelRegister"),
    cameraPanelRecognize: document.getElementById("cameraPanelRecognize"),
    registerTrackingCanvas: document.getElementById("registerTrackingCanvas"),
    recognizeTrackingCanvas: document.getElementById("recognizeTrackingCanvas"),
    cameraStatusRegister: document.getElementById("cameraStatusRegister"),
    cameraStatusRecognize: document.getElementById("cameraStatusRecognize"),
    registrationForm: document.getElementById("registrationForm"),
    personName: document.getElementById("personName"),
    registerImageInput: document.getElementById("registerImageInput"),
    registerImageStatus: document.getElementById("registerImageStatus"),
    registerButton: document.getElementById("registerButton"),
    registrationMessage: document.getElementById("registrationMessage"),
    registerProcessingTrace: document.getElementById("registerProcessingTrace"),
    recognizeImageInput: document.getElementById("recognizeImageInput"),
    recognizeImageStatus: document.getElementById("recognizeImageStatus"),
    recognizeButton: document.getElementById("recognizeButton"),
    recognitionResult: document.getElementById("recognitionResult"),
    recognitionFaces: document.getElementById("recognitionFaces"),
    recognizeProcessingTrace: document.getElementById("recognizeProcessingTrace"),
    managementGate: document.getElementById("managementGate"),
    managementPanel: document.getElementById("managementPanel"),
    adminForm: document.getElementById("adminForm"),
    adminTokenInput: document.getElementById("adminTokenInput"),
    unlockManagementButton: document.getElementById("unlockManagementButton"),
    managementMessage: document.getElementById("managementMessage"),
    managementSummary: document.getElementById("managementSummary"),
    refreshDataButton: document.getElementById("refreshDataButton"),
    lockManagementButton: document.getElementById("lockManagementButton"),
    profilesTable: document.getElementById("profilesTable"),
    profilesTableBody: document.getElementById("profilesTableBody"),
    editDialog: document.getElementById("editDialog"),
    editForm: document.getElementById("editForm"),
    editProfileId: document.getElementById("editProfileId"),
    editProfileName: document.getElementById("editProfileName"),
    editMessage: document.getElementById("editMessage"),
    cancelEditButton: document.getElementById("cancelEditButton"),
    saveEditButton: document.getElementById("saveEditButton"),
  };

  const state = {
    activeTab: "register",
    adminToken: null,
    profiles: [],
    stream: null,
    cameraContext: null,
    trackingTimer: null,
    trackingRequestActive: false,
  };

  function errorMessage(error) {
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác.";
  }

  async function apiFetch(path, { admin = false, body, headers, ...options } = {}) {
    const requestHeaders = new Headers(headers || {});
    let requestBody = body;
    if (admin) {
      if (!state.adminToken) throw new ApiError("Hãy nhập mã quản lý.", "admin_auth_required", 401);
      requestHeaders.set("X-Admin-Token", state.adminToken);
    }
    if (requestBody && !(requestBody instanceof FormData) && typeof requestBody !== "string") {
      requestHeaders.set("Content-Type", "application/json");
      requestBody = JSON.stringify(requestBody);
    }
    let response;
    try {
      response = await fetch(path, { ...options, body: requestBody, headers: requestHeaders });
    } catch {
      throw new ApiError("Không kết nối được server.", "network_error");
    }
    if (response.status === 204) return null;
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload && payload.detail;
      const message = typeof detail === "string" ? detail : detail && detail.message ? detail.message : "Server không thể xử lý yêu cầu.";
      const code = detail && detail.code ? detail.code : "request_failed";
      throw new ApiError(message, code, response.status);
    }
    return payload;
  }

  function setButtonState(button, stateName, label) {
    if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
    button.disabled = stateName === "loading";
    button.dataset.state = stateName;
    button.textContent = label;
    if (stateName !== "loading") {
      window.setTimeout(() => {
        button.disabled = false;
        delete button.dataset.state;
        button.textContent = button.dataset.defaultLabel;
      }, stateName === "success" ? 1500 : 2200);
    }
  }

  function setMessage(element, message = "", tone = "") {
    element.textContent = message;
    element.dataset.state = tone;
  }

  function setCameraStatus(context, message, tone = "") {
    const status = context === "register" ? elements.cameraStatusRegister : elements.cameraStatusRecognize;
    status.textContent = message;
    status.dataset.state = tone;
  }

  function videoFor(context) {
    return context === "register" ? elements.liveVideoRegister : elements.liveVideoRecognize;
  }

  function panelFor(context) {
    return context === "register" ? elements.cameraPanelRegister : elements.cameraPanelRecognize;
  }

  function canvasFor(context) {
    return context === "register" ? elements.registerTrackingCanvas : elements.recognizeTrackingCanvas;
  }

  function inputFor(context) {
    return context === "register" ? elements.registerImageInput : elements.recognizeImageInput;
  }

  function traceFor(context) {
    return context === "register" ? elements.registerProcessingTrace : elements.recognizeProcessingTrace;
  }

  function colorToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function clearTracking(context) {
    const canvas = canvasFor(context);
    const drawing = canvas.getContext("2d");
    if (drawing) drawing.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawTracking(context, faces, imageWidth, imageHeight, labels = []) {
    const canvas = canvasFor(context);
    const video = videoFor(context);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const sourceWidth = Number(imageWidth) || video.videoWidth;
    const sourceHeight = Number(imageHeight) || video.videoHeight;
    if (!width || !height || !sourceWidth || !sourceHeight) return;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const offsetX = (width - sourceWidth * scale) / 2;
    const offsetY = (height - sourceHeight * scale) / 2;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const drawing = canvas.getContext("2d");
    if (!drawing) return;
    drawing.scale(ratio, ratio);
    drawing.clearRect(0, 0, width, height);
    drawing.lineWidth = 2;
    drawing.font = "500 12px " + colorToken("--font-mono");
    faces.forEach((face, index) => {
      const box = Array.isArray(face.box) ? face.box : [];
      if (box.length !== 4) return;
      const x = offsetX + Number(box[0]) * scale;
      const y = offsetY + Number(box[1]) * scale;
      const boxWidth = (Number(box[2]) - Number(box[0])) * scale;
      const boxHeight = (Number(box[3]) - Number(box[1])) * scale;
      const match = labels[index] && labels[index].matched && labels[index].profile;
      drawing.strokeStyle = match ? colorToken("--color-success") : colorToken("--color-accent");
      drawing.fillStyle = drawing.strokeStyle;
      drawing.strokeRect(x, y, boxWidth, boxHeight);
      drawing.fillText(match ? labels[index].profile.name : "Khuôn mặt " + (index + 1), x + 4, Math.max(14, y - 6));
    });
  }

  async function captureFrame(context, filename) {
    const video = videoFor(context);
    if (!state.stream || state.cameraContext !== context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new ApiError("Camera chưa sẵn sàng.", "camera_required", 422);
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new ApiError("Không thể chụp hình từ camera.", "capture_unavailable");
    drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new ApiError("Không thể tạo ảnh camera.", "capture_failed")), "image/jpeg", 0.9);
    });
    return new File([blob], filename, { type: "image/jpeg" });
  }

  async function trackCamera(context) {
    if (state.trackingRequestActive || state.cameraContext !== context || !state.stream) return;
    if (videoFor(context).readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      state.trackingTimer = window.setTimeout(() => trackCamera(context), 300);
      return;
    }
    state.trackingRequestActive = true;
    try {
      const image = await captureFrame(context, "tracking.jpg");
      const form = new FormData();
      form.append("image", image, image.name);
      const payload = await apiFetch("/api/tracking", { method: "POST", body: form });
      const faces = Array.isArray(payload.faces) ? payload.faces : [];
      drawTracking(context, faces, payload.image_width, payload.image_height);
      setCameraStatus(context, faces.length ? "Đang theo dõi " + faces.length + " khuôn mặt." : "Chưa thấy khuôn mặt.");
    } catch {
      clearTracking(context);
    } finally {
      state.trackingRequestActive = false;
      if (state.cameraContext === context && state.stream) {
        state.trackingTimer = window.setTimeout(() => trackCamera(context), 900);
      }
    }
  }

  function startTracking(context) {
    if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
    state.trackingTimer = window.setTimeout(() => trackCamera(context), 120);
  }

  function stopCamera() {
    if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
    state.trackingTimer = null;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.cameraContext = null;
    state.trackingRequestActive = false;
    ["register", "recognize"].forEach((context) => {
      panelFor(context).classList.remove("is-live");
      clearTracking(context);
    });
  }

  async function startCamera(context) {
    if (state.stream && state.cameraContext === context) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus(context, "Trình duyệt không hỗ trợ camera.", "error");
      return false;
    }
    try {
      stopCamera();
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
      const video = videoFor(context);
      video.srcObject = state.stream;
      await video.play();
      state.cameraContext = context;
      panelFor(context).classList.add("is-live");
      setCameraStatus(context, "Camera đã sẵn sàng.", "success");
      startTracking(context);
      return true;
    } catch (error) {
      setCameraStatus(context, error && error.name === "NotAllowedError" ? "Bạn chưa cho phép camera." : "Không thể mở camera.", "error");
      return false;
    }
  }

  async function prepareImage(context, filename) {
    const selected = inputFor(context).files && inputFor(context).files[0];
    if (selected) return { image: selected, source: "Ảnh tải lên" };
    if (!(await startCamera(context))) throw new ApiError("Không thể mở camera để chụp ảnh.", "camera_required", 422);
    return { image: await captureFrame(context, filename), source: "Ảnh từ camera" };
  }

  function updateSelectedImage(context) {
    const selected = inputFor(context).files && inputFor(context).files[0];
    const status = context === "register" ? elements.registerImageStatus : elements.recognizeImageStatus;
    status.textContent = selected ? "Đã chọn: " + selected.name : "Hoặc dùng camera đang mở.";
  }

  function renderProcessing(context, processing) {
    const trace = traceFor(context);
    trace.replaceChildren();
    const steps = processing && Array.isArray(processing.steps) ? processing.steps : [];
    steps.forEach((step) => {
      const item = document.createElement("li");
      item.textContent = step.component + ": " + step.message + (typeof step.duration_ms === "number" ? " (" + step.duration_ms + " ms)" : "");
      trace.append(item);
    });
  }

  function renderRecognitionFaces(faces) {
    elements.recognitionFaces.replaceChildren();
    faces.forEach((face, index) => {
      const item = document.createElement("li");
      item.dataset.state = face.matched ? "match" : "empty";
      item.textContent = "Người " + (index + 1) + ": " + (face.matched && face.profile ? face.profile.name : "Chưa có dữ liệu");
      elements.recognitionFaces.append(item);
    });
  }

  function setRecognition(stateName, title, detail) {
    elements.recognitionResult.dataset.state = stateName;
    elements.recognitionResult.querySelector("strong").textContent = title;
    elements.recognitionResult.querySelector("span").textContent = detail;
  }

  async function registerFace(event) {
    event.preventDefault();
    const name = elements.personName.value.trim();
    if (name.length < 2) {
      setMessage(elements.registrationMessage, "Nhập ít nhất 2 ký tự cho họ và tên.", "error");
      return;
    }
    setButtonState(elements.registerButton, "loading", "Đang đăng ký...");
    try {
      const submission = await prepareImage("register", "registration.jpg");
      const form = new FormData();
      form.append("name", name);
      form.append("consent", "true");
      form.append("mode", "image");
      form.append("image", submission.image, submission.image.name);
      const payload = await apiFetch("/api/profiles", { method: "POST", body: form });
      renderProcessing("register", payload.processing);
      elements.personName.value = "";
      setMessage(elements.registrationMessage, "Đăng ký thành công: " + payload.profile.name + ".", "success");
      setButtonState(elements.registerButton, "success", "Đã đăng ký");
    } catch (error) {
      setMessage(elements.registrationMessage, errorMessage(error), "error");
      setButtonState(elements.registerButton, "error", "Thử lại");
    }
  }

  async function recognizeFace() {
    setButtonState(elements.recognizeButton, "loading", "Đang nhận diện...");
    try {
      const submission = await prepareImage("recognize", "recognition.jpg");
      const form = new FormData();
      form.append("mode", "image");
      form.append("image", submission.image, submission.image.name);
      const payload = await apiFetch("/api/recognitions", { method: "POST", body: form });
      const faces = Array.isArray(payload.faces) ? payload.faces : [];
      const matchedCount = faces.filter((face) => face.matched && face.profile).length;
      renderProcessing("recognize", payload.processing);
      renderRecognitionFaces(faces);
      if (state.cameraContext === "recognize") drawTracking("recognize", faces, payload.image_width, payload.image_height, faces);
      if (matchedCount) {
        setRecognition("match", "Đã tìm thấy dữ liệu", "Khớp " + matchedCount + " khuôn mặt.");
      } else {
        setRecognition("empty", "Chưa có dữ liệu", "Không tìm thấy khuôn mặt đã đăng ký.");
      }
      setButtonState(elements.recognizeButton, "success", "Đã nhận diện");
    } catch (error) {
      setRecognition("error", "Không thể nhận diện", errorMessage(error));
      renderRecognitionFaces([]);
      setButtonState(elements.recognizeButton, "error", "Thử lại");
    }
  }

  function showManagement() {
    const unlocked = Boolean(state.adminToken);
    elements.managementGate.hidden = unlocked;
    elements.managementPanel.hidden = !unlocked;
    if (unlocked) loadProfiles();
  }

  function displayDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Không xác định" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }

  function setTableMessage(message) {
    elements.profilesTableBody.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = message;
    row.append(cell);
    elements.profilesTableBody.append(row);
  }

  function renderProfiles() {
    if (!state.profiles.length) {
      setTableMessage("Chưa có dữ liệu.");
      return;
    }
    elements.profilesTableBody.replaceChildren();
    state.profiles.forEach((profile) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = profile.name;
      const date = document.createElement("td");
      date.textContent = displayDate(profile.created_at);
      const actions = document.createElement("td");
      ["Sửa", "Xóa"].forEach((label) => {
        const button = document.createElement("button");
        button.className = "table-button";
        button.type = "button";
        button.dataset.action = label === "Sửa" ? "edit" : "delete";
        button.dataset.profileId = profile.id;
        button.textContent = label;
        actions.append(button);
      });
      row.append(name, date, actions);
      elements.profilesTableBody.append(row);
    });
  }

  async function loadProfiles() {
    if (!state.adminToken) return;
    setTableMessage("Đang tải...");
    try {
      const payload = await apiFetch("/api/profiles", { admin: true, cache: "no-store" });
      state.profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      elements.managementSummary.textContent = payload.profile_count + " hồ sơ trên server.";
      renderProfiles();
    } catch (error) {
      setTableMessage(errorMessage(error));
      if (error.status === 401 || error.status === 503) lockManagement(errorMessage(error));
    }
  }

  async function unlockManagement(event) {
    event.preventDefault();
    const token = elements.adminTokenInput.value;
    if (!token) {
      setMessage(elements.managementMessage, "Nhập mã quản lý.", "error");
      return;
    }
    setButtonState(elements.unlockManagementButton, "loading", "Đang mở...");
    state.adminToken = token;
    try {
      await apiFetch("/api/profiles", { admin: true, cache: "no-store" });
      elements.adminTokenInput.value = "";
      setMessage(elements.managementMessage);
      showManagement();
      setButtonState(elements.unlockManagementButton, "success", "Đã mở");
    } catch (error) {
      state.adminToken = null;
      setMessage(elements.managementMessage, errorMessage(error), "error");
      setButtonState(elements.unlockManagementButton, "error", "Thử lại");
    }
  }

  function lockManagement(message = "Đã khóa quản lý.") {
    state.adminToken = null;
    state.profiles = [];
    elements.managementPanel.hidden = true;
    elements.managementGate.hidden = false;
    setMessage(elements.managementMessage, message);
  }

  function openEditDialog(profileId) {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    elements.editProfileId.value = profile.id;
    elements.editProfileName.value = profile.name;
    setMessage(elements.editMessage);
    elements.editDialog.showModal();
    elements.editProfileName.focus();
  }

  async function updateProfile(event) {
    event.preventDefault();
    const name = elements.editProfileName.value.trim();
    if (name.length < 2) {
      setMessage(elements.editMessage, "Tên cần ít nhất 2 ký tự.", "error");
      return;
    }
    setButtonState(elements.saveEditButton, "loading", "Đang lưu...");
    try {
      await apiFetch("/api/profiles/" + encodeURIComponent(elements.editProfileId.value), { admin: true, method: "PUT", body: { name } });
      elements.editDialog.close();
      await loadProfiles();
    } catch (error) {
      setMessage(elements.editMessage, errorMessage(error), "error");
      setButtonState(elements.saveEditButton, "error", "Thử lại");
    }
  }

  async function deleteProfile(profileId) {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile || !window.confirm("Xóa hồ sơ " + profile.name + "?")) return;
    try {
      await apiFetch("/api/profiles/" + encodeURIComponent(profileId), { admin: true, method: "DELETE" });
      await loadProfiles();
    } catch (error) {
      elements.managementSummary.textContent = errorMessage(error);
    }
  }

  function switchTab(tabName, moveFocus = true) {
    stopCamera();
    state.activeTab = tabName;
    const tabs = {
      register: [elements.tabRegister, elements.registerView],
      recognize: [elements.tabRecognize, elements.recognitionView],
      manage: [elements.tabManage, elements.manageView],
    };
    Object.entries(tabs).forEach(([name, [tab, view]]) => {
      const active = name === tabName;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      view.hidden = !active;
    });
    if (tabName === "manage") showManagement();
    if (tabName === "recognize") {
      setRecognition("idle", "Chưa có kết quả", "Đặt một hoặc nhiều khuôn mặt vào khung hình.");
      renderRecognitionFaces([]);
    }
    if (tabName === "register" || tabName === "recognize") startCamera(tabName);
    if (moveFocus) {
      const heading = tabs[tabName][1].querySelector("h2");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  [elements.tabRegister, elements.tabRecognize, elements.tabManage].forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.id.replace("tab", "").toLowerCase()));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const tabs = [elements.tabRegister, elements.tabRecognize, elements.tabManage];
      const next = (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      next.focus();
    });
  });
  elements.registrationForm.addEventListener("submit", registerFace);
  elements.registerImageInput.addEventListener("change", () => updateSelectedImage("register"));
  elements.recognizeImageInput.addEventListener("change", () => updateSelectedImage("recognize"));
  elements.recognizeButton.addEventListener("click", recognizeFace);
  elements.adminForm.addEventListener("submit", unlockManagement);
  elements.refreshDataButton.addEventListener("click", loadProfiles);
  elements.lockManagementButton.addEventListener("click", () => lockManagement());
  elements.profilesTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit") openEditDialog(button.dataset.profileId);
    if (button.dataset.action === "delete") deleteProfile(button.dataset.profileId);
  });
  elements.editForm.addEventListener("submit", updateProfile);
  elements.cancelEditButton.addEventListener("click", () => elements.editDialog.close());
  window.addEventListener("beforeunload", stopCamera);

  switchTab("register", false);
})();
