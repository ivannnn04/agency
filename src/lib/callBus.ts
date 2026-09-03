'use client'

// Tiny event bus: chats ask the global CallListener to start/join a call.
// The listener lives in the layout, so the call survives page navigation.

export interface CallRequest {
  roomKey: string
  roomName: string
  ringKeys?: string[] // people to auto-ring (outgoing direct call)
}

export function startCall(req: CallRequest) {
  window.dispatchEvent(new CustomEvent('gudrix:start-call', { detail: req }))
}
