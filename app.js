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
    refreshRegistrationProfilesButton: document.getElementById("refreshRegistrationProfilesButton"),
    registrationDirectoryStatus: document.getElementById("registrationDirectoryStatus"),
    registrationProfilesList: document.getElementById("registrationProfilesList"),
    clearRegistrationProfileButton: document.getElementById("clearRegistrationProfileButton"),
    registerButton: document.getElementById("registerButton"),
    registerUploadInput: document.getElementById("registerUploadInput"),
    registerUseCameraButton: document.getElementById("registerUseCameraButton"),
    registerPreview: document.getElementById("registerPreview"),
    registerCropEditor: document.getElementById("registerCropEditor"),
    registerCropSelection: document.getElementById("registerCropSelection"),
    registerCropHint: document.getElementById("registerCropHint"),
    registerPreviewActions: document.getElementById("registerPreviewActions"),
    confirmRegistrationButton: document.getElementById("confirmRegistrationButton"),
    cancelRegistrationButton: document.getElementById("cancelRegistrationButton"),
    registrationMessage: document.getElementById("registrationMessage"),
    registerProcessingTrace: document.getElementById("registerProcessingTrace"),
    recognitionResult: document.getElementById("recognitionResult"),
    recognitionFaces: document.getElementById("recognitionFaces"),
    recognizeUploadInput: document.getElementById("recognizeUploadInput"),
    recognizeUseCameraButton: document.getElementById("recognizeUseCameraButton"),
    recognizeUploadPreview: document.getElementById("recognizeUploadPreview"),
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
    registrationProfiles: [],
    selectedRegistrationProfile: null,
    pendingRegistration: null,
    registrationUpload: null,
    recognitionUpload: null,
    previewUrls: new Map(),
    cropEditor: null,
  };

  const REQUIRED_RECOGNITION_CONFIRMATIONS = 2;
  const DEFAULT_CROP_SELECTION = Object.freeze({ x: 0.11, y: 0.11, width: 0.78, height: 0.78 });
  const MIN_CROP_FRACTION = 0.5;
  const MAX_CROP_DIMENSION = 960;

  function errorMessage(error) {
    return error instanceof Error ? error.message : "Không thể hoàn tất thao tác.";
  }

  function enrollmentKey(name) {
    return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
  }

  function validImageFile(file) {
    return file && (file.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp)$/i.test(file.name));
  }

  function showLocalPreview(key, image, file, context) {
    const previousUrl = state.previewUrls.get(key);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const url = URL.createObjectURL(file);
    state.previewUrls.set(key, url);
    image.src = url;
    image.hidden = false;
    panelFor(context).classList.add("has-preview");
  }

  function showDataPreview(image, dataUrl, context) {
    const previousUrl = state.previewUrls.get(context);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      state.previewUrls.delete(context);
    }
    image.src = dataUrl;
    image.hidden = false;
    panelFor(context).classList.add("has-preview");
  }

  function hidePreview(image, context) {
    const previousUrl = state.previewUrls.get(context);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      state.previewUrls.delete(context);
    }
    image.removeAttribute("src");
    image.hidden = true;
    panelFor(context).classList.remove("has-preview");
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function cropImageLayout() {
    if (!state.cropEditor || elements.registerPreview.hidden) return null;
    const imageWidth = elements.registerPreview.naturalWidth;
    const imageHeight = elements.registerPreview.naturalHeight;
    const panelWidth = elements.cameraPanelRegister.clientWidth;
    const panelHeight = elements.cameraPanelRegister.clientHeight;
    if (!imageWidth || !imageHeight || !panelWidth || !panelHeight) return null;
    const scale = Math.min(panelWidth / imageWidth, panelHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return { left: (panelWidth - width) / 2, top: (panelHeight - height) / 2, width, height };
  }

  function renderCropSelection() {
    const layout = cropImageLayout();
    const editor = state.cropEditor;
    if (!layout || !editor) return;
    const selection = editor.selection;
    elements.registerCropSelection.style.left = (layout.left + selection.x * layout.width) + "px";
    elements.registerCropSelection.style.top = (layout.top + selection.y * layout.height) + "px";
    elements.registerCropSelection.style.width = (selection.width * layout.width) + "px";
    elements.registerCropSelection.style.height = (selection.height * layout.height) + "px";
  }

  function cropSelectionFromServer(candidate) {
    if (!candidate || typeof candidate !== "object") return { ...DEFAULT_CROP_SELECTION };
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    if (![x, y, width, height].every(Number.isFinite) || width < MIN_CROP_FRACTION || height < MIN_CROP_FRACTION) {
      return { ...DEFAULT_CROP_SELECTION };
    }
    const boundedWidth = clamp(width, MIN_CROP_FRACTION, 1);
    const boundedHeight = clamp(height, MIN_CROP_FRACTION, 1);
    return {
      x: clamp(x, 0, 1 - boundedWidth),
      y: clamp(y, 0, 1 - boundedHeight),
      width: boundedWidth,
      height: boundedHeight,
    };
  }

  function beginCropEditing(initialSelection) {
    state.cropEditor = { selection: cropSelectionFromServer(initialSelection), interaction: null };
    elements.registerCropEditor.hidden = false;
    elements.registerCropHint.hidden = false;
    const renderWhenReady = () => window.requestAnimationFrame(renderCropSelection);
    if (elements.registerPreview.complete && elements.registerPreview.naturalWidth) {
      renderWhenReady();
    } else {
      elements.registerPreview.addEventListener("load", renderWhenReady, { once: true });
    }
  }

  function clearCropEditing() {
    state.cropEditor = null;
    elements.registerCropEditor.hidden = true;
    elements.registerCropHint.hidden = true;
    elements.registerCropSelection.removeAttribute("style");
  }

  function moveCropSelection(initial, deltaX, deltaY) {
    return {
      ...initial,
      x: clamp(initial.x + deltaX, 0, 1 - initial.width),
      y: clamp(initial.y + deltaY, 0, 1 - initial.height),
    };
  }

  function resizeCropSelection(initial, handle, deltaX, deltaY) {
    let left = initial.x;
    let top = initial.y;
    let right = initial.x + initial.width;
    let bottom = initial.y + initial.height;
    if (handle.includes("w")) left = clamp(left + deltaX, 0, right - MIN_CROP_FRACTION);
    if (handle.includes("e")) right = clamp(right + deltaX, left + MIN_CROP_FRACTION, 1);
    if (handle.includes("n")) top = clamp(top + deltaY, 0, bottom - MIN_CROP_FRACTION);
    if (handle.includes("s")) bottom = clamp(bottom + deltaY, top + MIN_CROP_FRACTION, 1);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function cropPointerPosition(event) {
    const layout = cropImageLayout();
    if (!layout) return null;
    const panel = elements.cameraPanelRegister.getBoundingClientRect();
    return {
      x: clamp((event.clientX - panel.left - layout.left) / layout.width, 0, 1),
      y: clamp((event.clientY - panel.top - layout.top) / layout.height, 0, 1),
    };
  }

  function startCropInteraction(event) {
    if (!state.cropEditor || (event.pointerType === "mouse" && event.button !== 0)) return;
    const pointer = cropPointerPosition(event);
    if (!pointer) return;
    const handle = event.target.closest("[data-crop-handle]");
    event.preventDefault();
    state.cropEditor.interaction = {
      pointerId: event.pointerId,
      handle: handle ? handle.dataset.cropHandle : "move",
      origin: pointer,
      selection: { ...state.cropEditor.selection },
    };
    elements.registerCropSelection.setPointerCapture(event.pointerId);
  }

  function updateCropInteraction(event) {
    const editor = state.cropEditor;
    if (!editor || !editor.interaction || editor.interaction.pointerId !== event.pointerId) return;
    const pointer = cropPointerPosition(event);
    if (!pointer) return;
    event.preventDefault();
    const interaction = editor.interaction;
    const deltaX = pointer.x - interaction.origin.x;
    const deltaY = pointer.y - interaction.origin.y;
    editor.selection = interaction.handle === "move"
      ? moveCropSelection(interaction.selection, deltaX, deltaY)
      : resizeCropSelection(interaction.selection, interaction.handle, deltaX, deltaY);
    renderCropSelection();
  }

  function finishCropInteraction(event) {
    const editor = state.cropEditor;
    if (!editor || !editor.interaction || editor.interaction.pointerId !== event.pointerId) return;
    if (elements.registerCropSelection.hasPointerCapture(event.pointerId)) {
      elements.registerCropSelection.releasePointerCapture(event.pointerId);
    }
    editor.interaction = null;
  }

  function moveCropSelectionWithKeyboard(event) {
    if (!state.cropEditor || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const distance = event.shiftKey ? 0.05 : 0.015;
    const deltaX = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
    const deltaY = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
    state.cropEditor.selection = moveCropSelection(state.cropEditor.selection, deltaX, deltaY);
    renderCropSelection();
  }

  async function adjustedRegistrationCrop() {
    const editor = state.cropEditor;
    const image = elements.registerPreview;
    if (!editor || !image.naturalWidth || !image.naturalHeight) {
      throw new ApiError("Không thể lấy vùng crop. Hãy chụp lại khuôn mặt.", "crop_unavailable", 422);
    }
    const selection = editor.selection;
    const sourceX = clamp(Math.round(selection.x * image.naturalWidth), 0, image.naturalWidth - 1);
    const sourceY = clamp(Math.round(selection.y * image.naturalHeight), 0, image.naturalHeight - 1);
    const sourceWidth = clamp(Math.round(selection.width * image.naturalWidth), 1, image.naturalWidth - sourceX);
    const sourceHeight = clamp(Math.round(selection.height * image.naturalHeight), 1, image.naturalHeight - sourceY);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, MAX_CROP_DIMENSION / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new ApiError("Không thể tạo vùng crop.", "crop_unavailable", 422);
    drawing.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new ApiError("Không thể tạo vùng crop.", "crop_unavailable", 422)),
        "image/jpeg",
        0.9,
      );
    });
    return new File([blob], "registration-crop.jpg", { type: "image/jpeg" });
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
      const label = labels[index];
      const match = label && label.matched && label.profile;
      drawing.strokeStyle = match ? colorToken("--color-success") : colorToken("--color-accent");
      drawing.fillStyle = drawing.strokeStyle;
      drawing.strokeRect(x, y, boxWidth, boxHeight);
      const text = match ? recognitionLabel(labels[index]) : "Khuôn mặt " + (index + 1);
      drawing.fillText(text, x + 4, Math.max(14, y - 6));
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
        const candidateX = ((candidate.box[0] + candidate.box[2]) / 2) * videoFor("recognize").videoWidth / latest.imageWidth;
        const candidateY = ((candidate.box[1] + candidate.box[3]) / 2) * videoFor("recognize").videoHeight / latest.imageHeight;
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
    if (state.trackingRequestActive || state.cameraContext !== context || !state.stream) return;
    if (videoFor(context).readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      state.trackingTimer = window.setTimeout(() => trackCamera(context), 300);
      return;
    }
    state.trackingRequestActive = true;
    try {
      const image = await captureFrame(context, "tracking.jpg", 512);
      if (context !== "recognize") return;
      const payload = await requestRecognition(image);
      applyRecognition(payload, true);
      const faceCount = Array.isArray(payload.faces) ? payload.faces.length : 0;
      setCameraStatus(context, faceCount ? "Đang kiểm tra " + faceCount + " khuôn mặt." : "Chưa thấy khuôn mặt.");
    } catch (error) {
      if (context === "recognize" && error instanceof ApiError && error.code === "face_not_found") {
        state.latestRecognition = null;
        state.recognitionTracks = [];
        renderRecognitionFaces([]);
        setRecognition("idle", "Đang chờ khuôn mặt", "Đặt một hoặc nhiều người vào khung hình để bắt đầu.");
        setCameraStatus(context, "Chưa thấy khuôn mặt.");
      } else if (context === "recognize") {
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
    if (context === "register") {
      setCameraStatus(
        context,
        browserFaceDetector() ? "Đang theo dõi khuôn mặt trên thiết bị." : "Camera đã sẵn sàng. Đặt một khuôn mặt vào khung.",
      );
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

  function setRegistrationPendingState(isPending) {
    elements.personName.disabled = isPending;
    elements.registerUploadInput.disabled = isPending;
    elements.registerUseCameraButton.disabled = isPending;
    elements.registerButton.disabled = isPending;
    elements.refreshRegistrationProfilesButton.disabled = isPending;
    elements.clearRegistrationProfileButton.disabled = isPending;
    renderRegistrationProfiles();
    if (isPending) {
      elements.registerButton.textContent = "Chờ xác nhận";
      elements.registerButton.dataset.state = "pending";
      return;
    }
    delete elements.registerButton.dataset.state;
    elements.registerButton.textContent = elements.registerButton.dataset.defaultLabel || "Đăng ký khuôn mặt";
  }

  function clearRegistrationPreview() {
    state.pendingRegistration = null;
    elements.registerPreviewActions.hidden = true;
    clearCropEditing();
    hidePreview(elements.registerPreview, "register");
    setRegistrationPendingState(false);
  }

  function selectedRegistrationProfile() {
    const selectedId = state.selectedRegistrationProfile && state.selectedRegistrationProfile.id;
    return state.registrationProfiles.find((profile) => profile.id === selectedId) || state.selectedRegistrationProfile;
  }

  function renderRegistrationProfiles() {
    const selected = selectedRegistrationProfile();
    elements.registrationProfilesList.replaceChildren();
    elements.clearRegistrationProfileButton.hidden = !selected;
    elements.personName.readOnly = Boolean(selected);
    elements.registrationProfilesList.disabled = Boolean(state.pendingRegistration);
    const newProfileOption = document.createElement("option");
    newProfileOption.value = "";
    newProfileOption.textContent = "Đăng ký người mới";
    elements.registrationProfilesList.append(newProfileOption);
    if (!state.registrationProfiles.length) {
      elements.registrationDirectoryStatus.textContent = "Chưa có hồ sơ nào. Nhập tên để đăng ký người mới.";
      return;
    }
    elements.registrationDirectoryStatus.textContent = selected
      ? "Đang thêm mẫu cho " + selected.name + "."
      : "Chọn một người để thêm ảnh mẫu, hoặc nhập tên để đăng ký người mới.";
    state.registrationProfiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name + " (" + (Number(profile.sample_count) || 0) + " mẫu)";
      elements.registrationProfilesList.append(option);
    });
    elements.registrationProfilesList.value = selected ? selected.id : "";
  }

  function selectRegistrationProfile(profileId) {
    if (state.pendingRegistration) return;
    const profile = state.registrationProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    state.selectedRegistrationProfile = profile;
    elements.personName.value = profile.name;
    setMessage(elements.registrationMessage, "Đã chọn " + profile.name + ". Ảnh xác nhận tiếp theo sẽ được thêm vào hồ sơ này.", "success");
    renderRegistrationProfiles();
  }

  function clearSelectedRegistrationProfile() {
    if (state.pendingRegistration) return;
    state.selectedRegistrationProfile = null;
    elements.personName.value = "";
    setMessage(elements.registrationMessage);
    renderRegistrationProfiles();
    elements.personName.focus();
  }

  async function loadRegistrationProfiles() {
    elements.registrationDirectoryStatus.textContent = "Đang tải danh sách...";
    try {
      const payload = await apiFetch("/api/registration-profiles", { cache: "no-store" });
      state.registrationProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      const selectedId = state.selectedRegistrationProfile && state.selectedRegistrationProfile.id;
      state.selectedRegistrationProfile = state.registrationProfiles.find((profile) => profile.id === selectedId) || null;
      if (state.selectedRegistrationProfile) elements.personName.value = state.selectedRegistrationProfile.name;
      renderRegistrationProfiles();
    } catch (error) {
      elements.registrationDirectoryStatus.textContent = "Không tải được danh sách: " + errorMessage(error);
    }
  }

  function renderRecognitionFaces(faces) {
    elements.recognitionFaces.replaceChildren();
    faces.forEach((face, index) => {
      const item = document.createElement("li");
      item.dataset.state = face.matched ? "match" : face.pending ? "pending" : "empty";
      const label = face.matched && face.profile
        ? recognitionLabel(face)
        : face.pending && face.profile
          ? "Đang xác nhận: " + recognitionLabel(face) + " (" + face.confirmationCount + "/" + REQUIRED_RECOGNITION_CONFIRMATIONS + ")"
          : "Chưa có dữ liệu";
      item.textContent = "Người " + (index + 1) + ": " + label;
      elements.recognitionFaces.append(item);
    });
  }

  function recognitionLabel(face) {
    const similarity = Number(face && face.similarity);
    const score = Number.isFinite(similarity) ? similarity.toFixed(2) : "--";
    return face.profile.name + " - " + score;
  }

  function setRecognition(stateName, title, detail) {
    elements.recognitionResult.dataset.state = stateName;
    elements.recognitionResult.querySelector("strong").textContent = title;
    elements.recognitionResult.querySelector("span").textContent = detail;
  }

  async function registerFace(event) {
    event.preventDefault();
    if (state.pendingRegistration) {
      setMessage(elements.registrationMessage, "Hãy xác nhận hoặc hủy ảnh crop đang chờ.", "error");
      return;
    }
    const name = elements.personName.value.trim();
    if (name.length < 2) {
      setMessage(elements.registrationMessage, "Nhập ít nhất 2 ký tự cho họ và tên.", "error");
      return;
    }
    try {
      const uploadedImage = state.registrationUpload;
      if (!uploadedImage && !(await startCamera("register"))) return;
      setMessage(elements.registrationMessage, "Đang chụp và kiểm tra khuôn mặt. Chưa lưu CSDL...", "");
      setButtonState(elements.registerButton, "loading", "Đang xử lý...");
      // Enrollment is infrequent, so retain more pixels for the quality gate.
      const image = uploadedImage || await captureFrame("register", "registration.jpg", 640);
      const form = new FormData();
      form.append("name", name);
      form.append("consent", "true");
      form.append("source_mode", uploadedImage ? "upload" : "camera");
      form.append("image", image, image.name);
      const selectedProfile = selectedRegistrationProfile();
      if (selectedProfile) {
        form.append("profile_id", selectedProfile.id);
      } else {
        const enrollmentToken = state.enrollmentTokens.get(enrollmentKey(name));
        if (enrollmentToken) form.append("enrollment_token", enrollmentToken);
      }
      const payload = await apiFetch("/api/registrations/preview", { method: "POST", body: form });
      const pending = payload.pending_registration;
      if (!pending || !pending.id || typeof payload.preview_image !== "string") {
        throw new ApiError("Server không trả về ảnh xác nhận đăng ký.", "registration_preview_unavailable");
      }
      state.pendingRegistration = { ...pending, processing: payload.processing };
      renderProcessing("register", payload.processing);
      showDataPreview(elements.registerPreview, payload.preview_image, "register");
      beginCropEditing(payload.initial_selection);
      elements.registerPreviewActions.hidden = false;
      setRegistrationPendingState(true);
      setMessage(elements.registrationMessage, "Điều chỉnh vùng crop nếu cần, rồi chọn Xác nhận để lưu vào CSDL.", "success");
      setCameraStatus("register", "Đang chờ xác nhận; chưa lưu CSDL.", "success");
    } catch (error) {
      const message = errorMessage(error);
      setMessage(elements.registrationMessage, message, "error");
      setButtonState(elements.registerButton, "error", "Thử lại");
      setCameraStatus("register", message, "error");
    }
  }

  async function confirmRegistration() {
    const pending = state.pendingRegistration;
    if (!pending) return;
    elements.confirmRegistrationButton.disabled = true;
    elements.cancelRegistrationButton.disabled = true;
    try {
      setMessage(elements.registrationMessage, "Đang kiểm tra vùng crop và lưu embedding vào CSDL...", "");
      const form = new FormData();
      form.append("image", await adjustedRegistrationCrop(), "registration-crop.jpg");
      const payload = await apiFetch(
        "/api/registrations/" + encodeURIComponent(pending.id) + "/confirm",
        { method: "POST", body: form },
      );
      const enrollment = payload.enrollment || {};
      if (enrollment.enrollment_token) state.enrollmentTokens.set(enrollmentKey(pending.name), enrollment.enrollment_token);
      const initialSteps = pending.processing && Array.isArray(pending.processing.steps) ? pending.processing.steps : [];
      const confirmationSteps = payload.processing && Array.isArray(payload.processing.steps) ? payload.processing.steps : [];
      renderProcessing("register", { steps: [...initialSteps, ...confirmationSteps] });
      const sampleCount = Number(enrollment.sample_count) || 1;
      const maxSamples = Number(enrollment.max_samples) || sampleCount;
      const profileName = payload.profile && payload.profile.name ? payload.profile.name : pending.name;
      const wasUploaded = pending.source_mode === "upload";
      const savedProfile = payload.profile && payload.profile.id ? payload.profile : null;
      if (state.selectedRegistrationProfile && savedProfile && state.selectedRegistrationProfile.id === savedProfile.id) {
        state.selectedRegistrationProfile = { ...state.selectedRegistrationProfile, ...savedProfile, sample_count: sampleCount };
        elements.personName.value = state.selectedRegistrationProfile.name;
      } else {
        elements.personName.value = "";
      }
      state.registrationUpload = null;
      elements.registerUploadInput.value = "";
      elements.registerUseCameraButton.hidden = !wasUploaded;
      clearRegistrationPreview();
      renderRegistrationProfiles();
      void loadRegistrationProfiles();
      setMessage(
        elements.registrationMessage,
        (enrollment.created_profile ? "Đăng ký thành công: " : "Đã thêm mẫu khuôn mặt cho ")
          + profileName + ". Mẫu " + sampleCount + "/" + maxSamples + ".",
        "success",
      );
      setButtonState(elements.registerButton, "success", "Đã lưu");
      setCameraStatus("register", "Đã lưu mẫu khuôn mặt vào CSDL.", "success");
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof ApiError && ["pending_registration_not_found", "profile_sample_limit_reached"].includes(error.code)) {
        clearRegistrationPreview();
      }
      setMessage(elements.registrationMessage, message, "error");
      setCameraStatus("register", message, "error");
    } finally {
      elements.confirmRegistrationButton.disabled = false;
      elements.cancelRegistrationButton.disabled = false;
    }
  }

  async function cancelRegistration() {
    const pending = state.pendingRegistration;
    if (!pending) return;
    elements.confirmRegistrationButton.disabled = true;
    elements.cancelRegistrationButton.disabled = true;
    try {
      await apiFetch("/api/registrations/" + encodeURIComponent(pending.id), { method: "DELETE" });
      clearRegistrationPreview();
      if (state.registrationUpload) {
        showLocalPreview("register", elements.registerPreview, state.registrationUpload, "register");
      }
      setMessage(elements.registrationMessage, "Đã hủy. Không có dữ liệu nào được lưu vào CSDL.", "");
      setCameraStatus("register", "Đã hủy ảnh đăng ký.");
    } catch (error) {
      setMessage(elements.registrationMessage, errorMessage(error), "error");
    } finally {
      elements.confirmRegistrationButton.disabled = false;
      elements.cancelRegistrationButton.disabled = false;
    }
  }

  async function recognizeUploadedImage(file) {
    if (!validImageFile(file)) {
      setRecognition("error", "Không thể dùng tệp này", "Hãy chọn một tệp ảnh hợp lệ.");
      return;
    }
    state.recognitionUpload = file;
    stopCamera();
    showLocalPreview("recognize", elements.recognizeUploadPreview, file, "recognize");
    elements.cameraPanelRecognize.classList.add("has-upload");
    elements.recognizeUseCameraButton.hidden = false;
    setRecognition("idle", "Đang nhận diện ảnh", "Server đang phát hiện và so khớp các khuôn mặt trong ảnh.");
    try {
      const payload = await requestRecognition(file);
      applyRecognition(payload, false);
      drawTracking("recognize", payload.faces || [], payload.image_width, payload.image_height, payload.faces || []);
      setCameraStatus("recognize", "Đã nhận diện ảnh được tải.", "success");
    } catch (error) {
      clearTracking("recognize");
      setRecognition("error", "Không thể nhận diện ảnh", errorMessage(error));
      setCameraStatus("recognize", errorMessage(error), "error");
    }
  }

  async function useRecognitionCamera() {
    state.recognitionUpload = null;
    elements.recognizeUploadInput.value = "";
    elements.recognizeUseCameraButton.hidden = true;
    elements.cameraPanelRecognize.classList.remove("has-upload");
    hidePreview(elements.recognizeUploadPreview, "recognize");
    state.recognitionTracks = [];
    setRecognition("idle", "Đang chờ khuôn mặt", "Đặt một hoặc nhiều người vào khung hình để bắt đầu.");
    await startCamera("recognize");
  }

  async function selectRegistrationUpload(file) {
    if (!validImageFile(file)) {
      state.registrationUpload = null;
      elements.registerUploadInput.value = "";
      setMessage(elements.registrationMessage, "Hãy chọn một tệp ảnh hợp lệ.", "error");
      return;
    }
    state.registrationUpload = file;
    stopCamera();
    showLocalPreview("register", elements.registerPreview, file, "register");
    elements.registerUseCameraButton.hidden = false;
    setCameraStatus("register", "Đã chọn ảnh đăng ký. Nhập tên rồi nhấn Đăng ký khuôn mặt.", "success");
  }

  async function useRegistrationCamera() {
    if (state.pendingRegistration) return;
    state.registrationUpload = null;
    elements.registerUploadInput.value = "";
    elements.registerUseCameraButton.hidden = true;
    hidePreview(elements.registerPreview, "register");
    await startCamera("register");
  }

  async function requestRecognition(image) {
    const form = new FormData();
    form.append("image", image, image.name);
    return apiFetch("/api/recognitions", { method: "POST", body: form });
  }

  function applyRecognition(payload, drawCamera) {
    const rawFaces = Array.isArray(payload.faces) ? payload.faces : [];
    const faces = drawCamera
      ? stabilizeRecognitionFaces(rawFaces, payload.image_width, payload.image_height)
      : rawFaces;
    const matchedCount = faces.filter((face) => face.matched && face.profile).length;
    const pendingCount = faces.filter((face) => face.pending && face.profile).length;
    state.latestRecognition = {
      faces,
      imageWidth: Number(payload.image_width) || 1,
      imageHeight: Number(payload.image_height) || 1,
    };
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
    elements.detailsProfileSummary.textContent = profile.name + " · " + samples.length + " mẫu khuôn mặt";
    addDetailField("Mã hồ sơ", profile.id || "Không xác định");
    addDetailField("Đăng ký", displayDate(profile.created_at));
    addDetailField("Nguồn", profile.source_mode || "Không xác định");
    addDetailField("Kiểu lưu", "Ảnh khuôn mặt crop đã xác nhận trên server");
    const imageStorage = payload.face_image_storage || {};
    elements.detailsImageStorage.textContent = imageStorage.message || "Không có thông tin lưu ảnh.";
    samples.forEach((sample, index) => {
      const section = document.createElement("article");
      section.className = "detail-sample";
      const heading = document.createElement("h3");
      heading.textContent = "Mẫu " + (index + 1);
      const metadata = document.createElement("p");
      const quality = typeof sample.quality_score === "number" ? sample.quality_score.toFixed(3) : "Chưa có (mẫu cũ)";
      metadata.textContent = "Mã mẫu: " + sample.id + " · " + displayDate(sample.created_at) + " · chất lượng: " + quality;
      let faceVisual;
      if (typeof sample.face_image === "string") {
        const image = document.createElement("img");
        image.className = "stored-face-image";
        image.alt = "Ảnh khuôn mặt crop của " + profile.name + ", mẫu " + (index + 1);
        image.loading = "lazy";
        image.src = sample.face_image;
        faceVisual = image;
      } else {
        const unavailable = document.createElement("p");
        unavailable.className = "stored-face-image-unavailable";
        unavailable.textContent = "Mẫu cũ chưa có ảnh khuôn mặt được lưu.";
        faceVisual = unavailable;
      }
      const removeButton = document.createElement("button");
      removeButton.className = "table-button";
      removeButton.type = "button";
      removeButton.textContent = "Xóa mẫu này";
      removeButton.addEventListener("click", () => deleteProfileSample(profile.id, sample.id));
      section.append(heading, metadata, faceVisual, removeButton);
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
    if (!window.confirm("Xóa mẫu khuôn mặt này? Không thể hoàn tác.")) return;
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
      setRecognition("idle", "Đang chờ khuôn mặt", "Đặt một hoặc nhiều người vào khung hình để bắt đầu.");
      renderRecognitionFaces([]);
    }
    if (tabName === "register") {
      void loadRegistrationProfiles();
      if (!state.registrationUpload && !state.pendingRegistration) startCamera(tabName);
    }
    if (tabName === "recognize" && !state.recognitionUpload) startCamera(tabName);
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
  elements.confirmRegistrationButton.addEventListener("click", confirmRegistration);
  elements.cancelRegistrationButton.addEventListener("click", cancelRegistration);
  elements.registerCropSelection.addEventListener("pointerdown", startCropInteraction);
  elements.registerCropSelection.addEventListener("pointermove", updateCropInteraction);
  elements.registerCropSelection.addEventListener("pointerup", finishCropInteraction);
  elements.registerCropSelection.addEventListener("pointercancel", finishCropInteraction);
  elements.registerCropSelection.addEventListener("keydown", moveCropSelectionWithKeyboard);
  elements.registerUploadInput.addEventListener("change", async () => {
    if (state.pendingRegistration) return;
    await selectRegistrationUpload(elements.registerUploadInput.files[0]);
  });
  elements.registerUseCameraButton.addEventListener("click", useRegistrationCamera);
  elements.refreshRegistrationProfilesButton.addEventListener("click", loadRegistrationProfiles);
  elements.clearRegistrationProfileButton.addEventListener("click", clearSelectedRegistrationProfile);
  elements.registrationProfilesList.addEventListener("change", (event) => {
    if (event.target.value) selectRegistrationProfile(event.target.value);
    else clearSelectedRegistrationProfile();
  });
  elements.recognizeUploadInput.addEventListener("change", async () => {
    const file = elements.recognizeUploadInput.files[0];
    if (file) await recognizeUploadedImage(file);
  });
  elements.recognizeUseCameraButton.addEventListener("click", useRecognitionCamera);
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
  window.addEventListener("resize", renderCropSelection);
  window.addEventListener("beforeunload", stopCamera);

  switchTab("register", false);
})();
