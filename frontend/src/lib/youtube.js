// Loads the YouTube IFrame Player API once.
let ready;

export function loadYouTubeApi() {
  if (ready) return ready;
  ready = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ready;
}

export const PLAYER_ERRORS = {
  2: "The video ID is invalid.",
  5: "The video can't be played in an HTML5 player.",
  100: "The video was not found, or is private.",
  101: "The owner doesn't allow this video to be embedded. Turn on “Allow embedding” in YouTube Studio.",
  150: "YouTube won't play this video here. Either embedding is turned off in YouTube Studio, or YouTube wants you to sign in (open youtube.com in this browser and sign in, then reload).",
  153: "YouTube needs a referrer to play this video. Reload the page.",
};
