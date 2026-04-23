const STYLES = `
#playback-widget {
  width: 100%; max-width: 200px;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; background: rgba(0,0,0,0.75);
  border: 1px solid #2a2a3a; border-radius: 4px;
  color: #ccc; font-family: monospace; font-size: 11px;
  user-select: none; pointer-events: auto;
}
#playback-widget input[type=range] { flex: 1; accent-color: #6ab0d4; }
#playback-widget .play-btn {
  background: #1a1a2a; border: 1px solid #333; color: #ccc;
  cursor: pointer; border-radius: 3px; padding: 2px 9px;
  font-family: monospace; font-size: 13px; line-height: 1;
}
#playback-widget .play-btn:hover { border-color: #555; color: #fff; }
`;

let widgetEl = null;
let styleEl = null;

export function buildPlaybackWidget({ onTimeScale, onPause, onResume }) {
  clearPlaybackWidget();

  styleEl = document.createElement("style");
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  widgetEl = document.createElement("div");
  widgetEl.id = "playback-widget";

  const playBtn = document.createElement("button");
  playBtn.className = "play-btn";
  playBtn.textContent = "⏸";
  let playing = true;
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.textContent = playing ? "⏸" : "▶";
    playing ? onResume() : onPause();
  });

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = "1";
  slider.setAttribute("aria-label", "Speed");

  function apply(v) {
    const ts = 0.1 * Math.pow(5000, v / 100);
    slider.setAttribute("aria-valuenow", ts < 10 ? ts.toFixed(1) : Math.round(ts));
    onTimeScale(ts);
  }
  apply(Number(slider.value));
  slider.addEventListener("input", () => apply(Number(slider.value)));

  widgetEl.append(playBtn, slider);
  (document.getElementById("top-bar") ?? document.body).appendChild(widgetEl);
}

export function clearPlaybackWidget() {
  widgetEl?.remove();
  styleEl?.remove();
  widgetEl = null;
  styleEl = null;
}
