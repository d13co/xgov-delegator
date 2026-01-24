import { sha512_256 } from "js-sha512";

export function calculateCommitteeId(contents: string): Uint8Array {
  const fileHash = Buffer.from(sha512_256(contents), "hex");
  const concatenated = Buffer.concat([Buffer.from("arc0086"), fileHash]);
  const committeeId = Buffer.from(sha512_256(concatenated), "hex");
  return new Uint8Array(committeeId);
}
