# SA ↔ Mini P2P signaling

Cloudflare Worker + Durable Object used only for WebRTC discovery and offer/answer/ICE relay.

- Payload bytes never traverse this service.
- No application payload is written to Durable Object storage.
- Each room accepts at most two peers and requires the same SHA-256 pairing proof.
- WebSocket attachments contain only peer/proof/expiry metadata needed across hibernation.
- `/health` is the only HTTP endpoint besides `/ws`.

Local: `npm install && npm test && npm run dev`.
Deploy requires Wrangler authentication, then `npm run deploy`.

## Shared SA/Mini browser API

Mini must mirror the checked-in `js/p2p/P2PCore.js` and
`js/p2p/P2PPairing.js` contract exactly. P2P remains transport only: v1 sends
SA's already-produced `sa-roster/v1` bytes and never mutates economic data.

| API | Required contract |
| --- | --- |
| `makePairDescriptor(self)` / `pairDescriptorFromManual(code, key)` | Pair session uses the deterministic 5-minute `expiresAt`; `proof` includes that expiry. Manual entry must not create an unbounded session. |
| `SignalingClient({ room, peerId, proof, expiresAt })` | `expiresAt` is required for `pair-*` rooms and must be passed in the WebSocket query. The Worker accepts only exact offer/answer/ICE shapes. |
| `attachPairing(channel, options)` | Both users confirm the SAS. SA pairs only with Mini. Receiver saves the exact 32-byte base64url `linkToken`, then sends exactly `pair-linked { linkToken, sessionId, initiatorId, receiverId, mac }`; the MAC is bound to the descriptor proof, `sessionId`, both device IDs, and `linkToken`, and the initiator verifies it before saving. |
| `attachTrusted(channel, options)` | Mutual HMAC is required before `onAuthenticated`; any authentication error revokes/closes the channel. |
| `sendPayload(channel, { kind, schema, text, onProgress })` | Channel must be authenticated; `kind` is exactly `roster`, `schema` exactly `sa-roster/v1`; size is hard-capped at 5 MiB, with `CHUNK_SIZE` exactly 12 KiB. There is no caller limit override. |
| `createTransferReceiver({ channel, onComplete, onProgress, onError })` | An authenticated bound DataChannel is required; an absent, null, unauthenticated, or closed channel fails closed before staging. No size override. Validate exact start/end framing, canonical chunk count, exact binary lengths, aggregate size, and SHA-256 before staging. |
| `roster-staged` ACK | Mini must send exactly `{ transferId, sha256, kind: 'roster', schema: 'sa-roster/v1', validated: true }`. SA rejects any mismatch or extra field. |

Mini should use the exported core helpers (`validateLinkToken`,
`validateRosterStageAck`, `markChannelAuthenticated`, and
`isChannelAuthenticated`) rather than implementing a looser parallel protocol.
