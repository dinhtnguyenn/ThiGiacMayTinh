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
    liveVideo: document.getElementById("liveVideo"),
    cameraPanel: document.getElementById("cameraPanel"),
    cameraStatus: document.getElementById("cameraStatus"),
    startCamera: document.getElementById("startCamera"),
    openCameraForRecognition: document.getElementById("openCameraForRecognition"),
    personName: document.getElementById("personName"),
    consentInput: document.getElementById("consentInput"),
    registrationForm: document.getElementById("registrationForm"),
    registrationMessage: document.getElementById("registrationMessage"),
    registerButton: document.getElementById("registerButton"),
    recognizeButton: document.getElementById("recognizeButton"),
    recognitionResult: document.getElementById("recognitionResult"),
    registerView: document.getElementById("registerView"),
    recognitionView: document.getElementById("recognitionView"),
    progressRegister: document.getElementById("progressRegister"),
    progressRecognize: document.getElementById("progressRecognize"),
    goToRecognition: document.getElementById("goToRecognition"),
    restartButton: document.getElementById("restartButton"),
  };

  const state = {
    stream: null,
  };

  function errorMessage(error) {
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Hãy thử lại.";
  }

  async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});

    let response;
    try {
      response = await fetch(path, { ...options, headers });
    } catch {
      throw new ApiError("Không kết nối được máy chủ. Hãy kiểm tra lại đường truyền.", "network_error");
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
      throw new ApiError(message, code, response.status);
    }
    return body;
  }

  function setCameraStatus(text, tone = "neutral") {
    elements.cameraStatus.textContent = text;
    elements.cameraStatus.dataset.state = tone;
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

  function showView(viewName, moveFocus = false) {
    const showingRecognition = viewName === "recognition";
    elements.registerView.hidden = showingRecognition;
    elements.recognitionView.hidden = !showingRecognition;
    elements.goToRecognition.hidden = showingRecognition;
    elements.restartButton.hidden = !showingRecognition;
    elements.progressRegister.classList.toggle("is-current", !showingRecognition);
    elements.progressRecognize.classList.toggle("is-current", showingRecognition);
    if (moveFocus) {
      const target = showingRecognition
        ? document.getElementById("recognitionTitle")
        : document.getElementById("registerTitle");
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  }

  function requireConsent() {
    if (!elements.consentInput.checked) {
      throw new ApiError("Hãy đồng ý lưu dữ liệu trên server trước khi đăng ký khuôn mặt.", "consent_required", 422);
    }
  }

  function stopCamera() {
    if (!state.stream) return;
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  async function startCamera(trigger = elements.startCamera) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus("Trình duyệt này không hỗ trợ camera.", "error");
      return;
    }

    setButtonState(trigger, "loading", "Đang mở...");
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      state.stream = stream;
      elements.liveVideo.srcObject = stream;
      await elements.liveVideo.play();
      elements.cameraPanel.classList.add("is-live");
      setCameraStatus("Camera đã sẵn sàng.", "success");
      setButtonState(trigger, "success", "Camera đã mở");
    } catch (error) {
      const message = error && error.name === "NotAllowedError"
        ? "Bạn chưa cho phép sử dụng camera. Hãy cấp quyền rồi thử lại."
        : "Không thể mở camera. Kiểm tra thiết bị rồi thử lại.";
      setCameraStatus(message, "error");
      setButtonState(trigger, "error", "Thử lại");
    }
  }

  async function captureFrame(filename) {
    if (!state.stream || elements.liveVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new ApiError("Hãy mở camera và chờ hình ảnh hiển thị trước.", "camera_required", 422);
    }
    const width = elements.liveVideo.videoWidth || 640;
    const height = elements.liveVideo.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new ApiError("Không thể chụp hình từ camera.", "capture_unavailable");
    context.drawImage(elements.liveVideo, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new ApiError("Không thể mã hóa ảnh camera.", "capture_failed")),
        "image/jpeg",
        0.92,
      );
    });
    return new File([blob], filename, { type: "image/jpeg" });
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

    setButtonState(elements.registerButton, "loading", "Đang đăng ký...");
    try {
      const image = await captureFrame("registration.jpg");
      requireConsent();
      const form = new FormData();
      form.append("name", elements.personName.value.trim());
      form.append("consent", "true");
      form.append("mode", "image");
      form.append("image", image, image.name);
      const payload = await apiFetch("/api/profiles", { method: "POST", body: form });
      elements.personName.value = "";
      elements.personName.setAttribute("aria-invalid", "false");
      setFormMessage("Đăng ký thành công. Chuyển sang nhận diện.", "success");
      setButtonState(elements.registerButton, "success", "Đã đăng ký");
      setRecognition("idle", "Sẵn sàng nhận diện", "Đặt khuôn mặt vào khung hình rồi bấm Nhận diện khuôn mặt.");
      window.setTimeout(() => showView("recognition", true), prefersReducedMotion ? 0 : 300);
      setCameraStatus("Đã lưu khuôn mặt của " + payload.profile.name + " trên server.", "success");
    } catch (error) {
      setFormMessage(errorMessage(error), "error");
      setButtonState(elements.registerButton, "error", "Thử lại");
    }
  }

  async function recognizeFace() {
    setButtonState(elements.recognizeButton, "loading", "Đang nhận diện...");
    try {
      const image = await captureFrame("recognition.jpg");
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
        setCameraStatus("Nhận diện thành công.", "success");
        setButtonState(elements.recognizeButton, "success", "Đã nhận diện");
      } else {
        setRecognition("empty", "Chưa có dữ liệu", "Không tìm thấy khuôn mặt đã đăng ký.");
        setCameraStatus("Không tìm thấy dữ liệu phù hợp.", "neutral");
        setButtonState(elements.recognizeButton, "success", "Đã kiểm tra");
      }
    } catch (error) {
      setRecognition("error", "Không thể nhận diện", errorMessage(error));
      setButtonState(elements.recognizeButton, "error", "Thử lại");
    }
  }

  async function checkHealth() {
    try {
      await apiFetch("/api/health", { cache: "no-store" });
      setCameraStatus("Máy chủ đã sẵn sàng. Mở camera để bắt đầu.", "neutral");
    } catch (error) {
      setCameraStatus(errorMessage(error), "error");
    }
  }

  elements.startCamera.addEventListener("click", () => startCamera(elements.startCamera));
  elements.openCameraForRecognition.addEventListener("click", () => startCamera(elements.openCameraForRecognition));
  elements.registrationForm.addEventListener("submit", registerFace);
  elements.personName.addEventListener("blur", validateName);
  elements.personName.addEventListener("input", () => {
    if (elements.personName.getAttribute("aria-invalid") === "true") validateName();
  });
  elements.recognizeButton.addEventListener("click", recognizeFace);
  elements.goToRecognition.addEventListener("click", () => {
    setRecognition("idle", "Sẵn sàng nhận diện", "Đặt khuôn mặt vào khung hình rồi bấm Nhận diện khuôn mặt.");
    showView("recognition", true);
  });
  elements.restartButton.addEventListener("click", () => {
    showView("register", true);
    window.setTimeout(() => elements.personName.focus({ preventScroll: true }), 0);
  });
  window.addEventListener("beforeunload", stopCamera);

  showView("register");
  checkHealth();
})();
