(function () {
  "use strict";

  // ============ DOM REFS ============

  // Settings
  var settingsToggle = document.getElementById("settings-toggle");
  var settingsPanel = document.getElementById("settings-panel");
  var apiKeyInput = document.getElementById("api-key");
  var saveKeyBtn = document.getElementById("save-key");
  var keyStatus = document.getElementById("key-status");

  // Mode toggle
  var modeBtns = document.querySelectorAll(".mode-btn");
  var modeIndicator = document.querySelector(".mode-indicator");

  // Record
  var recordBtn = document.getElementById("record-btn");
  var timerEl = document.getElementById("timer");
  var waveformCanvas = document.getElementById("waveform");

  // Upload
  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var fileNameEl = document.getElementById("file-name");
  var uploadBtn = document.getElementById("upload-btn");

  // States
  var stateIdle = document.getElementById("state-idle");
  var stateProcessing = document.getElementById("state-processing");
  var stateResults = document.getElementById("state-results");
  var statusText = document.getElementById("status-text");

  // Results
  var transcriptContent = document.getElementById("transcript-content");
  var summaryContent = document.getElementById("summary-content");
  var actionsContent = document.getElementById("actions-content");
  var newRecordingBtn = document.getElementById("new-recording");

  // ============ STATE ============

  var mediaRecorder = null;
  var audioChunks = [];
  var timerInterval = null;
  var recordingStartTime = 0;
  var audioContext = null;
  var analyserNode = null;
  var animationFrameId = null;

  var STORAGE_KEY = "whisperflow-api-key";
  var DB_NAME = "whisperflow-backup";
  var DB_STORE = "recordings";
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var currentState = "idle";

  // ============ INDEXEDDB AUDIO BACKUP ============

  function openBackupDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveBackup(blob) {
    return openBackupDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        var store = tx.objectStore(DB_STORE);
        var record = { audio: blob, timestamp: Date.now(), mimeType: blob.type };
        var req = store.add(record);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deleteBackup(id) {
    return openBackupDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        var req = tx.objectStore(DB_STORE).delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getLatestBackup() {
    return openBackupDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var store = tx.objectStore(DB_STORE);
        var req = store.openCursor(null, "prev");
        req.onsuccess = function () {
          var cursor = req.result;
          resolve(cursor ? cursor.value : null);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ============ STATE TRANSITIONS ============

  function transitionTo(state) {
    var states = {
      idle: stateIdle,
      processing: stateProcessing,
      results: stateResults,
    };

    if (currentState === state) return;

    var outgoing = states[currentState];
    var incoming = states[state];
    currentState = state;

    if (reducedMotion || typeof gsap === "undefined") {
      // Fallback: simple class toggle
      if (outgoing) outgoing.classList.add("hidden");
      if (incoming) incoming.classList.remove("hidden");
      return;
    }

    // Kill any in-progress tweens
    gsap.killTweensOf([outgoing, incoming]);

    if (outgoing) {
      gsap.to(outgoing, {
        opacity: 0,
        y: -20,
        duration: 0.3,
        ease: "power2.in",
        onComplete: function () {
          outgoing.classList.add("hidden");
          outgoing.style.opacity = "";
          outgoing.style.transform = "";
        },
      });
    }

    // Small delay so outgoing finishes
    gsap.delayedCall(0.25, function () {
      incoming.classList.remove("hidden");
      gsap.fromTo(incoming,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
      );
    });
  }

  // ============ SETTINGS PANEL ============

  settingsToggle.addEventListener("click", function () {
    settingsPanel.classList.toggle("settings-open");
  });

  // ============ API KEY ============

  function loadApiKey() {
    var key = localStorage.getItem(STORAGE_KEY);
    if (key) {
      apiKeyInput.value = key;
      keyStatus.textContent = "Key saved";
      keyStatus.style.color = "var(--success)";
      recordBtn.disabled = false;
    }
  }

  saveKeyBtn.addEventListener("click", function () {
    var key = apiKeyInput.value.trim();
    if (!key) {
      keyStatus.textContent = "Please enter a key";
      keyStatus.style.color = "var(--danger)";
      return;
    }
    localStorage.setItem(STORAGE_KEY, key);
    keyStatus.textContent = "Key saved";
    keyStatus.style.color = "var(--success)";
    recordBtn.disabled = false;
  });

  // ============ MODE TOGGLE ============

  modeBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      modeBtns.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");

      var mode = btn.getAttribute("data-mode");
      if (mode === "upload") {
        modeIndicator.classList.add("right");
        document.getElementById("panel-record").classList.add("hidden");
        document.getElementById("panel-upload").classList.remove("hidden");
      } else {
        modeIndicator.classList.remove("right");
        document.getElementById("panel-record").classList.remove("hidden");
        document.getElementById("panel-upload").classList.add("hidden");
      }
    });
  });

  // ============ RECORDING ============

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60).toString().padStart(2, "0");
    var s = (seconds % 60).toString().padStart(2, "0");
    return m + ":" + s;
  }

  function startTimer() {
    recordingStartTime = Date.now();
    timerEl.textContent = "00:00";
    timerInterval = setInterval(function () {
      var elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      timerEl.textContent = formatTime(elapsed);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function pickMimeType() {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      return "audio/webm;codecs=opus";
    }
    if (MediaRecorder.isTypeSupported("audio/mp4")) {
      return "audio/mp4";
    }
    return "";
  }

  // ============ WAVEFORM VISUALIZATION ============

  function setupWaveform(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    var source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);
    drawWaveform();
  }

  function drawWaveform() {
    if (!analyserNode) return;

    var canvas = waveformCanvas;
    var ctx = canvas.getContext("2d");
    var dpr = window.devicePixelRatio || 1;

    // Size canvas for high-DPI
    var rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    var bufferLength = analyserNode.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);

    function draw() {
      animationFrameId = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, rect.width, rect.height);

      var barCount = 32;
      var barWidth = rect.width / barCount - 2;
      var x = 0;

      for (var i = 0; i < barCount; i++) {
        var dataIndex = Math.floor(i * bufferLength / barCount);
        var value = dataArray[dataIndex] / 255;
        var barHeight = Math.max(2, value * rect.height * 0.9);

        ctx.fillStyle = "rgba(124, 106, 239, " + (0.3 + value * 0.7) + ")";
        ctx.beginPath();
        ctx.roundRect(x, rect.height - barHeight, barWidth, barHeight, 2);
        ctx.fill();

        x += barWidth + 2;
      }
    }

    draw();
  }

  function cleanupWaveform() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyserNode = null;

    // Clear canvas
    var ctx = waveformCanvas.getContext("2d");
    ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  }

  // ============ RECORD BUTTON ============

  recordBtn.addEventListener("click", async function () {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      // Stop
      mediaRecorder.stop();
      recordBtn.classList.remove("recording");
      stopTimer();
      cleanupWaveform();
      return;
    }

    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });

      var mimeType = pickMimeType();
      var options = mimeType ? { mimeType: mimeType } : {};
      mediaRecorder = new MediaRecorder(stream, options);
      audioChunks = [];

      mediaRecorder.addEventListener("dataavailable", function (e) {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      });

      mediaRecorder.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        processAudio(blob);
      });

      mediaRecorder.start();
      recordBtn.classList.add("recording");
      startTimer();
      setupWaveform(stream);
    } catch (err) {
      console.error("Microphone access denied:", err);
      keyStatus.textContent = "Microphone access denied. Please allow microphone access.";
      keyStatus.style.color = "var(--danger)";
    }
  });

  // ============ DRAG AND DROP ============

  dropzone.addEventListener("click", function () {
    fileInput.click();
  });

  dropzone.addEventListener("dragenter", function (e) {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", function (e) {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    var files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  fileInput.addEventListener("change", function () {
    if (fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  });

  function handleFile(file) {
    fileNameEl.textContent = file.name + " (" + (file.size / (1024 * 1024)).toFixed(1) + " MB)";
    uploadBtn.classList.remove("hidden");
    uploadBtn.disabled = false;
    // Store file reference for upload
    uploadBtn._file = file;
  }

  uploadBtn.addEventListener("click", function () {
    var file = uploadBtn._file;
    if (!file) return;
    processAudio(file);
  });

  // ============ PROCESS AUDIO ============

  async function processAudio(blob, backupId) {
    var apiKey = localStorage.getItem(STORAGE_KEY);
    if (!apiKey) {
      keyStatus.textContent = "Please save your API key first";
      keyStatus.style.color = "var(--danger)";
      settingsPanel.classList.add("settings-open");
      return;
    }

    transitionTo("processing");
    statusText.textContent = "Saving local backup...";

    // Save a local backup before uploading (skip if retrying an existing backup)
    if (!backupId) {
      try {
        backupId = await saveBackup(blob);
      } catch (e) {
        console.warn("Could not save local backup:", e);
      }
    }

    statusText.textContent = "Transcribing your meeting...";

    var formData = new FormData();
    formData.append("audio", blob, "meeting-audio");

    try {
      var res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "x-api-key": apiKey },
        body: formData,
      });

      if (!res.ok) {
        var errBody;
        try {
          errBody = await res.json();
        } catch (_e) {
          errBody = { error: "Request failed with status " + res.status };
        }
        throw new Error(errBody.error || "Request failed");
      }

      var data = await res.json();

      // Upload succeeded — delete the backup
      if (backupId) {
        deleteBackup(backupId).catch(function (e) {
          console.warn("Could not delete backup:", e);
        });
      }

      showResults(data);
    } catch (err) {
      console.error("Processing error:", err);
      transitionTo("idle");
      keyStatus.textContent = "Error: " + err.message + ". Your recording is saved locally — click Retry to try again.";
      keyStatus.style.color = "var(--danger)";
      settingsPanel.classList.add("settings-open");
      showRetryBanner();
    }
  }

  // ============ RESULTS ============

  function showResults(data) {
    transcriptContent.textContent = data.transcript || "(empty)";
    summaryContent.textContent = data.summary || "(empty)";
    actionsContent.textContent = data.actionItems || "(empty)";
    transitionTo("results");

    // Staggered card entrance
    if (!reducedMotion && typeof gsap !== "undefined") {
      gsap.from(".result-card", {
        y: 30,
        opacity: 0,
        duration: 0.6,
        ease: "power2.out",
        stagger: 0.12,
        delay: 0.3,
      });
    }
  }

  // ============ COPY BUTTONS ============

  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var targetId = btn.getAttribute("data-target");
      var content = document.getElementById(targetId).textContent;
      navigator.clipboard.writeText(content).then(function () {
        var original = btn.textContent;
        btn.textContent = "Copied!";

        // Micro-animation
        if (!reducedMotion && typeof gsap !== "undefined") {
          gsap.from(btn, { scale: 0.9, duration: 0.25, ease: "back.out(3)" });
        }

        setTimeout(function () { btn.textContent = original; }, 1500);
      });
    });
  });

  // ============ NEW RECORDING ============

  newRecordingBtn.addEventListener("click", function () {
    // Reset file upload state
    fileNameEl.textContent = "";
    uploadBtn.classList.add("hidden");
    uploadBtn._file = null;
    fileInput.value = "";

    transitionTo("idle");
  });

  // ============ RECOVERY BANNER ============

  function showRetryBanner() {
    // Avoid duplicates
    if (document.getElementById("retry-banner")) return;

    var banner = document.createElement("div");
    banner.id = "retry-banner";
    banner.style.cssText = "position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);" +
      "background:var(--glass-bg, rgba(30,30,50,0.85));backdrop-filter:blur(12px);" +
      "border:1px solid var(--danger, #e55);border-radius:12px;padding:0.75rem 1.25rem;" +
      "display:flex;align-items:center;gap:0.75rem;z-index:1000;color:var(--text, #fff);" +
      "font-size:0.9rem;box-shadow:0 4px 24px rgba(0,0,0,0.3);";

    banner.innerHTML =
      '<span>Recording saved locally.</span>' +
      '<button id="retry-upload-btn" style="background:var(--accent, #7c6aef);color:#fff;' +
      'border:none;border-radius:8px;padding:0.5rem 1rem;cursor:pointer;font-weight:600;">Retry Upload</button>' +
      '<button id="download-backup-btn" style="background:transparent;color:var(--accent, #7c6aef);' +
      'border:1px solid var(--accent, #7c6aef);border-radius:8px;padding:0.5rem 1rem;cursor:pointer;' +
      'font-weight:600;">Download</button>' +
      '<button id="dismiss-banner-btn" style="background:transparent;border:none;color:var(--muted, #888);' +
      'cursor:pointer;font-size:1.2rem;padding:0 0.25rem;" aria-label="Dismiss">&times;</button>';

    document.body.appendChild(banner);

    document.getElementById("retry-upload-btn").addEventListener("click", function () {
      banner.remove();
      retryFromBackup();
    });

    document.getElementById("download-backup-btn").addEventListener("click", function () {
      downloadBackup();
    });

    document.getElementById("dismiss-banner-btn").addEventListener("click", function () {
      banner.remove();
    });
  }

  function retryFromBackup() {
    getLatestBackup().then(function (record) {
      if (!record) {
        keyStatus.textContent = "No saved recording found.";
        keyStatus.style.color = "var(--danger)";
        return;
      }
      var blob = record.audio instanceof Blob
        ? record.audio
        : new Blob([record.audio], { type: record.mimeType });
      processAudio(blob, record.id);
    }).catch(function (err) {
      console.error("Recovery failed:", err);
      keyStatus.textContent = "Could not recover recording.";
      keyStatus.style.color = "var(--danger)";
    });
  }

  function downloadBackup() {
    getLatestBackup().then(function (record) {
      if (!record) return;
      var blob = record.audio instanceof Blob
        ? record.audio
        : new Blob([record.audio], { type: record.mimeType });
      var ext = (record.mimeType || "").indexOf("mp4") !== -1 ? ".mp4" : ".webm";
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "meeting-backup-" + new Date(record.timestamp).toISOString().slice(0, 16) + ext;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Check for unsent recordings on startup
  function checkForBackups() {
    getLatestBackup().then(function (record) {
      if (record) {
        showRetryBanner();
      }
    }).catch(function () {
      // IndexedDB unavailable — nothing to recover
    });
  }

  // ============ INIT ============

  loadApiKey();
  checkForBackups();
})();
