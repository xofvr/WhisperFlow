(function () {
  "use strict";

  // --- DOM Elements ---
  const apiKeyInput = document.getElementById("api-key");
  const saveKeyBtn = document.getElementById("save-key");
  const keyStatus = document.getElementById("key-status");
  const tabs = document.querySelectorAll(".tab");
  const recordBtn = document.getElementById("record-btn");
  const timerEl = document.getElementById("timer");
  const fileInput = document.getElementById("file-input");
  const fileName = document.getElementById("file-name");
  const uploadBtn = document.getElementById("upload-btn");
  const statusSection = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const resultsSection = document.getElementById("results");
  const transcriptContent = document.getElementById("transcript-content");
  const summaryContent = document.getElementById("summary-content");
  const actionsContent = document.getElementById("actions-content");

  // --- State ---
  let mediaRecorder = null;
  let audioChunks = [];
  let timerInterval = null;
  let recordingStartTime = 0;

  // --- API Key ---
  const STORAGE_KEY = "whisperflow-api-key";

  function loadApiKey() {
    const key = localStorage.getItem(STORAGE_KEY);
    if (key) {
      apiKeyInput.value = key;
      keyStatus.textContent = "Key saved";
      keyStatus.style.color = "var(--success)";
      recordBtn.disabled = false;
    }
  }

  saveKeyBtn.addEventListener("click", function () {
    const key = apiKeyInput.value.trim();
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

  // --- Tabs ---
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      var target = tab.getAttribute("data-tab");
      document.getElementById("tab-record").classList.toggle("hidden", target !== "record");
      document.getElementById("tab-upload").classList.toggle("hidden", target !== "upload");
    });
  });

  // --- Recording ---
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

  recordBtn.addEventListener("click", async function () {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      // Stop recording
      mediaRecorder.stop();
      recordBtn.textContent = "Start Recording";
      recordBtn.classList.remove("recording");
      stopTimer();
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
        console.log("Recording complete:", blob.size, "bytes,", mediaRecorder.mimeType);
        processAudio(blob);
      });

      mediaRecorder.start();
      recordBtn.textContent = "Stop Recording";
      recordBtn.classList.add("recording");
      startTimer();
    } catch (err) {
      console.error("Microphone access denied:", err);
      keyStatus.textContent = "Microphone access denied. Please allow microphone access.";
      keyStatus.style.color = "var(--danger)";
    }
  });

  // --- File Upload ---
  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (file) {
      fileName.textContent = file.name + " (" + (file.size / (1024 * 1024)).toFixed(1) + " MB)";
      uploadBtn.disabled = false;
    } else {
      fileName.textContent = "";
      uploadBtn.disabled = true;
    }
  });

  uploadBtn.addEventListener("click", function () {
    var file = fileInput.files[0];
    if (!file) return;
    processAudio(file);
  });

  // --- Process Audio ---
  async function processAudio(blob) {
    var apiKey = localStorage.getItem(STORAGE_KEY);
    if (!apiKey) {
      keyStatus.textContent = "Please save your API key first";
      keyStatus.style.color = "var(--danger)";
      return;
    }

    showStatus("Uploading audio...");

    var formData = new FormData();
    formData.append("audio", blob, "meeting-audio");

    try {
      showStatus("Transcribing and summarising...");

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
      showResults(data);
    } catch (err) {
      console.error("Processing error:", err);
      hideStatus();
      keyStatus.textContent = "Error: " + err.message;
      keyStatus.style.color = "var(--danger)";
    }
  }

  // --- UI Helpers ---
  function showStatus(message) {
    statusSection.classList.remove("hidden");
    resultsSection.classList.add("hidden");
    statusText.textContent = message;
  }

  function hideStatus() {
    statusSection.classList.add("hidden");
  }

  function showResults(data) {
    hideStatus();
    transcriptContent.textContent = data.transcript || "(empty)";
    summaryContent.textContent = data.summary || "(empty)";
    actionsContent.textContent = data.actionItems || "(empty)";
    resultsSection.classList.remove("hidden");
  }

  // --- Copy Buttons ---
  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var targetId = btn.getAttribute("data-target");
      var content = document.getElementById(targetId).textContent;
      navigator.clipboard.writeText(content).then(function () {
        var original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(function () { btn.textContent = original; }, 1500);
      });
    });
  });

  // --- Init ---
  loadApiKey();
})();
