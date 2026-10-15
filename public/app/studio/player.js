/**
 * The one YouTube player on the page (in the Editor).
 *
 * Songs are switched with cueVideoById, so the iframe is created once and
 * never moved in the page (moving an iframe reloads it). While playing, the
 * playhead is read every animation frame; a range (Preview cut, Check the
 * ending) stops by itself at its end.
 */

let apiPromise = null;

/** Load YouTube's IFrame API once. */
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === "function") previous();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => {
        apiPromise = null;
        reject(new Error("YouTube's player didn't load."));
      };
      document.head.append(script);
      // A script that loads but never says it's ready counts as failed.
      setTimeout(() => {
        if (!(window.YT && window.YT.Player)) {
          apiPromise = null;
          reject(new Error("YouTube's player didn't load."));
        }
      }, 15000);
    });
  }
  return apiPromise;
}

/**
 * @param {HTMLElement} host  element the iframe replaces
 * @param {object} handlers  onTime(seconds), onState("playing"|"paused"|"ended"|"cued"|"buffering"), onError(code), onReady()
 */
export function createPlayer(host, { onTime, onState, onError, onReady } = {}) {
  let player = null;
  let ready = false;
  let pending = null; // { videoId, start } cued before the player was ready
  let stopAt = null;
  let frame = 0;
  let videoId = null;

  const tick = () => {
    if (!player || !ready) return;
    const t = player.getCurrentTime ? player.getCurrentTime() : 0;
    if (stopAt !== null && t >= stopAt) {
      const end = stopAt;
      stopAt = null;
      player.pauseVideo();
      player.seekTo(end, true);
      onTime?.(end);
      return;
    }
    onTime?.(t);
    frame = requestAnimationFrame(tick);
  };

  const STATES = { "-1": "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };

  loadApi()
    .then((YT) => {
      player = new YT.Player(host, {
        // The privacy-enhanced host sets no tracking cookies, so the console
        // isn't flooded with Chrome's third-party cookie warnings.
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        // No YouTube controls: the page's timeline, Preview and keyboard keys cover
        // play and seek, and YouTube's own buttons added 7 tab stops per song.
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: () => {
            ready = true;
            onReady?.();
            if (pending) {
              const { id, start } = pending;
              pending = null;
              cue(id, start);
            }
          },
          onStateChange: (event) => {
            const state = STATES[event.data] || "unknown";
            cancelAnimationFrame(frame);
            if (state === "playing") frame = requestAnimationFrame(tick);
            else onTime?.(player.getCurrentTime ? player.getCurrentTime() : 0);
            if (state === "paused" || state === "ended") stopAt = null;
            onState?.(state);
          },
          onError: (event) => {
            cancelAnimationFrame(frame);
            onError?.(event.data, videoId);
          },
        },
      });
    })
    .catch(() => onError?.("api"));

  function cue(id, start = 0) {
    videoId = id;
    stopAt = null;
    if (!ready) {
      pending = { id, start };
      return;
    }
    cancelAnimationFrame(frame);
    player.cueVideoById({ videoId: id, startSeconds: Math.max(0, start) });
    onTime?.(start);
  }

  return {
    cue,
    get videoId() {
      return videoId;
    },
    get ready() {
      return ready;
    },
    isPlaying: () => Boolean(ready && player.getPlayerState && player.getPlayerState() === 1),
    time: () => (ready && player.getCurrentTime ? player.getCurrentTime() : 0),
    duration: () => (ready && player.getDuration ? player.getDuration() : 0),
    play() {
      if (ready) player.playVideo();
    },
    pause() {
      stopAt = null;
      if (ready) player.pauseVideo();
    },
    seek(t) {
      if (!ready) return;
      player.seekTo(Math.max(0, t), true);
      onTime?.(t);
    },
    /** Play from `from` and stop at `to` (Preview cut, Check the ending). */
    playRange(from, to) {
      if (!ready) return;
      player.seekTo(Math.max(0, from), true);
      stopAt = to;
      player.playVideo();
    },
  };
}
