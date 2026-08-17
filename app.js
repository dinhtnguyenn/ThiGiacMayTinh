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
    registerButton: document.getElementById("registerButton"),
    registrationMessage: document.getElementById("registrationMessage"),
    registerProcessingTrace: document.getElementById("registerProcessingTrace"),
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
    calibrateThresholdButton: document.getElementById("calibrateThresholdButton"),
    calibrationPanel: document.getElementById("calibrationPanel"),
    calibrationResult: document.getElementById("calibrationResult"),
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
    detailsDialog: document.getElementById("detailsDialog"),
    closeDetailsButton: document.getElementById("closeDetailsButton"),
    detailsProfileSummary: document.getElementById("detailsProfileSummary"),
    detailsProfileFields: document.getElementById("detailsProfileFields"),
    detailsImageStorage: document.getElementById("detailsImageStorage"),
    detailsSamples: document.getElementById("detailsSamples"),
  };

  const state = {
    activeTab: "register",
    adminToken: null,
    profiles: [],
    stream: null,
    cameraContext: null,
    trackingTimer: null,
    trackingRequestActive: false,
    browserDetector: null,
    browserTrackingFrame: null,
    browserTrackingBusy: false,
    latestRecognition: null,
    recognitionTracks: [],
    enrollmentTokens: new Map(),
    livenessSession: null,
    livenessStarting: false,
  };

  const REQUIRED_RECOGNITION_CONFIRMATIONS = 2;

  function errorMessage(error) {
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác.";
  }

  function enrollmentKey(name) {
    return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
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
      const message = typeof detail === "string"
        ? detail
        : detail && detail.message
          ? detail.message
          : response.status >= 500
            ? "Máy chủ đang gặp lỗi tạm thời (HTTP " + response.status + "). Hãy thử lại sau."
            : "Máy chủ từ chối yêu cầu (HTTP " + response.status + ").";
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

  function browserFaceDetector() {
    if (!("FaceDetector" in window)) return null;
    if (!state.browserDetector) {
      try {
        state.browserDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      } catch {
        return null;
      }
    }
    return state.browserDetector;
  }

  function labelsForBrowserFaces(faces) {
    const latest = state.latestRecognition;
    if (!latest || !Array.isArray(latest.faces) || !latest.faces.length) return [];
    return faces.map((face) => {
      const centerX = (face.box[0] + face.box[2]) / 2;
      const centerY = (face.box[1] + face.box[3]) / 2;
      let nearest = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      latest.faces.forEach((candidate) => {
        if (!Array.isArray(candidate.box) || candidate.box.length !== 4) return;
        const candidateX = (candidate.box[0] + candidate.box[2]) / 2;
        const candidateY = (candidate.box[1] + candidate.box[3]) / 2;
        const distance = Math.hypot(centerX - candidateX, centerY - candidateY);
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      });
      return nearestDistance < Math.max(face.box[2] - face.box[0], face.box[3] - face.box[1]) * 1.5 ? nearest : null;
    });
  }

  function faceCenter(face, imageWidth, imageHeight) {
    const box = Array.isArray(face.box) ? face.box : [];
    if (box.length !== 4 || !imageWidth || !imageHeight) return null;
    return {
      x: (Number(box[0]) + Number(box[2])) / (2 * imageWidth),
      y: (Number(box[1]) + Number(box[3])) / (2 * imageHeight),
    };
  }

  function stabilizeRecognitionFaces(faces, imageWidth, imageHeight) {
    const previousTracks = [...state.recognitionTracks];
    const nextTracks = [];
    const stabilized = faces.map((face) => {
      const center = faceCenter(face, imageWidth, imageHeight);
      const profileId = face.matched && face.profile ? face.profile.id : null;
      let previous = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      previousTracks.forEach((track) => {
        if (!center || !track.center) return;
        const distance = Math.hypot(center.x - track.center.x, center.y - track.center.y);
        if (distance < closestDistance) {
          previous = track;
          closestDistance = distance;
        }
      });
      const sameIdentity = Boolean(
        profileId && previous && closestDistance < 0.2 && previous.profileId === profileId,
      );
      const confirmationCount = profileId
        ? Math.min(REQUIRED_RECOGNITION_CONFIRMATIONS, sameIdentity ? previous.confirmationCount + 1 : 1)
        : 0;
      const confirmed = Boolean(profileId) && confirmationCount >= REQUIRED_RECOGNITION_CONFIRMATIONS;
      nextTracks.push({ center, profileId, confirmationCount });
      return {
        ...face,
        serverMatched: Boolean(profileId),
        matched: confirmed,
        pending: Boolean(profileId) && !confirmed,
        confirmationCount,
      };
    });
    state.recognitionTracks = nextTracks;
    return stabilized;
  }

  async function detectFacesInBrowser(context) {
    const detector = browserFaceDetector();
    const video = videoFor(context);
    if (!detector || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    state.browserTrackingBusy = true;
    try {
      const detected = await detector.detect(video);
      const faces = detected.map((face) => {
        const box = face.boundingBox;
        return { box: [box.x, box.y, box.x + box.width, box.y + box.height] };
      });
      if (state.cameraContext !== context || !state.stream) return;
      drawTracking(context, faces, video.videoWidth, video.videoHeight, context === "recognize" ? labelsForBrowserFaces(faces) : []);
    } catch {
      // The server-provided box remains available as a compatibility fallback.
    } finally {
      state.browserTrackingBusy = false;
    }
  }

  function runBrowserTracking(context) {
    if (state.cameraContext !== context || !state.stream) return;
    if (!state.browserTrackingBusy) detectFacesInBrowser(context);
    state.browserTrackingFrame = window.requestAnimationFrame(() => runBrowserTracking(context));
  }

  function startBrowserTracking(context) {
    if (!browserFaceDetector()) return;
    if (state.browserTrackingFrame) window.cancelAnimationFrame(state.browserTrackingFrame);
    state.browserTrackingFrame = window.requestAnimationFrame(() => runBrowserTracking(context));
  }

  async function captureFrame(context, filename, maxDimension = 0) {
    const video = videoFor(context);
    if (!state.stream || state.cameraContext !== context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new ApiError("Camera chưa sẵn sàng.", "camera_required", 422);
    }
    const canvas = document.createElement("canvas");
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 480;
    const scale = maxDimension ? Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight)) : 1;
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new ApiError("Không thể chụp hình từ camera.", "capture_unavailable");
    drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new ApiError("Không thể tạo ảnh camera.", "capture_failed")), "image/jpeg", 0.82);
    });
    return new File([blob], filename, { type: "image/jpeg" });
  }

  async function trackCamera(context) {
    if (state.livenessSession || state.trackingRequestActive || state.cameraContext !== context || !state.stream) return;
    if (videoFor(context).readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      state.trackingTimer = window.setTimeout(() => trackCamera(context), 300);
      return;
    }
    state.trackingRequestActive = true;
    try {
      const image = await captureFrame(context, "tracking.jpg", 640);
      const form = new FormData();
      form.append("image", image, image.name);
      const payload = await apiFetch("/api/tracking", { method: "POST", body: form });
      const faces = Array.isArray(payload.faces) ? payload.faces : [];
      drawTracking(context, faces, payload.image_width, payload.image_height);
      if (context === "recognize") {
        if (faces.length === 1) {
          beginAutomaticLiveness("recognize");
        } else if (faces.length > 1) {
          setRecognition("idle", "Cần một người trong khung", "Để xác thực người thật, hãy đặt từng người vào khung hình.");
          renderRecognitionFaces([]);
          setCameraStatus(context, "Đang theo dõi " + faces.length + " khuôn mặt. Cần một người để xác thực.");
        } else {
          state.latestRecognition = null;
          state.recognitionTracks = [];
          setRecognition("idle", "Đang chờ khuôn mặt", "Đặt một người vào khung hình để bắt đầu.");
          renderRecognitionFaces([]);
          setCameraStatus(context, "Chưa thấy khuôn mặt.");
        }
      } else {
        setCameraStatus(context, faces.length ? "Đang theo dõi " + faces.length + " khuôn mặt." : "Chưa thấy khuôn mặt.");
      }
    } catch (error) {
      clearTracking(context);
      if (context === "recognize" && !(error instanceof ApiError && error.code === "face_not_found")) {
        setRecognition("error", "Không thể kiểm tra camera", errorMessage(error));
      }
    } finally {
      state.trackingRequestActive = false;
      if (state.cameraContext === context && state.stream) {
        state.trackingTimer = window.setTimeout(() => trackCamera(context), context === "recognize" ? 700 : 900);
      }
    }
  }

  function startTracking(context) {
    if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
    startBrowserTracking(context);
    if (context === "register" && browserFaceDetector()) {
      setCameraStatus(context, "Đang theo dõi khuôn mặt trên thiết bị.");
      return;
    }
    state.trackingTimer = window.setTimeout(() => trackCamera(context), 120);
  }

  function stopCamera() {
    if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
    if (state.browserTrackingFrame) window.cancelAnimationFrame(state.browserTrackingFrame);
    state.trackingTimer = null;
    state.browserTrackingFrame = null;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    state.cameraContext = null;
    state.trackingRequestActive = false;
    state.browserTrackingBusy = false;
    state.latestRecognition = null;
    state.recognitionTracks = [];
    clearLivenessSession();
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
      item.dataset.state = face.matched ? "match" : face.pending ? "pending" : "empty";
      const label = face.matched && face.profile
        ? face.profile.name
        : face.pending && face.profile
          ? "Đang xác nhận: " + face.profile.name + " (" + face.confirmationCount + "/" + REQUIRED_RECOGNITION_CONFIRMATIONS + ")"
          : "Chưa có dữ liệu";
      item.textContent = "Người " + (index + 1) + ": " + label;
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
    beginAutomaticLiveness("register", {
      name,
      enrollmentToken: state.enrollmentTokens.get(enrollmentKey(name)),
    });
  }

  async function requestRecognition(image, options = {}) {
    const form = new FormData();
    form.append("mode", options.mode || "liveness");
    form.append("image", image, image.name);
    if (options.challengeId) form.append("challenge_id", options.challengeId);
    if (options.baselineImage) form.append("baseline_image", options.baselineImage, options.baselineImage.name);
    return apiFetch("/api/recognitions", { method: "POST", body: form });
  }

  function clearLivenessSession() {
    if (state.livenessSession) state.livenessSession.cancelled = true;
    state.livenessSession = null;
  }

  function livenessFailureMessage(error) {
    if (error instanceof ApiError && ["liveness_challenge_failed", "multiple_faces", "face_not_found"].includes(error.code)) {
      return "Không thể xác thực người thật. Không dùng ảnh, màn hình hoặc video; hãy nhìn camera và xoay nhẹ đầu rồi thử lại.";
    }
    return errorMessage(error);
  }

  function pause(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function beginAutomaticLiveness(context, registration = null) {
    if (state.livenessSession || state.livenessStarting) return;
    state.livenessStarting = true;
    try {
      if (!(await startCamera(context)) || state.activeTab !== context || state.cameraContext !== context) return;
      if (state.trackingTimer) window.clearTimeout(state.trackingTimer);
      const session = { context, registration, cancelled: false };
      state.livenessSession = session;
      if (context === "register") {
        setMessage(elements.registrationMessage, "Đang xác thực người thật...", "");
        setButtonState(elements.registerButton, "loading", "Đang xác thực...");
      } else {
        setRecognition("idle", "Đang xác thực người thật", "Hãy nhìn camera và xoay nhẹ đầu.");
      }
      setCameraStatus(context, "Đang xác thực người thật. Hãy xoay nhẹ đầu.");
      const challenge = await apiFetch("/api/liveness/challenge", { method: "POST" });
      const baselineImage = await captureFrame(context, "liveness-baseline.jpg", 640);
      if (session.cancelled || state.livenessSession !== session) return;
      session.challengeId = challenge.challenge_id;
      session.baselineImage = baselineImage;
      // The two frames stay automatic, but this pause gives the person time to react.
      await pause(3000);
      if (session.cancelled || state.livenessSession !== session) return;
      const actionImage = await captureFrame(context, "liveness-action.jpg", 640);
      if (session.cancelled || state.livenessSession !== session) return;
      if (context === "register") {
        const form = new FormData();
        form.append("name", registration.name);
        form.append("consent", "true");
        form.append("mode", "liveness");
        form.append("image", actionImage, actionImage.name);
        form.append("challenge_id", session.challengeId);
        form.append("baseline_image", session.baselineImage, session.baselineImage.name);
        if (registration.enrollmentToken) form.append("enrollment_token", registration.enrollmentToken);
        const payload = await apiFetch("/api/profiles", { method: "POST", body: form });
        if (session.cancelled || state.livenessSession !== session) return;
        renderProcessing("register", payload.processing);
        const enrollment = payload.enrollment || {};
        if (enrollment.enrollment_token) state.enrollmentTokens.set(enrollmentKey(registration.name), enrollment.enrollment_token);
        elements.personName.value = "";
        const sampleCount = Number(enrollment.sample_count) || 1;
        const maxSamples = Number(enrollment.max_samples) || sampleCount;
        setMessage(
          elements.registrationMessage,
          (enrollment.created_profile ? "Đăng ký thành công: " : "Đã thêm mẫu khuôn mặt cho ")
            + payload.profile.name + ". Mẫu " + sampleCount + "/" + maxSamples + ".",
          "success",
        );
        setButtonState(elements.registerButton, "success", "Đã đăng ký");
        setCameraStatus(context, "Đã xác thực người thật và lưu mẫu.", "success");
      } else {
        const payload = await requestRecognition(actionImage, {
          mode: "liveness", challengeId: session.challengeId, baselineImage: session.baselineImage,
        });
        if (session.cancelled || state.livenessSession !== session) return;
        applyRecognition(payload, false);
        drawTracking("recognize", payload.faces, payload.image_width, payload.image_height, payload.faces);
        setCameraStatus(context, payload.matched ? "Đã xác thực người thật và nhận diện." : "Đã xác thực người thật. Chưa có dữ liệu.", "success");
      }
    } catch (error) {
      if (state.livenessSession && state.livenessSession.context === context && !state.livenessSession.cancelled) {
        const message = livenessFailureMessage(error);
        if (context === "register") {
          setMessage(elements.registrationMessage, message, "error");
          setButtonState(elements.registerButton, "error", "Thử lại");
        } else {
          setRecognition("error", "Không thể xác thực người thật", message);
          renderRecognitionFaces([]);
        }
        setCameraStatus(context, message, "error");
      }
    } finally {
      state.livenessStarting = false;
      const wasCurrentSession = state.livenessSession && state.livenessSession.context === context;
      if (wasCurrentSession) state.livenessSession = null;
      if (context === "recognize" && state.cameraContext === context && state.stream) {
        state.trackingTimer = window.setTimeout(() => startTracking(context), 1600);
      }
    }
  }

  function applyRecognition(payload, drawCamera) {
    const rawFaces = Array.isArray(payload.faces) ? payload.faces : [];
    const faces = drawCamera
      ? stabilizeRecognitionFaces(rawFaces, payload.image_width, payload.image_height)
      : rawFaces;
    const matchedCount = faces.filter((face) => face.matched && face.profile).length;
    const pendingCount = faces.filter((face) => face.pending && face.profile).length;
    state.latestRecognition = { faces };
    renderProcessing("recognize", payload.processing);
    renderRecognitionFaces(faces);
    if (drawCamera && state.cameraContext === "recognize") {
      drawTracking("recognize", faces, payload.image_width, payload.image_height, faces);
    }
    if (matchedCount) {
      setRecognition("match", "Đã tìm thấy dữ liệu", "Khớp " + matchedCount + " khuôn mặt.");
    } else if (pendingCount) {
      setRecognition("idle", "Đang xác nhận", "Đã thấy " + pendingCount + " khuôn mặt; kiểm tra thêm một khung hình.");
    } else {
      setRecognition("empty", "Chưa có dữ liệu", "Không tìm thấy khuôn mặt đã đăng ký.");
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
    cell.colSpan = 4;
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
      const samples = document.createElement("td");
      samples.textContent = String(profile.sample_count || 0);
      const date = document.createElement("td");
      date.textContent = displayDate(profile.created_at);
      const actions = document.createElement("td");
      ["Chi tiết", "Sửa", "Xóa"].forEach((label) => {
        const button = document.createElement("button");
        button.className = "table-button";
        button.type = "button";
        button.dataset.action = label === "Chi tiết" ? "details" : label === "Sửa" ? "edit" : "delete";
        button.dataset.profileId = profile.id;
        button.textContent = label;
        actions.append(button);
      });
      row.append(name, samples, date, actions);
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

  async function calibrateThreshold() {
    setButtonState(elements.calibrateThresholdButton, "loading", "Đang tính...");
    try {
      const report = await apiFetch("/api/calibration", { admin: true, cache: "no-store" });
      elements.calibrationPanel.open = true;
      const counts = report.genuine_pairs + " cặp cùng người, " + report.impostor_pairs + " cặp khác người.";
      elements.calibrationResult.textContent = report.ready
        ? counts + " Ngưỡng hiện tại: " + report.current_threshold + ". Gợi ý: " + report.recommended_threshold
          + " (FAR ước lượng: " + report.estimated_far + ", FRR: " + report.estimated_frr + "). " + report.notice
        : counts + " " + report.notice;
      setButtonState(elements.calibrateThresholdButton, "success", "Đã tính");
    } catch (error) {
      elements.calibrationResult.textContent = errorMessage(error);
      setButtonState(elements.calibrateThresholdButton, "error", "Thử lại");
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
    closeDetailsDialog();
    setMessage(elements.managementMessage, message);
  }

  function addDetailField(label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    definition.textContent = value;
    elements.detailsProfileFields.append(term, definition);
  }

  function clearDetails() {
    elements.detailsProfileSummary.textContent = "";
    elements.detailsProfileFields.replaceChildren();
    elements.detailsImageStorage.textContent = "";
    elements.detailsSamples.replaceChildren();
  }

  function closeDetailsDialog() {
    if (elements.detailsDialog.open) elements.detailsDialog.close();
    clearDetails();
  }

  function renderProfileDetails(payload) {
    clearDetails();
    const profile = payload.profile || {};
    const samples = Array.isArray(payload.samples) ? payload.samples : [];
    elements.detailsProfileSummary.textContent = profile.name + " · " + samples.length + " mẫu embedding";
    addDetailField("Mã hồ sơ", profile.id || "Không xác định");
    addDetailField("Đăng ký", displayDate(profile.created_at));
    addDetailField("Nguồn", profile.source_mode || "Không xác định");
    addDetailField("Kiểu lưu", "Embedding float32 trên server");
    const imageStorage = payload.raw_image_storage || {};
    elements.detailsImageStorage.textContent = imageStorage.message || "Không có thông tin lưu ảnh.";
    samples.forEach((sample, index) => {
      const section = document.createElement("article");
      section.className = "detail-sample";
      const heading = document.createElement("h3");
      heading.textContent = "Mẫu " + (index + 1);
      const metadata = document.createElement("p");
      const quality = typeof sample.quality_score === "number" ? sample.quality_score.toFixed(3) : "Chưa có (mẫu cũ)";
      metadata.textContent = "Mã mẫu: " + sample.id + " · " + displayDate(sample.created_at) + " · chất lượng: " + quality + " · " + sample.embedding_dimension + " chiều";
      const vectorLabel = document.createElement("label");
      const vectorId = "embeddingVector" + index;
      vectorLabel.htmlFor = vectorId;
      vectorLabel.textContent = "Vector embedding đầy đủ (float32)";
      const vector = document.createElement("textarea");
      vector.id = vectorId;
      vector.className = "embedding-vector";
      vector.readOnly = true;
      vector.rows = 8;
      vector.spellcheck = false;
      vector.value = JSON.stringify(Array.isArray(sample.embedding_vector) ? sample.embedding_vector : []);
      const removeButton = document.createElement("button");
      removeButton.className = "table-button";
      removeButton.type = "button";
      removeButton.textContent = "Xóa mẫu này";
      removeButton.addEventListener("click", () => deleteProfileSample(profile.id, sample.id));
      section.append(heading, metadata, vectorLabel, vector, removeButton);
      elements.detailsSamples.append(section);
    });
  }

  async function openDetailsDialog(profileId) {
    if (!state.adminToken) return;
    try {
      const payload = await apiFetch("/api/profiles/" + encodeURIComponent(profileId) + "/details", { admin: true, cache: "no-store" });
      renderProfileDetails(payload);
      elements.detailsDialog.showModal();
      elements.closeDetailsButton.focus();
    } catch (error) {
      elements.managementSummary.textContent = errorMessage(error);
      if (error.status === 401 || error.status === 503) lockManagement(errorMessage(error));
    }
  }

  async function deleteProfileSample(profileId, sampleId) {
    if (!window.confirm("Xóa mẫu embedding này? Không thể hoàn tác.")) return;
    try {
      await apiFetch(
        "/api/profiles/" + encodeURIComponent(profileId) + "/samples/" + encodeURIComponent(sampleId),
        { admin: true, method: "DELETE" },
      );
      closeDetailsDialog();
      await loadProfiles();
      elements.managementSummary.textContent = "Đã xóa mẫu. Mở lại Chi tiết để xem dữ liệu mới.";
    } catch (error) {
      elements.managementSummary.textContent = errorMessage(error);
    }
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
      state.recognitionTracks = [];
      clearLivenessSession();
      setRecognition("idle", "Đang chờ khuôn mặt", "Đặt một người vào khung hình để bắt đầu.");
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
  elements.adminForm.addEventListener("submit", unlockManagement);
  elements.refreshDataButton.addEventListener("click", loadProfiles);
  elements.calibrateThresholdButton.addEventListener("click", calibrateThreshold);
  elements.lockManagementButton.addEventListener("click", () => lockManagement());
  elements.profilesTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "details") openDetailsDialog(button.dataset.profileId);
    if (button.dataset.action === "edit") openEditDialog(button.dataset.profileId);
    if (button.dataset.action === "delete") deleteProfile(button.dataset.profileId);
  });
  elements.editForm.addEventListener("submit", updateProfile);
  elements.cancelEditButton.addEventListener("click", () => elements.editDialog.close());
  elements.closeDetailsButton.addEventListener("click", closeDetailsDialog);
  elements.detailsDialog.addEventListener("cancel", () => window.setTimeout(clearDetails, 0));
  window.addEventListener("beforeunload", stopCamera);

  switchTab("register", false);
})();
