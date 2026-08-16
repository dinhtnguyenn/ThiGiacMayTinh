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
    // Tabs
    tabRegister: document.getElementById("tabRegister"),
    tabRecognize: document.getElementById("tabRecognize"),
    tabManage: document.getElementById("tabManage"),
    registerView: document.getElementById("registerView"),
    recognitionView: document.getElementById("recognitionView"),
    manageView: document.getElementById("manageView"),

    // Register
    liveVideoRegister: document.getElementById("liveVideoRegister"),
    cameraPanelRegister: document.getElementById("cameraPanelRegister"),
    cameraStatusRegister: document.getElementById("cameraStatusRegister"),
    startCameraRegister: document.getElementById("startCameraRegister"),
    registrationForm: document.getElementById("registrationForm"),
    personName: document.getElementById("personName"),
    consentInput: document.getElementById("consentInput"),
    registerButton: document.getElementById("registerButton"),
    registrationMessage: document.getElementById("registrationMessage"),

    // Recognize
    liveVideoRecognize: document.getElementById("liveVideoRecognize"),
    cameraPanelRecognize: document.getElementById("cameraPanelRecognize"),
    cameraStatusRecognize: document.getElementById("cameraStatusRecognize"),
    startCameraRecognize: document.getElementById("startCameraRecognize"),
    recognizeButton: document.getElementById("recognizeButton"),
    recognitionResult: document.getElementById("recognitionResult"),

    // Manage
    refreshDataButton: document.getElementById("refreshDataButton"),
    profilesTableBody: document.getElementById("profilesTableBody"),
    
    // Dialog
    editDialog: document.getElementById("editDialog"),
    editForm: document.getElementById("editForm"),
    editProfileId: document.getElementById("editProfileId"),
    editProfileName: document.getElementById("editProfileName"),
    cancelEditButton: document.getElementById("cancelEditButton"),
  };

  const state = {
    stream: null,
    activeTab: "register", // 'register', 'recognize', 'manage'
  };

  function errorMessage(error) {
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Hãy thử lại.";
  }

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      options.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      throw new ApiError("Không kết nối được máy chủ. Hãy kiểm tra lại đường truyền.", "network_error");
    }

    if (response.status === 204) return null;

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
      throw new ApiError(message, code, response.status);
    }
    return body;
  }

  // UI Helpers
  function setButtonState(button, status, label) {
    const original = button.dataset.originalHtml || button.innerHTML;
    button.dataset.originalHtml = original;
    button.dataset.state = status;
    button.disabled = status === "loading";
    button.textContent = label;
    if (status === "success" || status === "error") {
      window.setTimeout(() => {
        delete button.dataset.state;
        button.disabled = false;
        button.innerHTML = button.dataset.originalHtml || button.innerHTML;
      }, status === "success" ? 1500 : 2200);
    }
  }

  function setCameraStatus(panelContext, text, tone = "neutral") {
    const el = panelContext === "register" ? elements.cameraStatusRegister : elements.cameraStatusRecognize;
    el.textContent = text;
    el.dataset.state = tone;
  }

  function setFormMessage(text = "", tone = "neutral") {
    elements.registrationMessage.textContent = text;
    elements.registrationMessage.dataset.state = tone;
  }

  function setRecognition(stateName, title, detail) {
    elements.recognitionResult.dataset.state = stateName;
    elements.recognitionResult.querySelector("strong").textContent = title;
    elements.recognitionResult.querySelector("span").textContent = detail;
  }

  // Tab Logic
  function switchTab(tabId) {
    stopCamera(); // Always stop camera when switching tabs
    state.activeTab = tabId;

    // Reset UI tabs
    elements.tabRegister.classList.remove("is-active");
    elements.tabRegister.setAttribute("aria-selected", "false");
    elements.tabRecognize.classList.remove("is-active");
    elements.tabRecognize.setAttribute("aria-selected", "false");
    elements.tabManage.classList.remove("is-active");
    elements.tabManage.setAttribute("aria-selected", "false");

    // Hide all views
    elements.registerView.hidden = true;
    elements.recognitionView.hidden = true;
    elements.manageView.hidden = true;
    elements.registerView.classList.remove("is-active");
    elements.recognitionView.classList.remove("is-active");
    elements.manageView.classList.remove("is-active");

    if (tabId === "register") {
      elements.tabRegister.classList.add("is-active");
      elements.tabRegister.setAttribute("aria-selected", "true");
      elements.registerView.hidden = false;
      elements.registerView.classList.add("is-active");
      setCameraStatus("register", "Sẵn sàng.");
    } else if (tabId === "recognize") {
      elements.tabRecognize.classList.add("is-active");
      elements.tabRecognize.setAttribute("aria-selected", "true");
      elements.recognitionView.hidden = false;
      elements.recognitionView.classList.add("is-active");
      setRecognition("idle", "Chưa có thông tin", "Hệ thống sẽ đối chiếu với cơ sở dữ liệu.");
      setCameraStatus("recognize", "Sẵn sàng.");
    } else if (tabId === "manage") {
      elements.tabManage.classList.add("is-active");
      elements.tabManage.setAttribute("aria-selected", "true");
      elements.manageView.hidden = false;
      elements.manageView.classList.add("is-active");
      loadProfiles();
    }
  }

  // Camera Logic
  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    elements.cameraPanelRegister.classList.remove("is-live");
    elements.cameraPanelRecognize.classList.remove("is-live");
  }

  async function startCamera(context) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus(context, "Trình duyệt này không hỗ trợ camera.", "error");
      return;
    }

    const trigger = context === "register" ? elements.startCameraRegister : elements.startCameraRecognize;
    const video = context === "register" ? elements.liveVideoRegister : elements.liveVideoRecognize;
    const panel = context === "register" ? elements.cameraPanelRegister : elements.cameraPanelRecognize;

    setButtonState(trigger, "loading", "Đang mở...");
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      panel.classList.add("is-live");
      setCameraStatus(context, "Camera đã sẵn sàng.", "success");
      setButtonState(trigger, "success", "Camera đã mở");
    } catch (error) {
      const message = error && error.name === "NotAllowedError"
        ? "Bạn chưa cho phép sử dụng camera. Hãy cấp quyền rồi thử lại."
        : "Không thể mở camera. Kiểm tra thiết bị rồi thử lại.";
      setCameraStatus(context, message, "error");
      setButtonState(trigger, "error", "Thử lại");
    }
  }

  async function captureFrame(context, filename) {
    const video = context === "register" ? elements.liveVideoRegister : elements.liveVideoRecognize;
    if (!state.stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new ApiError("Hãy mở camera và chờ hình ảnh hiển thị trước.", "camera_required", 422);
    }
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context2d = canvas.getContext("2d");
    if (!context2d) throw new ApiError("Không thể chụp hình từ camera.", "capture_unavailable");
    context2d.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new ApiError("Không thể mã hóa ảnh camera.", "capture_failed")),
        "image/jpeg",
        0.92,
      );
    });
    return new File([blob], filename, { type: "image/jpeg" });
  }

  // Registration
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

    setButtonState(elements.registerButton, "loading", "Đang đăng ký...");
    try {
      const image = await captureFrame("register", "registration.jpg");
      if (!elements.consentInput.checked) {
        throw new ApiError("Hãy đồng ý lưu dữ liệu trên server.", "consent_required", 422);
      }
      const form = new FormData();
      form.append("name", elements.personName.value.trim());
      form.append("consent", "true");
      form.append("mode", "image");
      form.append("image", image, image.name);
      
      const payload = await apiFetch("/api/profiles", { method: "POST", body: form });
      elements.personName.value = "";
      elements.personName.setAttribute("aria-invalid", "false");
      elements.consentInput.checked = false;
      setFormMessage("Đăng ký thành công.", "success");
      setButtonState(elements.registerButton, "success", "Đã đăng ký");
      setCameraStatus("register", "Đã lưu khuôn mặt của " + payload.profile.name + ".", "success");
    } catch (error) {
      setFormMessage(errorMessage(error), "error");
      setButtonState(elements.registerButton, "error", "Thử lại");
    }
  }

  // Recognition
  async function recognizeFace() {
    setButtonState(elements.recognizeButton, "loading", "Đang nhận diện...");
    try {
      const image = await captureFrame("recognize", "recognition.jpg");
      const form = new FormData();
      form.append("mode", "image");
      form.append("image", image, image.name);
      const payload = await apiFetch("/api/recognitions", { method: "POST", body: form });
      if (payload.matched && payload.profile) {
        setRecognition(
          "match",
          "Đã tìm thấy dữ liệu",
          "Thông tin đã lưu: " + payload.profile.name + ".",
        );
        setCameraStatus("recognize", "Nhận diện thành công.", "success");
        setButtonState(elements.recognizeButton, "success", "Đã nhận diện");
      } else {
        setRecognition("empty", "Chưa có dữ liệu", "Không tìm thấy khuôn mặt đã đăng ký.");
        setCameraStatus("recognize", "Không tìm thấy dữ liệu phù hợp.", "neutral");
        setButtonState(elements.recognizeButton, "success", "Đã kiểm tra");
      }
    } catch (error) {
      setRecognition("error", "Không thể nhận diện", errorMessage(error));
      setButtonState(elements.recognizeButton, "error", "Thử lại");
    }
  }

  // Management
  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  }

  async function loadProfiles() {
    elements.profilesTableBody.innerHTML = '<tr><td colspan="4" class="text-center">Đang tải dữ liệu...</td></tr>';
    try {
      const data = await apiFetch("/api/profiles");
      if (!data.profiles || data.profiles.length === 0) {
        elements.profilesTableBody.innerHTML = '<tr><td colspan="4" class="text-center">Chưa có dữ liệu.</td></tr>';
        return;
      }
      
      elements.profilesTableBody.innerHTML = data.profiles.map(p => `
        <tr>
          <td><strong>${escapeHTML(p.name)}</strong></td>
          <td>${new Date(p.created_at).toLocaleString('vi-VN')}</td>
          <td>${escapeHTML(p.source_mode)}</td>
          <td class="col-actions">
            <button class="text-action" onclick="window.openEditDialog('${p.id}', '${escapeHTML(p.name)}')">Sửa</button>
            <button class="delete-action" onclick="window.deleteProfile('${p.id}')">Xóa</button>
          </td>
        </tr>
      `).join('');
    } catch (error) {
      elements.profilesTableBody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--color-error)">Lỗi: ${errorMessage(error)}</td></tr>`;
    }
  }

  window.openEditDialog = (id, currentName) => {
    elements.editProfileId.value = id;
    elements.editProfileName.value = currentName;
    elements.editDialog.showModal();
  };

  window.deleteProfile = async (id) => {
    if (!confirm("Bạn có chắc chắn muốn xóa hồ sơ này?")) return;
    try {
      await apiFetch(`/api/profiles/${id}`, { method: "DELETE" });
      loadProfiles();
    } catch (error) {
      alert(errorMessage(error));
    }
  };

  elements.editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = elements.editProfileId.value;
    const newName = elements.editProfileName.value.trim();
    if (!newName) return;
    try {
      await apiFetch(`/api/profiles/${id}`, {
        method: "PUT",
        body: { name: newName }
      });
      elements.editDialog.close();
      loadProfiles();
    } catch (error) {
      alert(errorMessage(error));
    }
  });

  elements.cancelEditButton.addEventListener("click", () => {
    elements.editDialog.close();
  });

  // Event Listeners
  elements.tabRegister.addEventListener("click", () => switchTab("register"));
  elements.tabRecognize.addEventListener("click", () => switchTab("recognize"));
  elements.tabManage.addEventListener("click", () => switchTab("manage"));

  elements.startCameraRegister.addEventListener("click", () => startCamera("register"));
  elements.startCameraRecognize.addEventListener("click", () => startCamera("recognize"));
  
  elements.registrationForm.addEventListener("submit", registerFace);
  elements.personName.addEventListener("blur", validateName);
  elements.personName.addEventListener("input", () => {
    if (elements.personName.getAttribute("aria-invalid") === "true") validateName();
  });
  
  elements.recognizeButton.addEventListener("click", recognizeFace);
  elements.refreshDataButton.addEventListener("click", loadProfiles);
  
  window.addEventListener("beforeunload", stopCamera);

  // Init
  switchTab("register");
  
  // Quick health check on startup
  apiFetch("/api/health", { cache: "no-store" }).catch(() => {
    console.warn("Face engine might not be ready yet.");
  });
})();
