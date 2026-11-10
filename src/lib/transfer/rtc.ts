import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type Role = "sender" | "receiver";
export type PeerState = "waiting" | "connecting" | "connected" | "disconnected";
type Message = { type: "hello" | "offer" | "answer" | "ice"; device: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export interface PeerOptions {
  client: SupabaseClient;
  roomId: string;
  deviceId: string;
  role: Role;
  onState: (state: PeerState) => void;
  onChannel: (channel: RTCDataChannel) => void;
}

export class SupabaseRtcPeer {
  private channel: RealtimeChannel;
  private pc: RTCPeerConnection | null = null;
  private candidates: RTCIceCandidateInit[] = [];
  private closed = false;
  private started = false;
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
    this.opts.onState("waiting");
    if (this.opts.role === "receiver") await this.send({ type: "hello", device: this.opts.deviceId });
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
  private async handle(message: Message) {
    if (this.closed || message.device === this.opts.deviceId) return;
    if (message.type === "hello" && this.opts.role === "sender" && !this.pc) {
      const pc = this.makeConnection();
      const dc = pc.createDataChannel("pend-files", { ordered: true });
      this.opts.onChannel(dc);
      await pc.setLocalDescription(await pc.createOffer());
      await this.send({ type: "offer", device: this.opts.deviceId, sdp: pc.localDescription?.toJSON() });
    } else if (message.type === "offer" && this.opts.role === "receiver" && message.sdp) {
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
  close() {
    this.closed = true;
    this.pc?.close();
    void this.opts.client.removeChannel(this.channel);
  }
}
