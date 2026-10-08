// Type-level use of the packed package's declarations.
import { BindingId, MachineUserId, required, wire } from "@structured-id/ids";

const message: wire.BindingId = { value: new Uint8Array(16) };
const binding: BindingId = required(BindingId, message);
const machine: MachineUserId = MachineUserId.fromBytes(binding.toBytes());
// @ts-expect-error a MachineUserId is not a BindingId
const wrong: BindingId = machine;
export { wrong };
