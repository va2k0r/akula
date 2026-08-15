import { AcousticSignatureEngine, type AcousticCode } from "./audio";
import "./styles.css";
import { PrototypeView } from "./ui/PrototypeView";

const root = document.querySelector<HTMLElement>("#prototype");
if (root === null) {
  throw new Error("The prototype root element is missing.");
}

const parameters = new URLSearchParams(globalThis.location.search);
const initialCode = parseInitialCode(parameters.get("code"));
const signalQuality = parseSignalQuality(parameters.get("quality"));
const engine = new AcousticSignatureEngine({ signature: initialCode });
const view = new PrototypeView(root, engine, initialCode, signalQuality);

globalThis.addEventListener("pagehide", () => view.dispose(), { once: true });

function parseSignalQuality(value: string | null): number {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
}

function parseInitialCode(value: string | null): AcousticCode {
  if (value === null || !/^\d{3}$/.test(value)) {
    return [1, 2, 4];
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}
