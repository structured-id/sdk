/**
 * Browser transport for the generated clients: gRPC-web, and WebTransport
 * with per-call failover to gRPC-web when a WebTransport endpoint is given.
 */
export {
  AdaptiveRpcTransport,
  type AdaptiveTransportOptions,
  type TransportType,
} from "./adaptive.js";
export {
  WebTransportConnection,
  WebTransportRpcTransport,
  type WebTransportConnectOptions,
} from "./webtransport.js";
export { FrameReader, readFrame, writeFrame } from "./framing.js";
