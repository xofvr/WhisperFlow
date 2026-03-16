(function () {
  "use strict";

  // ============ CONSTANTS ============

  // Netlify Functions have a ~6 MB request body limit.
  // We chunk audio at 4.5 MB to stay safely under the limit.
  var CHUNK_SIZE = 4.5 * 1024 * 1024; // 4.5 MB
  var MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB (sanity cap)

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

  // Progress
  var progressContainer = document.getElementById("progress-container");
  var progressFill = document.getElementById("progress-fill");
  var progressText = document.getElementById("progress-text");

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
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var currentState = "idle";

  // ============ PROGRESS HELPERS ============

  function showProgress(percent, text) {
    progressContainer.classList.remove("hidden");
    progressFill.style.width = percent + "%";
    if (text) progressText.textContent = text;
  }

  function hideProgress() {
    progressContainer.classList.add("hidden");
    progressFill.style.width = "0%";
    progressText.textContent = "";
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

    if (state !== "processing") hideProgress();

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

      // Use a low bitrate for speech — keeps file size small for long recordings
      options.audioBitsPerSecond = 32000;

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
    if (file.size > MAX_FILE_SIZE) {
      fileNameEl.textContent = file.name + " — too large (max 500 MB)";
      fileNameEl.style.color = "var(--danger)";
      uploadBtn.classList.add("hidden");
      return;
    }

    fileNameEl.textContent = file.name + " (" + (file.size / (1024 * 1024)).toFixed(1) + " MB)";
    fileNameEl.style.color = "";
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

  // ============ CHUNKED TRANSCRIPTION ============

  /**
   * Split a Blob into byte-range chunks of at most `size` bytes.
   */
  function splitBlob(blob, size) {
    var chunks = [];
    var offset = 0;
    while (offset < blob.size) {
      chunks.push(blob.slice(offset, Math.min(offset + size, blob.size)));
      offset += size;
    }
    return chunks;
  }

  /**
   * Send a single audio chunk to /api/transcribe and return the transcript text.
   */
  async function transcribeChunk(chunk, apiKey) {
    var formData = new FormData();
    formData.append("audio", chunk, "chunk.webm");
    formData.append("mode", "transcribe");

    var res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: formData,
    });

    if (!res.ok) {
      var errBody;
      try {
        errBody = await res.json();
      } catch (_e) {
        errBody = { error: "Transcription failed with status " + res.status };
      }
      throw new Error(errBody.error || "Transcription failed");
    }

    return (await res.text()).trim();
  }

  /**
   * Send the combined transcript to /api/meeting-summarize and return the full result.
   */
  async function summarizeTranscript(transcript, apiKey) {
    var res = await fetch("/api/meeting-summarize", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcript: transcript }),
    });

    if (!res.ok) {
      var errBody;
      try {
        errBody = await res.json();
      } catch (_e) {
        errBody = { error: "Summarization failed with status " + res.status };
      }
      throw new Error(errBody.error || "Summarization failed");
    }

    return res.json();
  }

  // ============ PROCESS AUDIO ============

  async function processAudio(blob) {
    var apiKey = localStorage.getItem(STORAGE_KEY);
    if (!apiKey) {
      keyStatus.textContent = "Please save your API key first";
      keyStatus.style.color = "var(--danger)";
      settingsPanel.classList.add("settings-open");
      return;
    }

    transitionTo("processing");

    try {
      var chunks = splitBlob(blob, CHUNK_SIZE);
      var totalChunks = chunks.length;
      var transcripts = [];

      // Step 1: Transcribe each chunk
      for (var i = 0; i < totalChunks; i++) {
        var chunkNum = i + 1;
        if (totalChunks === 1) {
          statusText.textContent = "Transcribing your meeting...";
          hideProgress();
        } else {
          statusText.textContent = "Transcribing chunk " + chunkNum + " of " + totalChunks + "...";
          var percent = Math.round((i / (totalChunks + 1)) * 100);
          showProgress(percent, chunkNum + " / " + totalChunks + " chunks");
        }

        var text = await transcribeChunk(chunks[i], apiKey);
        if (text) transcripts.push(text);
      }

      var fullTranscript = transcripts.join(" ");

      if (!fullTranscript.trim()) {
        showResults({
          transcript: "",
          summary: "No speech detected in the audio.",
          actionItems: "No action items identified.",
        });
        return;
      }

      // Step 2: Summarize
      statusText.textContent = "Generating summary and action items...";
      if (totalChunks > 1) {
        showProgress(90, "Summarising...");
      }

      var data = await summarizeTranscript(fullTranscript, apiKey);
      showProgress(100, "Done");
      showResults(data);
    } catch (err) {
      console.error("Processing error:", err);
      transitionTo("idle");
      keyStatus.textContent = "Error: " + err.message;
      keyStatus.style.color = "var(--danger)";
      settingsPanel.classList.add("settings-open");
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

  // ============ INIT ============

  loadApiKey();
})();
