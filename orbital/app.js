import { Model } from "./model.js";
import { UI } from "./ui.js";
import { Renderer } from "./renderer.js";
const model = new Model({
    mobile: matchMedia("(max-width:700px)").matches,
    restore: !location.search.includes("test"),
  }),
  canvas = document.querySelector("canvas");
const builtins = await (await fetch("./assets/presets.json")).json();
model.addBuiltins(builtins);
if (!model.restored && !location.search.includes("test")) {
  const defaultPreset = [...builtins]
    .reverse()
    .find((preset) => preset.name === "tri");
  if (defaultPreset) model.apply(defaultPreset);
}
function resize() {
  canvas.width = Math.round(innerWidth * devicePixelRatio);
  canvas.height = Math.round(innerHeight * devicePixelRatio);
}
resize();
addEventListener("resize", resize);
const ui = new UI(model);
try {
  let renderer = await Renderer.create(canvas, {
    manualFiltering: location.search.includes("manualFiltering"),
  });
  window.orbital = {
    model,
    renderer,
    ui,
    testing: location.search.includes("test"),
    ready: true,
  };
  document.querySelector("#status").hidden = true;
  let last = performance.now(),
    fpsStart = last,
    rendered = 0;
  function frame(t) {
    if (window.orbital.testing) {
      ui.update();
      requestAnimationFrame(frame);
      return;
    }
    let dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    model.tick(dt);
    ui.update();
    if (t - fpsStart > 500) {
      model.fps = (rendered * 1000) / (t - fpsStart);
      rendered = 0;
      fpsStart = t;
    }
    try {
      if (renderer.inflight < 2) {
        renderer.inflight++;
        renderer.draw(model, dt);
        rendered++;
        renderer.device.queue
          .onSubmittedWorkDone()
          .then(() => renderer.inflight--);
      }
      if (renderer.error) throw Error(renderer.error);
    } catch (e) {
      window.orbitalError = e.message;
      document.querySelector("#status").hidden = false;
      document.querySelector("#status").textContent = e.message;
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch (e) {
  window.orbitalError = e.message;
  document.querySelector("#status").textContent = e.message;
  console.error(e);
}
