import { PublicKey } from "@solana/web3.js";

const ENCRYPTION_MESSAGE = "Sign this message to derive your ConfPay encryption key. This allows you to securely view and manage salaries.";

export async function deriveKeyFromSignature(signature: Uint8Array): Promise<CryptoKey> {
  // Convert signature to ArrayBuffer to satisfy TS
  // Force cast to any or ArrayBuffer because Next.js types for crypto are strict about SharedArrayBuffer
  const buffer = signature.buffer.slice(
    signature.byteOffset,
    signature.byteOffset + signature.byteLength
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveKeyFromPin(pin: string): Promise<CryptoKey> {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error("Web Crypto API not available. Please ensure you are in a secure context (HTTPS).");
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return crypto.subtle.importKey(
        "raw",
        hash,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

let cachedKey: CryptoKey | null = null;

export async function getEncryptionKey(wallet: { signMessage?: (msg: Uint8Array) => Promise<Uint8Array> }): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  if (!wallet.signMessage) {
    throw new Error("Wallet does not support message signing");
  }
  const encodedMessage = new TextEncoder().encode(ENCRYPTION_MESSAGE);
  const signature = await wallet.signMessage(encodedMessage);
  cachedKey = await deriveKeyFromSignature(signature);
  return cachedKey;
}

export function clearCachedKey() {
    cachedKey = null;
}

export async function encryptAES(data: string, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encodedData
  );

  // Pack: [IV (12)] + [Ciphertext]
  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result;
}

export async function decryptAES(packedData: Uint8Array, key: CryptoKey): Promise<string> {
  if (packedData.length < 13) throw new Error("Invalid data length");
  
  const iv = packedData.slice(0, 12);
  const ciphertext = packedData.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
