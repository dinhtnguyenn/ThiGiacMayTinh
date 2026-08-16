(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  class ApiError extends Error {
    constructor(message, code = "request_failed", status = 0) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  const elements = {
    serverStatus: document.getElementById("serverStatus"),
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
    consentInput: document.getElementById("consentInput"),
    registerButton: document.getElementById("registerButton"),
    registrationMessage: document.getElementById("registrationMessage"),
    registerImageInput: document.getElementById("registerImageInput"),
    registerImageStatus: document.getElementById("registerImageStatus"),
    registerProcessingTrace: document.getElementById("registerProcessingTrace"),
    recognizeButton: document.getElementById("recognizeButton"),
    recognitionResult: document.getElementById("recognitionResult"),
    recognitionFaces: document.getElementById("recognitionFaces"),
    recognizeImageInput: document.getElementById("recognizeImageInput"),
    recognizeImageStatus: document.getElementById("recognizeImageStatus"),
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
    profilesTableBody: document.getElementById("profilesTableBody"),
    profilesTable: document.getElementById("profilesTable"),
    editDialog: document.getElementById("editDialog"),
    editForm: document.getElementById("editForm"),
    editProfileId: document.getElementById("editProfileId"),
    editProfileName: document.getElementById("editProfileName"),
    editMessage: document.getElementById("editMessage"),
    cancelEditButton: document.getElementById("cancelEditButton"),
    saveEditButton: document.getElementById("saveEditButton"),
    commandTrigger: document.getElementById("commandTrigger"),
    commandDialog: document.getElementById("commandDialog"),
    commandInput: document.getElementById("commandInput"),
    commandList: document.getElementById("commandList"),
    closeCommandButton: document.getElementById("closeCommandButton"),
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
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Hãy thử lại.";
  }

  async function apiFetch(path, { admin = false, body, headers, ...options } = {}) {
    const requestHeaders = new Headers(headers || {});
    let requestBody = body;
    if (admin) {
      if (!state.adminToken) throw new ApiError("Hãy nhập mã quản trị trước.", "admin_auth_required", 401);
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
      throw new ApiError("Không kết nối được máy chủ. Hãy kiểm tra lại đường truyền.", "network_error");
    }
    if (response.status === 204) return null;

    const responseText = await response.text();
    let payload = null;
    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
    }
    if (!response.ok) {
      const detail = payload && payload.detail;
      const message = typeof detail === "string"
        ? detail
        : detail && typeof detail.message === "string"
          ? detail.message
          : "Máy chủ không thể xử lý yêu cầu này.";
      const code = detail && typeof detail.code === "string" ? detail.code : "request_failed";
      throw new ApiError(message, code, response.status);
    }
    return payload;
  }

  function setButtonState(button, status, label) {
    const original = button.dataset.originalHtml || button.innerHTML;
    button.dataset.originalHtml = original;
    button.dataset.state = status;
    button.disabled = status === "loading";
    button.textContent = label;
    if (status === "success" || status === "error") {
      window.setTimeout(() => resetButton(button), status === "success" ? 1500 : 2200);
    }
  }

  function resetButton(button) {
    delete button.dataset.state;
    button.disabled = false;
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
  }

  function setServerStatus(text, stateName) {
    elements.serverStatus.textContent = text;
    elements.serverStatus.dataset.state = stateName;
  }

  function setCameraStatus(context, text, tone = "neutral") {
    const status = context === "register" ? elements.cameraStatusRegister : elements.cameraStatusRecognize;
    status.textContent = text;
    status.dataset.state = tone;
  }

  function setFormMessage(text = "", tone = "neutral") {
    elements.registrationMessage.textContent = text;
    elements.registrationMessage.dataset.state = tone;
  }

  function setManagementMessage(text = "", tone = "neutral") {
    elements.managementMessage.textContent = text;
    elements.managementMessage.dataset.state = tone;
  }

  function setRecognition(stateName, title, detail) {
    elements.recognitionResult.dataset.state = stateName;
    elements.recognitionResult.querySelector("strong").textContent = title;
    elements.recognitionResult.querySelector("span").textContent = detail;
  }

  function renderRecognitionFaces(faces) {
    elements.recognitionFaces.replaceChildren();
    faces.forEach((face, index) => {
      const item = document.createElement("li");
      item.dataset.state = face.matched ? "match" : "empty";
      const label = document.createElement("strong");
      label.textContent = "Người " + (index + 1);
      const detail = document.createElement("span");
      detail.textContent = face.matched && face.profile
        ? "Thông tin đã lưu: " + face.profile.name + "."
        : "Chưa có dữ liệu.";
      item.append(label, detail);
      elements.recognitionFaces.append(item);
    });
  }

  function processingTrace(context) {
    return context === "register" ? elements.registerProcessingTrace : elements.recognizeProcessingTrace;
  }

  function imageInput(context) {
    return context === "register" ? elements.registerImageInput : elements.recognizeImageInput;
  }

  function imageStatus(context) {
    return context === "register" ? elements.registerImageStatus : elements.recognizeImageStatus;
  }

  function renderProcessing(context, steps) {
    const trace = processingTrace(context);
    trace.replaceChildren();
    steps.forEach((step) => {
      const item = document.createElement("li");
      item.dataset.state = step.state || "complete";
      const label = document.createElement("strong");
      label.textContent = step.component;
      const message = document.createElement("span");
      message.textContent = step.message;
      item.append(label, message);
      if (typeof step.duration_ms === "number") {
        const timing = document.createElement("small");
        timing.textContent = step.duration_ms + " ms";
        item.append(timing);
      }
      trace.append(item);
    });
  }

  function startProcessing(context, sourceMessage) {
    renderProcessing(context, [
      { component: "Trình duyệt", message: sourceMessage },
      { component: "Trình duyệt", message: "Đã gửi yêu cầu tới server FaceOps.", state: "active" },
    ]);
  }

  function finishProcessing(context, processing) {
    const serverSteps = processing && Array.isArray(processing.steps) ? processing.steps : [];
    renderProcessing(context, [
      { component: "Trình duyệt", message: "Đã chuẩn bị ảnh cho yêu cầu này." },
      { component: "Trình duyệt", message: "Đã gửi yêu cầu tới server FaceOps." },
      ...serverSteps,
      {
        component: "Server",
        message: "Đã trả kết quả về trình duyệt.",
        duration_ms: processing && typeof processing.total_ms === "number" ? processing.total_ms : undefined,
      },
    ]);
  }

  function failProcessing(context, error) {
    renderProcessing(context, [
      { component: "Trình duyệt hoặc server", message: "Không thể hoàn tất yêu cầu: " + errorMessage(error), state: "error" },
    ]);
  }

  function trackingCanvas(context) {
    return context === "register" ? elements.registerTrackingCanvas : elements.recognizeTrackingCanvas;
  }

  function videoFor(context) {
    return context === "register" ? elements.liveVideoRegister : elements.liveVideoRecognize;
  }

  function colorToken(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function clearTracking(context) {
    const canvas = trackingCanvas(context);
    const context2d = canvas.getContext("2d");
    if (context2d) context2d.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawTracking(context, faces, imageWidth, imageHeight, labels = []) {
    const canvas = trackingCanvas(context);
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
    const context2d = canvas.getContext("2d");
    if (!context2d) return;
    context2d.scale(ratio, ratio);
    context2d.clearRect(0, 0, width, height);
    context2d.lineWidth = 2;
    context2d.font = "500 12px " + colorToken("--font-mono");
    faces.forEach((face, index) => {
      const box = Array.isArray(face.box) ? face.box : [];
      if (box.length !== 4) return;
      const x = offsetX + Number(box[0]) * scale;
      const y = offsetY + Number(box[1]) * scale;
      const boxWidth = (Number(box[2]) - Number(box[0])) * scale;
      const boxHeight = (Number(box[3]) - Number(box[1])) * scale;
      const matched = labels[index] && labels[index].matched;
      const label = matched ? labels[index].profile.name : "Khuôn mặt " + (index + 1);
      context2d.strokeStyle = matched ? colorToken("--color-success-paper") : colorToken("--color-accent");
      context2d.fillStyle = matched ? colorToken("--color-success-paper") : colorToken("--color-accent");
      context2d.strokeRect(x, y, boxWidth, boxHeight);
      context2d.fillText(label, x + 4, Math.max(14, y - 6));
    });
  }

  async function trackCamera(context) {
    if (state.trackingRequestActive || state.cameraContext !== context || !state.stream) return;
    const video = videoFor(context);
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    state.trackingRequestActive = true;
    try {
      const frame = await captureFrame(context, "tracking.jpg");
      const form = new FormData();
      form.append("image", frame, frame.name);
      const payload = await apiFetch("/api/tracking", { method: "POST", body: form });
      drawTracking(context, Array.isArray(payload.faces) ? payload.faces : [], payload.image_width, payload.image_height);
      const faceCount = Array.isArray(payload.faces) ? payload.faces.length : 0;
      setCameraStatus(context, faceCount ? "Đang theo dõi " + faceCount + " khuôn mặt." : "Chưa thấy khuôn mặt trong khung hình.");
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "face_not_found")) {
        clearTracking(context);
      }
    } finally {
      state.trackingRequestActive = false;
      if (state.cameraContext === context && state.stream) {
        state.trackingTimer = window.setTimeout(() => trackCamera(context), 900);
      }
    }
  }

  function startTracking(context) {
    if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
    clearTracking(context);
    state.trackingTimer = window.setTimeout(() => trackCamera(context), 120);
  }

  function stopCamera() {
    if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
    state.trackingTimer = null;
    state.trackingRequestActive = false;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.cameraContext = null;
    elements.cameraPanelRegister.classList.remove("is-live");
    elements.cameraPanelRecognize.classList.remove("is-live");
    clearTracking("register");
    clearTracking("recognize");
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
      const isActive = name === tabName;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
      view.hidden = !isActive;
    });
    if (tabName === "recognize") {
      setRecognition("idle", "Chưa nhận diện", "Đặt khuôn mặt vào khung hình rồi bắt đầu.");
      renderRecognitionFaces([]);
      setCameraStatus("recognize", "Sẵn sàng nhận diện.");
    }
    if (tabName === "manage") showManagement();
    if (moveFocus) {
      const heading = tabs[tabName][1].querySelector("h2");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  async function startCamera(context) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus(context, "Trình duyệt này không hỗ trợ camera.", "error");
      return;
    }
    const panel = context === "register" ? elements.cameraPanelRegister : elements.cameraPanelRecognize;
    const video = videoFor(context);
    try {
      stopCamera();
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video.srcObject = state.stream;
      await video.play();
      panel.classList.add("is-live");
      state.cameraContext = context;
      setCameraStatus(context, "Camera đã sẵn sàng.", "success");
      startTracking(context);
      return true;
    } catch (error) {
      const message = error && error.name === "NotAllowedError"
        ? "Bạn chưa cho phép sử dụng camera. Hãy cấp quyền rồi thử lại."
        : "Không thể mở camera. Kiểm tra thiết bị rồi thử lại.";
      setCameraStatus(context, message, "error");
      return false;
    }
  }

  async function captureFrame(context, filename) {
    const video = videoFor(context);
    if (!state.stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new ApiError("Hãy mở camera và chờ hình ảnh hiển thị trước.", "camera_required", 422);
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const drawingContext = canvas.getContext("2d");
    if (!drawingContext) throw new ApiError("Không thể chụp hình từ camera.", "capture_unavailable");
    drawingContext.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new ApiError("Không thể mã hóa ảnh camera.", "capture_failed")),
        "image/jpeg",
        0.92,
      );
    });
    return new File([blob], filename, { type: "image/jpeg" });
  }

  async function prepareImage(context, filename) {
    const selected = imageInput(context).files && imageInput(context).files[0];
    if (selected) {
      return { image: selected, sourceMessage: "Đã chọn ảnh tải lên: " + selected.name + "." };
    }
    if (!state.stream || state.cameraContext !== context) {
      const cameraReady = await startCamera(context);
      if (!cameraReady) throw new ApiError("Không thể mở camera để chụp ảnh.", "camera_required", 422);
    }
    return {
      image: await captureFrame(context, filename),
      sourceMessage: "Đã chụp một khung hình mới từ camera.",
    };
  }

  function updateImageSelection(context) {
    const selected = imageInput(context).files && imageInput(context).files[0];
    imageStatus(context).textContent = selected
      ? "Đã chọn " + selected.name + ". Hệ thống sẽ ưu tiên ảnh này thay cho camera."
      : "Tùy chọn. Khi có ảnh, hệ thống ưu tiên ảnh tải lên thay cho camera.";
  }

  function validateName() {
    const valid = elements.personName.value.trim().length >= 2;
    elements.personName.setAttribute("aria-invalid", String(!valid));
    return valid;
  }

  async function registerFace(event) {
    event.preventDefault();
    if (!validateName()) {
      setFormMessage("Nhập ít nhất 2 ký tự cho họ và tên.", "error");
      return;
    }
    if (!elements.consentInput.checked) {
      setFormMessage("Hãy đồng ý lưu dữ liệu trên server trước khi đăng ký.", "error");
      return;
    }
    setButtonState(elements.registerButton, "loading", "Đang lưu...");
    try {
      const submission = await prepareImage("register", "registration.jpg");
      startProcessing("register", submission.sourceMessage);
      const form = new FormData();
      form.append("name", elements.personName.value.trim());
      form.append("consent", "true");
      form.append("mode", "image");
      form.append("image", submission.image, submission.image.name);
      const payload = await apiFetch("/api/profiles", { method: "POST", body: form });
      finishProcessing("register", payload.processing);
      elements.personName.value = "";
      elements.consentInput.checked = false;
      elements.personName.setAttribute("aria-invalid", "false");
      setFormMessage("Đã lưu hồ sơ. Chuyển sang nhận diện.", "success");
      setCameraStatus("register", "Đã lưu " + payload.profile.name + " trên server.", "success");
      setButtonState(elements.registerButton, "success", "Đã lưu");
      window.setTimeout(() => switchTab("recognize"), prefersReducedMotion ? 0 : 300);
    } catch (error) {
      failProcessing("register", error);
      setFormMessage(errorMessage(error), "error");
      setButtonState(elements.registerButton, "error", "Thử lại");
    }
  }

  async function recognizeFace() {
    setButtonState(elements.recognizeButton, "loading", "Đang nhận diện...");
    try {
      const submission = await prepareImage("recognize", "recognition.jpg");
      startProcessing("recognize", submission.sourceMessage);
      const form = new FormData();
      form.append("mode", "image");
      form.append("image", submission.image, submission.image.name);
      const payload = await apiFetch("/api/recognitions", { method: "POST", body: form });
      finishProcessing("recognize", payload.processing);
      const faces = Array.isArray(payload.faces) ? payload.faces : [];
      const matchedCount = faces.filter((face) => face.matched && face.profile).length;
      renderRecognitionFaces(faces);
      if (state.cameraContext === "recognize") {
        drawTracking("recognize", faces, payload.image_width, payload.image_height, faces);
      }
      if (matchedCount) {
        setRecognition(
          "match",
          "Đã tìm thấy dữ liệu",
          matchedCount === 1 ? "Đã khớp 1 khuôn mặt trong khung hình." : "Đã khớp " + matchedCount + " khuôn mặt trong khung hình.",
        );
        setCameraStatus("recognize", "Nhận diện thành công.", "success");
        setButtonState(elements.recognizeButton, "success", "Đã nhận diện");
      } else {
        setRecognition("empty", "Chưa có dữ liệu", faces.length > 1 ? "Không tìm thấy dữ liệu phù hợp cho " + faces.length + " khuôn mặt." : "Không tìm thấy khuôn mặt đã đăng ký.");
        setCameraStatus("recognize", "Không tìm thấy dữ liệu phù hợp.");
        setButtonState(elements.recognizeButton, "success", "Đã kiểm tra");
      }
    } catch (error) {
      failProcessing("recognize", error);
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

  function setTablePlaceholder(message, tone = "") {
    elements.profilesTableBody.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "table-placeholder";
    if (tone) cell.dataset.state = tone;
    cell.textContent = message;
    row.append(cell);
    elements.profilesTableBody.append(row);
  }

  function displayDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Không xác định" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  }

  function renderProfiles() {
    if (!state.profiles.length) {
      setTablePlaceholder("Chưa có hồ sơ trong danh bạ.");
      return;
    }
    elements.profilesTableBody.replaceChildren();
    state.profiles.forEach((profile) => {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.dataset.label = "Tên";
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = profile.name;
      name.append(nameStrong);
      const created = document.createElement("td");
      created.dataset.label = "Đăng ký";
      created.textContent = displayDate(profile.created_at);
      const source = document.createElement("td");
      source.dataset.label = "Nguồn";
      source.textContent = profile.source_mode === "image" ? "Ảnh tĩnh" : profile.source_mode;
      const actions = document.createElement("td");
      actions.dataset.label = "Thao tác";
      actions.className = "row-actions";
      [
        ["edit", "Sửa", "button--quiet"],
        ["delete", "Xóa", "button--danger"],
      ].forEach(([action, label, className]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "table-action " + className;
        button.dataset.profileAction = action;
        button.dataset.profileId = profile.id;
        button.textContent = label;
        actions.append(button);
      });
      row.append(name, created, source, actions);
      elements.profilesTableBody.append(row);
    });
  }

  async function loadProfiles() {
    if (!state.adminToken) return;
    setTablePlaceholder("Đang tải dữ liệu...");
    try {
      const payload = await apiFetch("/api/profiles", { admin: true, cache: "no-store" });
      state.profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      elements.managementSummary.textContent = payload.profile_count + " hồ sơ đang lưu trên server.";
      renderProfiles();
    } catch (error) {
      state.profiles = [];
      setTablePlaceholder(errorMessage(error), "error");
      if (error instanceof ApiError && (error.status === 401 || error.status === 503)) lockManagement(errorMessage(error));
    }
  }

  async function unlockManagement(event) {
    event.preventDefault();
    const token = elements.adminTokenInput.value;
    if (!token) {
      setManagementMessage("Nhập mã quản trị để tiếp tục.", "error");
      return;
    }
    setButtonState(elements.unlockManagementButton, "loading", "Đang kiểm tra...");
    state.adminToken = token;
    try {
      await apiFetch("/api/profiles", { admin: true, cache: "no-store" });
      elements.adminTokenInput.value = "";
      setManagementMessage("");
      showManagement();
      setButtonState(elements.unlockManagementButton, "success", "Đã mở");
    } catch (error) {
      state.adminToken = null;
      setManagementMessage(errorMessage(error), "error");
      setButtonState(elements.unlockManagementButton, "error", "Thử lại");
    }
  }

  function lockManagement(message = "Mã quản trị đã được xóa khỏi tab này.") {
    state.adminToken = null;
    state.profiles = [];
    elements.managementPanel.hidden = true;
    elements.managementGate.hidden = false;
    elements.managementSummary.textContent = "Chưa tải dữ liệu.";
    setManagementMessage(message, "neutral");
  }

  function openEditDialog(profileId) {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    elements.editProfileId.value = profile.id;
    elements.editProfileName.value = profile.name;
    elements.editMessage.textContent = "";
    elements.editDialog.showModal();
    elements.editProfileName.focus();
  }

  async function updateProfile(event) {
    event.preventDefault();
    const profileId = elements.editProfileId.value;
    const name = elements.editProfileName.value.trim();
    if (name.length < 2) {
      elements.editMessage.textContent = "Tên cần có ít nhất 2 ký tự.";
      elements.editMessage.dataset.state = "error";
      return;
    }
    setButtonState(elements.saveEditButton, "loading", "Đang lưu...");
    try {
      await apiFetch("/api/profiles/" + encodeURIComponent(profileId), {
        admin: true,
        method: "PUT",
        body: { name },
      });
      elements.editDialog.close();
      await loadProfiles();
    } catch (error) {
      elements.editMessage.textContent = errorMessage(error);
      elements.editMessage.dataset.state = "error";
      setButtonState(elements.saveEditButton, "error", "Thử lại");
    }
  }

  async function deleteProfile(profileId) {
    const profile = state.profiles.find((item) => item.id === profileId);
    if (!profile || !window.confirm("Xóa hồ sơ " + profile.name + "? Thao tác này không thể hoàn tác.")) return;
    try {
      await apiFetch("/api/profiles/" + encodeURIComponent(profileId), { admin: true, method: "DELETE" });
      await loadProfiles();
    } catch (error) {
      elements.managementSummary.textContent = errorMessage(error);
    }
  }

  function openCommandDialog() {
    elements.commandInput.value = "";
    elements.commandList.querySelectorAll(".command-option").forEach((option) => { option.hidden = false; });
    elements.commandDialog.showModal();
    elements.commandInput.focus();
  }

  function closeCommandDialog() {
    elements.commandDialog.close();
    elements.commandTrigger.focus();
  }

  function executeCommand(command) {
    closeCommandDialog();
    switchTab(command);
  }

  async function checkHealth() {
    try {
      await apiFetch("/api/health", { cache: "no-store" });
      setServerStatus("Server sẵn sàng", "ready");
    } catch {
      setServerStatus("Không kết nối server", "error");
    }
  }

  elements.tabRegister.addEventListener("click", () => switchTab("register"));
  elements.tabRecognize.addEventListener("click", () => switchTab("recognize"));
  elements.tabManage.addEventListener("click", () => switchTab("manage"));
  [elements.tabRegister, elements.tabRecognize, elements.tabManage].forEach((tab) => {
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const tabs = [elements.tabRegister, elements.tabRecognize, elements.tabManage];
      const next = (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].focus();
    });
  });
  elements.registrationForm.addEventListener("submit", registerFace);
  elements.registerImageInput.addEventListener("change", () => updateImageSelection("register"));
  elements.recognizeImageInput.addEventListener("change", () => updateImageSelection("recognize"));
  elements.personName.addEventListener("blur", validateName);
  elements.personName.addEventListener("input", () => {
    if (elements.personName.getAttribute("aria-invalid") === "true") validateName();
  });
  elements.recognizeButton.addEventListener("click", recognizeFace);
  elements.adminForm.addEventListener("submit", unlockManagement);
  elements.refreshDataButton.addEventListener("click", loadProfiles);
  elements.lockManagementButton.addEventListener("click", () => lockManagement());
  elements.profilesTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile-action]");
    if (!button) return;
    if (button.dataset.profileAction === "edit") openEditDialog(button.dataset.profileId);
    if (button.dataset.profileAction === "delete") deleteProfile(button.dataset.profileId);
  });
  elements.editForm.addEventListener("submit", updateProfile);
  elements.cancelEditButton.addEventListener("click", () => elements.editDialog.close());
  elements.commandTrigger.addEventListener("click", openCommandDialog);
  elements.closeCommandButton.addEventListener("click", closeCommandDialog);
  elements.commandDialog.addEventListener("click", (event) => {
    if (event.target === elements.commandDialog) closeCommandDialog();
  });
  elements.commandInput.addEventListener("input", () => {
    const query = elements.commandInput.value.trim().toLocaleLowerCase("vi");
    elements.commandList.querySelectorAll(".command-option").forEach((option) => {
      option.hidden = query && !option.textContent.toLocaleLowerCase("vi").includes(query);
    });
  });
  elements.commandInput.addEventListener("keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const options = [...elements.commandList.querySelectorAll(".command-option:not([hidden])")];
    if (!options.length) return;
    event.preventDefault();
    options[event.key === "ArrowDown" ? 0 : options.length - 1].focus();
  });
  elements.commandList.addEventListener("click", (event) => {
    const option = event.target.closest("[data-command]");
    if (option) executeCommand(option.dataset.command);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (elements.commandDialog.open) closeCommandDialog(); else openCommandDialog();
    }
    if (elements.commandDialog.open && ["1", "2", "3"].includes(event.key) && document.activeElement !== elements.commandInput) {
      executeCommand({ 1: "register", 2: "recognize", 3: "manage" }[event.key]);
    }
  });
  elements.commandList.addEventListener("keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const options = [...elements.commandList.querySelectorAll(".command-option:not([hidden])")];
    const current = options.indexOf(event.target.closest(".command-option"));
    if (current < 0) return;
    event.preventDefault();
    options[(current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length].focus();
  });
  window.addEventListener("beforeunload", stopCamera);

  switchTab("register", false);
  checkHealth();
  startCamera("register");
})();
