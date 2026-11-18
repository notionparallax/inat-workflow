// Every keyboard shortcut, grouped by what you're doing (SPEC §13). Used by the
// Shortcuts panel and the printable card (shortcuts.html), so they can't drift.
// Each row is [keys, action]; keys is a list of alternatives, each a list of
// keys pressed together.

export const SHORTCUT_GROUPS = [
  {
    title: "Watching",
    rows: [
      [[["Space"], ["K"]], "Play / pause"],
      [[["J"], ["L"]], "Back / forward 10 s"],
      [[["←"], ["→"]], "Back / forward 5 s"],
      [[[","], ["."]], "Back / forward one frame"],
      [[["<"], [">"]], "Slower / faster"],
      [[["0"], ["9"]], "Jump to 0 % … 90 % of the video", "range"],
    ],
  },
  {
    title: "Lining up the dive log",
    rows: [
      [[["D"]], "This frame is the descent"],
      [[["S"]], "This frame is the surface"],
      [[["Click"]], "Jump the video to that point (on the depth profile)"],
      [[["Drag"]], "Slide the profile to line it up (with one or no sync points)"],
    ],
  },
  {
    title: "Making an observation",
    rows: [
      [[["M"]], "Mark: capture a burst of frames around now"],
      [[["Shift", "M"]], "Capture just this frame"],
      [[["N"]], "Start an observation without capturing"],
      [[["C"]], "Complete: on to annotations"],
      [[["Esc"]], "Discard the observation"],
    ],
  },
  {
    title: "Picking frames",
    rows: [
      [[["←"], ["→"]], "Previous / next frame"],
      [[["Space"], ["X"]], "Select or deselect this frame (up to 4)"],
      [[["1"], ["9"]], "Select the 1st … 9th sharpest of the latest burst", "range"],
      [[["Click"]], "Mark where the organism is"],
      [[["R"]], "Add or remove a crop box"],
      [[["G"]], "Make a GIF around this frame"],
      [[["M"]], "Back to the video for more angles"],
      [[["C"]], "Complete: on to annotations"],
      [[["Esc"]], "Close the picker"],
    ],
  },
  {
    title: "Annotations",
    rows: [
      [[["Enter"]], "Upload"],
      [[["Esc"]], "Back to the frames"],
    ],
  },
];

/** HTML for one row's keys: "Space / K", "Shift+M", "0 – 9". */
export function keysHtml(alternatives, kind) {
  const one = (combo) => combo.map((k) => (k === "Click" || k === "Drag" ? `<em>${k}</em>` : `<kbd>${escape(k)}</kbd>`)).join("+");
  return alternatives.map(one).join(kind === "range" ? " – " : " / ");
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
