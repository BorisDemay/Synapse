import { describe, expect, it } from "vitest";

import {
  serializeEncryptedPushOperation,
  type EncryptedPushOperation,
} from "./index";

describe("EncryptedPushOperation", () => {
  it("serializes to the documented Rust JSON shape", () => {
    const operation: EncryptedPushOperation = {
      protocol_version: 1,
      operation_id: "0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff",
      vault_id: "0198e5de-1111-7222-8333-444455556666",
      note_id: "0198e5de-7777-7888-8999-aaaabbbbcccc",
      base_revision: 4,
      ciphertext: Array<number>(16).fill(0),
      nonce: Array<number>(24).fill(0),
      aad_version: 1,
      ciphertext_hash:
        "f6d6f3ae0fc5e8a4feab46c293fe3d15eb34d8f5ca2dd01fc2cad6df1ddf6fb2",
    };

    expect(serializeEncryptedPushOperation(operation)).toBe(
      '{"protocol_version":1,"operation_id":"0198e5de-aaaa-7bbb-8ccc-ddddeeeeffff","vault_id":"0198e5de-1111-7222-8333-444455556666","note_id":"0198e5de-7777-7888-8999-aaaabbbbcccc","base_revision":4,"ciphertext":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"nonce":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"aad_version":1,"ciphertext_hash":"f6d6f3ae0fc5e8a4feab46c293fe3d15eb34d8f5ca2dd01fc2cad6df1ddf6fb2"}',
    );
  });
});
