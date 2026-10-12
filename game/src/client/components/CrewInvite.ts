import { isValidGameID } from "@openfront/engine-api/Schemas";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import qrcode from "qrcode-generator";
import { ClientEnv } from "../ClientEnv";
import "./CopyButton";

@customElement("crew-invite")
export class CrewInvite extends LitElement {
  @property() lobbyId = "";
  @property({ type: Boolean }) hiddenCode = false;
  createRenderRoot() {
    return this;
  }
  render() {
    if (!isValidGameID(this.lobbyId)) return nothing;
    if (this.hiddenCode)
      return html`<p class="text-white/60 mb-4">
        Room invitation hidden for streaming. Show the room code to display its
        link and QR.
      </p>`;
    const url = new URL(
      ClientEnv.gamePath(this.lobbyId) + "?lobby",
      window.location.origin,
    ).href;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const image = qr.createDataURL(5, 20);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(
      window.location.hostname,
    );
    return html`<section
      aria-label="Join this room"
      class="flex flex-wrap items-center gap-5 p-5 mb-6 rounded-2xl border border-cyan-300/25 bg-slate-950/60"
    >
      <a href=${url} aria-label="Open this room invitation"
        ><img
          src=${image}
          alt="QR code for this room invitation"
          width="180"
          height="180"
          style="border-radius:12px;background:white;padding:8px;image-rendering:pixelated"
      /></a>
      <div class="flex-1 min-w-48">
        <h3 class="font-bold text-xl mb-2">Bring your crew</h3>
        <p class="text-white/70 mb-3">
          Scan the QR or open the link, sign in with Twitch, and join Danny’s
          room.
        </p>
        <p class="text-white/70 mb-2">
          Room code:
          <strong class="font-mono text-white tracking-widest"
            >${this.lobbyId}</strong
          >
        </p>
        <a href=${url} class="text-cyan-200 break-all underline">${url}</a>
        <copy-button .lobbyId=${this.lobbyId} include-lobby-query></copy-button>
        ${local
          ? html`<p class="text-amber-200/90 text-sm mt-3">
              Local test invitation: this address works on Danny’s computer.
              Phone and remote joining will work after public hosting.
            </p>`
          : nothing}
      </div>
    </section>`;
  }
}
