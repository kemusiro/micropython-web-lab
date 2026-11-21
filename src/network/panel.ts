import "./panel.css";
import { NetworkHost } from "./host";
import { validateSettings, type NetworkSettings, type NetworkHistory } from "./contracts";
import { dequeue, type MqttConnection } from "./mqtt";
import { NETWORK_EXAMPLES } from "./examples";

/** DOM lives only here; models and protocol parsing are UI independent. */
export class NetworkPanel {
  readonly element = document.createElement("details");
  readonly #host: NetworkHost;
  readonly #ja: boolean;
  readonly #state = document.createElement("p");
  readonly #result = document.createElement("pre");
  readonly #history = document.createElement("pre");
  readonly #mqttResult = document.createElement("pre");
  readonly #grants = new Map<string, HTMLInputElement>();
  readonly #settings = new Map<string, HTMLInputElement | HTMLSelectElement>();
  #monitor: MqttConnection | null = null;
  #mqttLines: string[] = [];
  #frame: number | null = null;
  #renderedSettings: NetworkSettings | null = null;
  constructor(host: NetworkHost, options: { locale: string; openExample: (title: string, source: string) => void; saveSettings: (settings: NetworkSettings) => Promise<void> }) {
    this.#host = host; this.#ja = options.locale === "ja";
    this.element.className = "network-panel"; this.element.id = "network-panel";
    const summary = document.createElement("summary"); summary.textContent = this.#label("ネットワーク", "Network");
    this.#state.className = "network-state"; this.#state.id = "network-state";
    this.#result.id = "network-action-result"; this.#result.setAttribute("role", "status");
    this.element.append(summary, this.#state, this.#result);
    this.#paragraph(this.#label("非公式の機能シミュレーション。ローカルPC・LAN接続には対応しません。", "Unofficial functional simulation. Local PC / LAN connections are unavailable."));
    if (typeof SharedArrayBuffer === "undefined") this.#paragraph(this.#label("共有メモリが使えないため、ネットワーク機能は利用できません。", "Networking requires shared memory and cross-origin isolation."));

    const samples = this.#section(this.#label("サンプル（新しいタブ）", "Examples (new tab)"));
    for (const [name, source] of Object.entries(NETWORK_EXAMPLES)) this.#button(samples, name, () => options.openExample(name, source));

    const settings = this.#section(this.#label("仮想WiFi・サービス・NTP設定", "Virtual WiFi, services and NTP"));
    for (const [key, ja, en, type] of [
      ["apPresent", "APあり", "AP present", "checkbox"], ["ssid", "仮想SSID", "Virtual SSID", "text"],
      ["key", "仮想パスワード（実値不要）", "Demo key (no real WiFi key)", "text"],
      ["rssi", "RSSI", "RSSI", "number"], ["connectDelayMs", "接続遅延 ms", "Connection delay ms", "number"],
      ["httpDelayMs", "HTTP遅延 ms", "HTTP delay ms", "number"],
      ["ntpUnixSeconds", "仮想NTP Unix秒", "Virtual NTP Unix seconds", "number"],
      ["ntpDelayMs", "NTP遅延 ms", "NTP delay ms", "number"], ["duplicateQos1", "仮想QoS 1重複配信", "Duplicate virtual QoS 1 delivery", "checkbox"],
    ]) {
      const input = this.#input(settings, this.#label(ja!, en!), type!); input.dataset.networkSetting = key;
      this.#settings.set(key!, input);
    }
    this.#settings.set("ntpSource", this.#select(settings, this.#label("NTP時刻源", "NTP time source"), [["fixed", this.#label("仮想時刻", "Fixed virtual time")], ["pc", this.#label("PCの時計（外部NTP通信なし）", "PC clock (no external NTP)")]]));
    this.#settings.set("ntpFault", this.#select(settings, this.#label("NTP障害", "NTP fault"), [["none", "none"], ["timeout", "timeout"], ["invalid", "invalid response"]]));
    this.#button(settings, this.#label("設定を保存して適用", "Save and apply settings"), async () => {
      const next: Record<string, unknown> = { version: 1 };
      for (const [key, field] of this.#settings) next[key] = field instanceof HTMLInputElement ? field.type === "checkbox" ? field.checked : field.type === "number" ? Number(field.value) : field.value : field.value;
      const validated = validateSettings(next);
      await options.saveSettings(validated);
      this.#host.configure(validated);
      this.#result.textContent = this.#label("ネットワーク設定を保存しました。", "Network settings saved.");
    });
    this.#button(settings, this.#label("WiFi切断", "Disconnect WiFi"), () => host.disconnectWifi());
    this.#button(settings, this.#label("ネットワーク実験を初期化", "Reset network experiment"), () => { host.resetExperiment(); this.#monitor = null; this.#mqttLines = []; });

    const external = this.#section(this.#label("外部接続の許可（既定で無効）", "External permissions (off by default)"));
    this.#paragraph(this.#label("接続先にIPと要求データが送信されます。公開MQTTのデータは他人も閲覧・送信できます。秘密情報を送らないでください。", "Destinations receive your IP and request data. Public MQTT data can be read or changed by others. Use public demo data only."), external);
    for (const [id, name] of [["httpbin", "httpbin.org: GET /get, /status/404, /status/500; POST /post"], ["open-meteo", "Open-Meteo: GET /v1/forecast"], ["shiftr", "shiftr.io: WSS public.cloud.shiftr.io:443/"]]) {
      const input = this.#input(external, name!, "checkbox"); input.dataset.networkGrant = id;
      input.onchange = () => host.grant(id!, input.checked); this.#grants.set(id!, input);
    }
    this.#paragraph(this.#label("Open-Meteo無料APIは非商用向けです。データ表示時に出典を明示してください。", "The free Open-Meteo API is for non-commercial use. Attribute displayed weather data."), external);
    const link = document.createElement("a"); link.href = "https://open-meteo.com/en/terms"; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open-Meteo terms"; external.append(link);
    const prefix = document.createElement("code"); prefix.textContent = host.topicPrefix; external.append(prefix);
    this.#paragraph(this.#label("shiftr.ioではこのトピック接頭辞だけを使用します。名前分けはアクセス制御ではありません。編集・停止・再起動で許可は失効します。", "shiftr.io uses this topic prefix only. A prefix is not access control. Editing, Stop or Restart revokes permissions."), external);
    const graph = document.createElement("a"); graph.href = "https://public.cloud.shiftr.io/"; graph.target = "_blank"; graph.rel = "noopener noreferrer"; graph.textContent = this.#label("shiftr.ioの可視化を別タブで開く", "Open shiftr.io visualization in a new tab"); external.append(graph);

    const http = this.#section(this.#label("仮想HTTPクライアント", "Virtual HTTP client"));
    const port = this.#input(http, this.#label("仮想ポート", "Virtual port"), "number"); port.value = "8080";
    const method = this.#select(http, "Method", [["GET", "GET"], ["POST", "POST"]]);
    const path = this.#input(http, this.#label("要求パス", "Request path")); path.value = "/on";
    const body = this.#input(http, this.#label("要求本文", "Request body")); body.maxLength = 4096;
    this.#button(http, this.#label("仮想HTTP要求を送信", "Send virtual HTTP request"), async () => { this.#result.textContent = await host.virtualHttpRequest(Number(port.value), method.value, path.value, body.value); });

    const mqtt = this.#section(this.#label("仮想MQTTクライアント", "Virtual MQTT client"));
    const mqttTopic = this.#input(mqtt, this.#label("トピック", "Topic")); mqttTopic.value = "demo/control"; mqttTopic.maxLength = 128;
    const payload = this.#input(mqtt, this.#label("メッセージ", "Message")); payload.value = "on"; payload.maxLength = 4096;
    const qos = this.#select(mqtt, "QoS", [["0", "0"], ["1", "1"]]);
    const retain = this.#input(mqtt, "Retain", "checkbox");
    this.#button(mqtt, "Publish", () => host.publishVirtual(mqttTopic.value, payload.value, Number(qos.value), retain.checked));
    const filter = this.#input(mqtt, this.#label("購読フィルター", "Subscription filter")); filter.value = "demo/#";
    this.#button(mqtt, "Subscribe", () => {
      if (this.#monitor) host.broker.close(this.#monitor, true);
      this.#monitor = { id: 0, clientId: "panel", subscriptions: new Map(), queue: [], queueBytes: 0, closed: false, external: false };
      host.broker.connections.add(this.#monitor); host.broker.subscribe(this.#monitor, filter.value, Number(qos.value)); this.render();
    });
    mqtt.append(this.#mqttResult);
    const history = this.#section(this.#label("通信履歴（本文は記録しません）", "History (payloads are not recorded)")); history.append(this.#history);
    host.subscribe(() => { if (this.#frame === null) this.#frame = requestAnimationFrame(() => { this.#frame = null; this.render(); }); });
    this.render();
  }
  #label(ja: string, en: string): string { return this.#ja ? ja : en; }
  #paragraph(value: string, parent: HTMLElement = this.element): void { const p = document.createElement("p"); p.textContent = value; parent.append(p); }
  #section(title: string): HTMLFieldSetElement {
    const field = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = title; field.append(legend); this.element.append(field); return field;
  }
  #input(parent: HTMLElement, name: string, type = "text"): HTMLInputElement {
    const label = document.createElement("label"), input = document.createElement("input"); input.type = type; input.setAttribute("aria-label", name); label.append(name, input); parent.append(label); return input;
  }
  #select(parent: HTMLElement, name: string, options: string[][]): HTMLSelectElement {
    const label = document.createElement("label"), select = document.createElement("select"); select.setAttribute("aria-label", name);
    for (const [value, name] of options) { const option = document.createElement("option"); option.value = value!; option.textContent = name!; select.append(option); }
    label.append(name, select); parent.append(label); return select;
  }
  #button(parent: HTMLElement, title: string, action: () => unknown): void {
    const button = document.createElement("button"); button.type = "button"; button.textContent = title;
    button.onclick = async () => { button.disabled = true; try { await action(); } catch (error) { this.#result.textContent = error instanceof Error ? error.message : "Network action failed"; } finally { button.disabled = false; this.render(); } }; parent.append(button);
  }
  render(): void {
    const host = this.#host;
    this.#state.textContent = `${this.#label("仮想WiFi", "Virtual WiFi")}: ${host.connected ? "connected" : host.active ? "active" : "inactive"} · ${this.#label("外部許可", "External grants")}: ${host.granted.join(", ") || "none"} · NTP: ${host.settings.ntpSource === "pc" ? "PC clock" : "virtual clock"} (simulation)`;
    for (const [id, field] of this.#grants) field.checked = host.granted.includes(id);
    if (this.#renderedSettings !== host.settings) for (const [key, field] of this.#settings) {
      if (document.activeElement === field) continue;
      const value = host.settings[key as keyof NetworkSettings];
      if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = Boolean(value); else field.value = String(value);
    }
    this.#renderedSettings = host.settings;
    if (this.#monitor) {
      for (let message = dequeue(this.#monitor); message; message = dequeue(this.#monitor)) {
        const bytes = Uint8Array.from(message.data.match(/../g) ?? [], byte => parseInt(byte, 16));
        this.#mqttLines.push(`${message.topic}: ${new TextDecoder().decode(bytes)}`);
      }
      this.#mqttLines = this.#mqttLines.slice(-20);
    }
    this.#mqttResult.textContent = this.#mqttLines.join("\n");
    this.#history.textContent = host.history.map((h: NetworkHistory) => `${h.sequence} ${h.service} ${h.operation} ${h.result} ${h.bytes} B ${h.durationMs} ms`).join("\n");
  }
}
