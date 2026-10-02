(() => {
  "use strict";

  const MIN_VISIBLE = 0.25;
  const SWITCH_MARGIN = 0.06;

  let activeVideo = null;
  let soundUnlocked = false;
  let soundButton = null;
  let scheduled = false;

  const observed = new WeakSet();
  const visibility = new Map();

  function rectVisibility(video) {
    const r = video.getBoundingClientRect();

    if (r.width <= 0 || r.height <= 0) return 0;

    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);

    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);

    return (w * h) / Math.max(1, r.width * r.height);
  }

  function centerBonus(video) {
    const r = video.getBoundingClientRect();
    const center = r.top + r.height / 2;
    const viewportCenter = window.innerHeight / 2;
    const distance = Math.abs(center - viewportCenter);

    return Math.max(0, 1 - distance / Math.max(1, window.innerHeight));
  }

  function score(video) {
    const visible = visibility.get(video) ?? rectVisibility(video);
    return visible * 0.85 + centerBonus(video) * 0.15;
  }

  function usable(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    if (!video.isConnected) return false;

    const r = video.getBoundingClientRect();
    if (r.width < 80 || r.height < 60) return false;

    const s = getComputedStyle(video);
    if (s.display === "none" || s.visibility === "hidden") return false;

    return true;
  }

  function bestVisibleVideo() {
    return [...document.querySelectorAll("video")]
      .filter(usable)
      .map(video => ({
        video,
        visible: visibility.get(video) ?? rectVisibility(video),
        score: score(video)
      }))
      .filter(item => item.visible >= MIN_VISIBLE)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  function pauseOthers(except) {
    document.querySelectorAll("video").forEach(video => {
      if (video !== except && !video.paused) {
        try { video.pause(); } catch (_) {}
      }
    });
  }

  function showSoundButton() {
    if (soundButton || soundUnlocked) return;

    soundButton = document.createElement("button");
    soundButton.id = "x-auto-sound-button";
    soundButton.textContent = "Enable autoplay sound";

    soundButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      soundUnlocked = true;

      if (activeVideo) {
        activeVideo.muted = false;
        activeVideo.defaultMuted = false;
        activeVideo.volume = 1;
        activeVideo.play().catch(() => {});
      }

      hideSoundButton();
    });

    document.documentElement.appendChild(soundButton);
  }

  function hideSoundButton() {
    if (!soundButton) return;
    soundButton.remove();
    soundButton = null;
  }

  async function startVideo(video) {
    if (!video) return;

    video.autoplay = true;
    video.playsInline = true;

    if (soundUnlocked) {
      video.muted = false;
      video.defaultMuted = false;
      video.volume = 1;

      try {
        await video.play();
        hideSoundButton();
        return;
      } catch (_) {
        // Browser may still reject unmuted autoplay.
      }
    }

    // Important: start muted first so X/Chrome actually begins loading the media.
    video.muted = true;
    video.defaultMuted = true;

    try {
      await video.play();
    } catch (_) {}

    if (!soundUnlocked) {
      showSoundButton();
    }
  }

  function updateActive() {
    scheduled = false;

    const best = bestVisibleVideo();

    if (!best) {
      if (activeVideo && !activeVideo.paused) {
        try { activeVideo.pause(); } catch (_) {}
      }
      activeVideo = null;
      return;
    }

    if (activeVideo && activeVideo.isConnected && activeVideo !== best.video) {
      const activeVisible = visibility.get(activeVideo) ?? rectVisibility(activeVideo);

      if (
        activeVisible >= MIN_VISIBLE &&
        score(activeVideo) + SWITCH_MARGIN >= best.score
      ) {
        pauseOthers(activeVideo);

        if (activeVideo.paused) startVideo(activeVideo);

        if (soundUnlocked && activeVideo.muted) {
          activeVideo.muted = false;
          activeVideo.defaultMuted = false;
          activeVideo.volume = 1;
        }

        return;
      }
    }

    if (activeVideo !== best.video) {
      if (activeVideo && !activeVideo.paused) {
        try { activeVideo.pause(); } catch (_) {}
      }
      activeVideo = best.video;
    }

    pauseOthers(activeVideo);

    if (activeVideo.paused) {
      startVideo(activeVideo);
    } else if (soundUnlocked && activeVideo.muted) {
      activeVideo.muted = false;
      activeVideo.defaultMuted = false;
      activeVideo.volume = 1;
    }
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateActive);
  }

  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      visibility.set(entry.target, entry.intersectionRatio);
    }
    scheduleUpdate();
  }, {
    threshold: [0, 0.1, 0.25, 0.4, 0.6, 0.8, 1]
  });

  function register(video) {
    if (observed.has(video)) return;
    observed.add(video);
    visibility.set(video, rectVisibility(video));
    io.observe(video);

    video.addEventListener("loadedmetadata", scheduleUpdate, { passive: true });
    video.addEventListener("canplay", scheduleUpdate, { passive: true });
    video.addEventListener("ended", scheduleUpdate, { passive: true });

    video.addEventListener("play", () => {
      if (activeVideo && video !== activeVideo) {
        try { video.pause(); } catch (_) {}
      }
    }, { passive: true });
  }

  function scan() {
    document.querySelectorAll("video").forEach(register);

    for (const [video] of visibility) {
      if (!video.isConnected) {
        visibility.delete(video);
        if (video === activeVideo) activeVideo = null;
      }
    }

    scheduleUpdate();
  }

  // Any normal user interaction on X unlocks sound for the current document.
  function unlockSound() {
    if (soundUnlocked) return;

    soundUnlocked = true;
    hideSoundButton();

    if (activeVideo) {
      activeVideo.muted = false;
      activeVideo.defaultMuted = false;
      activeVideo.volume = 1;
      activeVideo.play().catch(() => {});
    }
  }

  document.addEventListener("pointerdown", unlockSound, {
    capture: true,
    passive: true
  });

  document.addEventListener("keydown", unlockSound, {
    capture: true,
    passive: true
  });

  const mo = new MutationObserver(scan);
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });

  scan();

  // Fallback for X's virtualized timeline replacing video nodes.
  setInterval(scan, 1200);
})();