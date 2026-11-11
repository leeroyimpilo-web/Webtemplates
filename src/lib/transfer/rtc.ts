import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type Role = "sender" | "receiver";
export type PeerState = "waiting" | "connecting" | "connected" | "disconnected";
export type RouteHint = "direct-host" | "direct-other" | "turn-relay" | "unknown";
type Message = { type: "hello" | "offer" | "answer" | "ice"; device: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export interface PeerOptions {
  client: SupabaseClient;
  roomId: string;
  deviceId: string;
  role: Role;
  onState: (state: PeerState) => void;
  onChannel: (channel: RTCDataChannel) => void;
  /** Tests can shorten the retry window; production defaults to 2 seconds. */
  helloRetryMs?: number;
}

export class SupabaseRtcPeer {
  private channel: RealtimeChannel;
  private pc: RTCPeerConnection | null = null;
  private candidates: RTCIceCandidateInit[] = [];
  private closed = false;
  private started = false;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private opts: PeerOptions;

  constructor(opts: PeerOptions) {
    this.opts = opts;
    this.channel = opts.client.channel(`signaling:${opts.roomId}`, { config: { private: true } });
    this.channel.on("broadcast", { event: "rtc" }, ({ payload }) => {
      void this.handle(payload as Message).catch(() => opts.onState("disconnected"));
    });
  }
  async start() {
    if (this.started) return;
    this.started = true;
    const { data: { session } } = await this.opts.client.auth.getSession();
    if (!session) throw new Error("Sign in before starting a transfer.");
    this.opts.client.realtime.setAuth(session.access_token);
    await new Promise<void>((resolve, reject) => {
      this.channel.subscribe(status => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") reject(new Error(`Signaling channel: ${status}`));
      });
    });
    if (this.closed) return;
    this.opts.onState("waiting");
    if (this.opts.role === "receiver") {
      // Realtime broadcasts are not persisted. If the receiver subscribes before
      // the sender, its first hello may be lost. Retry until an offer arrives.
      await this.send({ type: "hello", device: this.opts.deviceId });
      if (!this.closed && !this.pc) {
        this.helloTimer = setInterval(() => {
          if (!this.closed && !this.pc) {
            void this.send({ type: "hello", device: this.opts.deviceId })
              .catch(() => this.opts.onState("disconnected"));
          }
        }, this.opts.helloRetryMs ?? 2000);
      }
    }
  }
  private async send(message: Message) {
    if (this.closed) return;
    const result = await this.channel.send({ type: "broadcast", event: "rtc", payload: message });
    if (result !== "ok") throw new Error(`Failed to deliver signaling: ${result}`);
  }
  private makeConnection() {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });
    pc.onicecandidate = event => {
      if (event.candidate) void this.send({ type: "ice", device: this.opts.deviceId, candidate: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.opts.onState("connected");
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") this.opts.onState("disconnected");
    };
    if (this.opts.role === "receiver") pc.ondatachannel = event => this.opts.onChannel(event.channel);
    this.pc = pc;
    this.opts.onState("connecting");
    return pc;
  }
  private stopHelloRetry() {
    if (this.helloTimer !== null) clearInterval(this.helloTimer);
    this.helloTimer = null;
  }
  private async handle(message: Message) {
    if (!message || typeof message !== "object" || typeof message.device !== "string" ||
      !["hello", "offer", "answer", "ice"].includes(message.type) ||
      this.closed || message.device === this.opts.deviceId) return;
    if (message.type === "hello" && this.opts.role === "sender" && !this.pc) {
      const pc = this.makeConnection();
      const dc = pc.createDataChannel("pend-files", { ordered: true });
      this.opts.onChannel(dc);
      await pc.setLocalDescription(await pc.createOffer());
      await this.send({ type: "offer", device: this.opts.deviceId, sdp: pc.localDescription?.toJSON() });
    } else if (message.type === "offer" && this.opts.role === "receiver" && message.sdp && !this.pc) {
      this.stopHelloRetry();
      const pc = this.makeConnection();
      await pc.setRemoteDescription(message.sdp);
      await this.flushCandidates();
      await pc.setLocalDescription(await pc.createAnswer());
      await this.send({ type: "answer", device: this.opts.deviceId, sdp: pc.localDescription?.toJSON() });
    } else if (message.type === "answer" && this.opts.role === "sender" && message.sdp && this.pc) {
      await this.pc.setRemoteDescription(message.sdp);
      await this.flushCandidates();
    } else if (message.type === "ice" && message.candidate) {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(message.candidate);
      else this.candidates.push(message.candidate);
    }
  }
  private async flushCandidates() {
    const pending = this.candidates.splice(0);
    for (const candidate of pending) if (this.pc) await this.pc.addIceCandidate(candidate);
  }
  /** Derived from selected ICE candidate types; no IP addresses are exposed.
   * Host-host suggests a direct route, not proof of same LAN or zero mobile usage.
   * Browsers cannot enumerate mDNS devices/local IP addresses without native APIs.
   */
  async getConnectionRoute(): Promise<RouteHint> {
    if(!this.pc || this.pc.connectionState!=="connected")return "unknown";
    const stats=await this.pc.getStats();
    type Entry=RTCStats & {selectedCandidatePairId?:string; localCandidateId?:string;
      remoteCandidateId?:string;selected?:boolean;nominated?:boolean;state?:string;candidateType?:string};
    let pair:Entry|undefined;
    stats.forEach(raw=>{
      const record=raw as Entry;
      if(record.type==="transport"&&record.selectedCandidatePairId){pair=stats.get(record.selectedCandidatePairId) as Entry;}
    });
    if(!pair) stats.forEach(raw=>{
      const record=raw as Entry;
      if(record.type==="candidate-pair"&&record.nominated&&record.state==="succeeded")pair=record;
    });
    if(!pair?.localCandidateId||!pair?.remoteCandidateId)return "unknown";
    const local=stats.get(pair.localCandidateId) as Entry|undefined;
    const remote=stats.get(pair.remoteCandidateId) as Entry|undefined;
    if(!local?.candidateType||!remote?.candidateType)return "unknown";
    if(local.candidateType==="relay"||remote.candidateType==="relay")return "turn-relay";
    if(local.candidateType==="host"&&remote.candidateType==="host")return "direct-host";
    return "direct-other";
  }

  close() {
    this.closed = true;
    this.stopHelloRetry();
    this.pc?.close();
    void this.opts.client.removeChannel(this.channel);
  }
}
